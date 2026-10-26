// Pure zone/geometry helpers shared by the Position designer route.
// Extracted verbatim from app.position-designer.tsx so they can be unit
// tested without a DOM — behavior is intentionally unchanged.

export type ImageSize = { width: number; height: number };

// Every field for both shapes lives on one flat object — `shape` says which
// half is meaningful — because Font 1 and Font 2 each need a *complete*,
// independent geometry (not just a font swap): a wide script and a compact
// sans can need quite different boxes to sit well, so each font's box/curve
// and font size are their own thing, not shared fields with one shape-typed
// wrapper. `linked: true` (the default) keeps them mirrored — editing one
// updates both — until the merchant deliberately turns that off.
export type FontGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  arcLength: number;
  fontSize: number;
};

export type Zone = {
  shape: "straight" | "curved";
  linked: boolean;
  fontOne: FontGeometry;
  fontTwo: FontGeometry;
  fontChoice: "one" | "two";
  maxLength: number;
  uppercaseOnly: boolean;
};

export const DEFAULT_STRAIGHT_GEOMETRY: FontGeometry = {
  x: 30,
  y: 42,
  width: 40,
  height: 16,
  centerX: 50,
  centerY: 50,
  radius: 25,
  startAngle: 200,
  arcLength: 140,
  fontSize: 55,
};

export const DEFAULT_CURVED_GEOMETRY: FontGeometry = {
  ...DEFAULT_STRAIGHT_GEOMETRY,
  fontSize: 60,
};

export const DEFAULT_ZONE: Zone = {
  shape: "straight",
  linked: true,
  fontOne: DEFAULT_STRAIGHT_GEOMETRY,
  fontTwo: DEFAULT_STRAIGHT_GEOMETRY,
  fontChoice: "one",
  maxLength: 24,
  uppercaseOnly: false,
};

// Saved zones from before per-font positioning existed are a flat object
// with the geometry fields directly on it (no fontOne/fontTwo split). They
// were inherently "linked" — there was only one position — so lifting the
// same geometry into both slots reproduces the old behavior exactly.
export function migrateZone(raw: unknown): Zone {
  if (!raw || typeof raw !== "object") return DEFAULT_ZONE;
  if ("fontOne" in raw) {
    const existing = raw as Zone;
    // Zones saved before uppercaseOnly existed won't have the field at
    // all — undefined is falsy in the checks that use it, but coercing
    // it explicitly here keeps the value a real boolean everywhere else
    // (React state, the checkbox's checked prop) instead of leaving an
    // undefined to quietly do the right thing by accident.
    return { ...existing, uppercaseOnly: existing.uppercaseOnly ?? false };
  }
  const old = raw as FontGeometry & { shape: Zone["shape"]; fontChoice: Zone["fontChoice"]; maxLength: number };
  const geom: FontGeometry = { ...DEFAULT_STRAIGHT_GEOMETRY, ...old };
  return {
    shape: old.shape,
    linked: true,
    fontOne: geom,
    fontTwo: geom,
    fontChoice: old.fontChoice,
    maxLength: old.maxLength,
    uppercaseOnly: false,
  };
}

export function isDegenerate(shape: Zone["shape"], g: FontGeometry): boolean {
  return shape === "straight" ? g.width <= 0 || g.height <= 0 : g.radius <= 0;
}

export const EMPTY_GEOMETRY: FontGeometry = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  centerX: 0,
  centerY: 0,
  radius: 0,
  startAngle: DEFAULT_STRAIGHT_GEOMETRY.startAngle,
  arcLength: DEFAULT_STRAIGHT_GEOMETRY.arcLength,
  fontSize: DEFAULT_STRAIGHT_GEOMETRY.fontSize,
};

export function toPixelGeometry(saved: FontGeometry, image: ImageSize): FontGeometry {
  return {
    x: image.width * (saved.x / 100),
    y: image.height * (saved.y / 100),
    width: image.width * (saved.width / 100),
    height: image.height * (saved.height / 100),
    centerX: image.width * (saved.centerX / 100),
    centerY: image.height * (saved.centerY / 100),
    radius: image.width * (saved.radius / 100),
    startAngle: saved.startAngle,
    arcLength: saved.arcLength,
    fontSize: saved.fontSize,
  };
}

export function toPercentGeometry(pixel: FontGeometry, image: ImageSize): FontGeometry {
  return {
    x: +((pixel.x / image.width) * 100).toFixed(1),
    y: +((pixel.y / image.height) * 100).toFixed(1),
    width: +((pixel.width / image.width) * 100).toFixed(1),
    height: +((pixel.height / image.height) * 100).toFixed(1),
    centerX: +((pixel.centerX / image.width) * 100).toFixed(1),
    centerY: +((pixel.centerY / image.height) * 100).toFixed(1),
    radius: +((pixel.radius / image.width) * 100).toFixed(1),
    startAngle: Math.round(pixel.startAngle),
    arcLength: Math.round(pixel.arcLength),
    fontSize: pixel.fontSize,
  };
}


// ---------------------------------------------------------------------------
// Server-side validation of a zone submitted by the Position designer.
// Lenient on values the editor can legitimately produce (a zone dragged
// partly off the image has negative / >100 percentages), strict on shape:
// every field present, finite, and of the right type — so nothing malformed
// is ever written into the product metafield the storefront renders from.
// ---------------------------------------------------------------------------

const GEOMETRY_KEYS: (keyof FontGeometry)[] = [
  "x",
  "y",
  "width",
  "height",
  "centerX",
  "centerY",
  "radius",
  "startAngle",
  "arcLength",
  "fontSize",
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseGeometry(raw: unknown): FontGeometry | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const geometry = {} as FontGeometry;
  for (const key of GEOMETRY_KEYS) {
    const value = source[key];
    if (!isFiniteNumber(value) || Math.abs(value) > 10_000) return null;
    geometry[key] = value;
  }
  if (geometry.fontSize <= 0) return null;
  return geometry;
}

export function parseZoneInput(json: string): Zone | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;

  if (source.shape !== "straight" && source.shape !== "curved") return null;
  if (source.fontChoice !== "one" && source.fontChoice !== "two") return null;
  if (typeof source.linked !== "boolean") return null;
  if (typeof source.uppercaseOnly !== "boolean") return null;
  const maxLength = source.maxLength;
  if (!isFiniteNumber(maxLength) || !Number.isInteger(maxLength) || maxLength < 1 || maxLength > 200) {
    return null;
  }
  const fontOne = parseGeometry(source.fontOne);
  const fontTwo = parseGeometry(source.fontTwo);
  if (!fontOne || !fontTwo) return null;
  if (isDegenerate(source.shape, fontOne) || isDegenerate(source.shape, fontTwo)) return null;

  // Rebuilt field by field so unknown keys never reach the metafield.
  return {
    shape: source.shape,
    linked: source.linked,
    fontOne,
    fontTwo,
    fontChoice: source.fontChoice,
    maxLength,
    uppercaseOnly: source.uppercaseOnly,
  };
}

export function safeJsonParse(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
