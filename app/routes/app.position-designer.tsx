import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type Konva from "konva";
import { authenticate } from "../shopify.server";
import type EngravingCanvasComponent from "../components/EngravingCanvas";

const METAFIELD_NAMESPACE = "engraving";
const METAFIELD_KEY = "zone";

// The actual fonts are uploaded once, globally, on the app's Font settings
// page — this page just stores which of the two a product uses. These
// preview families are stand-ins for the dropdown/canvas until a real font
// is uploaded for that slot (see the FontFace-loading effect below, which
// swaps in the real one as soon as it's available).
export const FONT_CHOICES = [
  { value: "one", label: "Font 1", previewFamily: "'Great Vibes', cursive" },
  { value: "two", label: "Font 2", previewFamily: "'Playfair Display', serif" },
] as const;

// Every field for both shapes lives on one flat object — `shape` says which
// half is meaningful — because Font 1 and Font 2 each need a *complete*,
// independent geometry (not just a font swap): a wide script and a compact
// sans can need quite different boxes to sit well, so each font's box/curve
// and font size are their own thing, not shared fields with one shape-typed
// wrapper. `linked: true` (the default) keeps them mirrored — editing one
// updates both — until the merchant deliberately turns that off.
type FontGeometry = {
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

type Zone = {
  shape: "straight" | "curved";
  linked: boolean;
  fontOne: FontGeometry;
  fontTwo: FontGeometry;
  fontChoice: "one" | "two";
  maxLength: number;
};

const DEFAULT_STRAIGHT_GEOMETRY: FontGeometry = {
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

const DEFAULT_CURVED_GEOMETRY: FontGeometry = {
  ...DEFAULT_STRAIGHT_GEOMETRY,
  fontSize: 60,
};

const DEFAULT_ZONE: Zone = {
  shape: "straight",
  linked: true,
  fontOne: DEFAULT_STRAIGHT_GEOMETRY,
  fontTwo: DEFAULT_STRAIGHT_GEOMETRY,
  fontChoice: "one",
  maxLength: 24,
};

// Saved zones from before per-font positioning existed are a flat object
// with the geometry fields directly on it (no fontOne/fontTwo split). They
// were inherently "linked" — there was only one position — so lifting the
// same geometry into both slots reproduces the old behavior exactly.
function migrateZone(raw: unknown): Zone {
  if (!raw || typeof raw !== "object") return DEFAULT_ZONE;
  if ("fontOne" in raw) return raw as Zone;
  const old = raw as FontGeometry & {
    shape: Zone["shape"];
    fontChoice: Zone["fontChoice"];
    maxLength: number;
  };
  const geom: FontGeometry = { ...DEFAULT_STRAIGHT_GEOMETRY, ...old };
  return {
    shape: old.shape,
    linked: true,
    fontOne: geom,
    fontTwo: geom,
    fontChoice: old.fontChoice,
    maxLength: old.maxLength,
  };
}

function isDegenerate(shape: Zone["shape"], g: FontGeometry): boolean {
  return shape === "straight" ? g.width <= 0 || g.height <= 0 : g.radius <= 0;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const productId = new URL(request.url).searchParams.get("productId");

  const shopFontsResponse = await admin.graphql(
    `#graphql
      query GetShopFonts {
        shop {
          metafield(namespace: "engraving", key: "fonts") { value }
        }
      }`,
  );
  const shopFontsJson = await shopFontsResponse.json();
  const shopFontsValue = shopFontsJson.data?.shop?.metafield?.value as
    string | undefined;
  const shopFonts = shopFontsValue
    ? (JSON.parse(shopFontsValue) as {
        fontOne?: { familyName: string; url: string };
        fontTwo?: { familyName: string; url: string };
      })
    : {};

  if (!productId) return { productId: null, zone: null, shopFonts };

  const response = await admin.graphql(
    `#graphql
      query GetEngravingZone($id: ID!) {
        product(id: $id) {
          metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
            value
          }
        }
      }`,
    { variables: { id: productId } },
  );

  const json = await response.json();
  const value = json.data?.product?.metafield?.value as string | undefined;
  return {
    productId,
    zone: value ? migrateZone(JSON.parse(value)) : null,
    shopFonts,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const productId = formData.get("productId");
  const zoneJson = formData.get("zone");

  if (typeof productId !== "string" || typeof zoneJson !== "string") {
    return { userErrors: [{ message: "Missing product or zone data" }] };
  }

  const response = await admin.graphql(
    `#graphql
      mutation SaveEngravingZone($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: METAFIELD_NAMESPACE,
            key: METAFIELD_KEY,
            type: "json",
            value: zoneJson,
          },
        ],
      },
    },
  );

  const json = await response.json();
  return json.data?.metafieldsSet;
};

type PickedProduct = { id: string; title: string; imageUrl: string | null };

const EMPTY_GEOMETRY: FontGeometry = {
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

function toPixelGeometry(
  saved: FontGeometry,
  image: HTMLImageElement,
): FontGeometry {
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

function toPercentGeometry(
  pixel: FontGeometry,
  image: HTMLImageElement,
): FontGeometry {
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

const DEFAULT_PREVIEW_TEXT = "Your Text";

export default function PositionDesigner() {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const zoneFetcher = useFetcher<typeof loader>();

  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [EngravingCanvas, setEngravingCanvas] = useState<ComponentType<
    React.ComponentProps<typeof EngravingCanvasComponent>
  > | null>(null);

  useEffect(() => {
    // react-konva touches the canvas/DOM directly, so it can only run in the
    // browser. Loading it here, inside an effect, keeps it out of the
    // server-side render entirely — a top-level import would make the dev
    // server try (and fail) to load it during SSR too.
    import("../components/EngravingCanvas").then((mod) =>
      setEngravingCanvas(() => mod.default),
    );
  }, []);

  const [shape, setShape] = useState<Zone["shape"]>("straight");
  const [linked, setLinked] = useState(true);
  const [fontChoice, setFontChoice] = useState<"one" | "two">("one");
  const [maxLength, setMaxLength] = useState<number>(DEFAULT_ZONE.maxLength);
  const [fontOneGeom, setFontOneGeom] = useState<FontGeometry>(EMPTY_GEOMETRY);
  const [fontTwoGeom, setFontTwoGeom] = useState<FontGeometry>(EMPTY_GEOMETRY);

  // What the canvas currently shows/edits: Font 1's geometry, or Font 2's —
  // when linked the two are always equal anyway, so this is just "the one
  // matching the Font dropdown" either way.
  const currentGeom = fontChoice === "one" ? fontOneGeom : fontTwoGeom;

  // Local to the editor only — never saved. Lets the merchant type sample
  // text to see the real font/size/curve while placing the zone, without
  // that placeholder text ever being written to the product's metafield.
  const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW_TEXT);

  useEffect(() => {
    if (fetcher.data && !fetcher.data.userErrors?.length) {
      shopify.toast.show("Engraving zone saved");
    } else if (fetcher.data?.userErrors?.length) {
      shopify.toast.show(fetcher.data.userErrors[0].message, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const pickProduct = async () => {
    const selection = await shopify.resourcePicker({ type: "product" });
    if (!selection || selection.length === 0) return;

    const picked = selection[0];
    const imageUrl = picked.images?.[0]?.originalSrc ?? null;
    setProduct({ id: picked.id, title: picked.title, imageUrl });
    setImage(null);
    setPreviewText(DEFAULT_PREVIEW_TEXT);
    zoneFetcher.load(
      `/app/position-designer?productId=${encodeURIComponent(picked.id)}`,
    );

    if (!imageUrl) return;

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.src = imageUrl;
  };

  // True once we've heard back about this exact product's saved zone (with
  // either a real value or null for "nothing saved yet") — not just "some
  // fetch resolved", which could still be the answer for whichever product
  // was selected before this one.
  const zoneReady = zoneFetcher.data?.productId === product?.id;

  // Bumped once per font that finishes loading — passed down to
  // EngravingCanvas so it can force a Konva redraw exactly when needed. A
  // DOM-level "fonts finished loading" event has a race: if a font happens
  // to finish before the canvas has mounted and started listening, that
  // one-time event is simply missed, and nothing redraws until something
  // unrelated happens to trigger it. Routing this through React state
  // instead ties it to the component's own render/effect order, so there's
  // no window where the signal can arrive before anything is listening.
  const [fontsReadyTick, setFontsReadyTick] = useState(0);

  // The Konva canvas preview used to always show a made-up stand-in font
  // (Great Vibes / Playfair Display), since it had no way to render the
  // merchant's actual uploaded font. Now that a real font file and URL are
  // available (once shopFonts loads), loading it into the browser via the
  // Font Loading API lets Konva use the real thing, so the admin preview
  // actually matches what shows up on the storefront instead of an
  // arbitrary substitute.
  useEffect(() => {
    const shopFonts = zoneFetcher.data?.shopFonts;
    if (!shopFonts) return;
    [shopFonts.fontOne, shopFonts.fontTwo].forEach((font) => {
      if (!font) return;
      const face = new FontFace(font.familyName, `url(${font.url})`);
      face
        .load()
        .then((loaded) => {
          document.fonts.add(loaded);
          setFontsReadyTick((t) => t + 1);
        })
        .catch(() => {
          // Falls back to the stand-in family below if this never loads.
        });
    });
  }, [zoneFetcher.data?.shopFonts]);

  // Decide the starting shape/geometry/font exactly once per product, before
  // the canvas ever mounts — as soon as both the image and the saved-zone
  // lookup are ready. See EngravingCanvas for why the Transformer attaches
  // cleanly this way but wouldn't if these changed after the first mount.
  useEffect(() => {
    if (!image || !zoneReady) return;
    let source = zoneFetcher.data?.zone ?? DEFAULT_ZONE;
    // A saved zone from an earlier, buggier version of this tool could have
    // degenerate geometry (e.g. a circle with radius 0) baked into it —
    // trusting that blindly would load a box/circle with nothing visible to
    // grab. Treating it as if nothing had been saved falls back to sane
    // defaults instead of reproducing the old bug forever.
    if (
      isDegenerate(source.shape, source.fontOne) ||
      isDegenerate(source.shape, source.fontTwo)
    ) {
      source = DEFAULT_ZONE;
    }

    // Syncing to an external event (image + network fetch both settling),
    // not deriving from current props/state — the documented exception to
    // "you might not need an effect", even though the rule below can't tell.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShape(source.shape);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLinked(source.linked);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFontChoice(source.fontChoice);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMaxLength(source.maxLength);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFontOneGeom(toPixelGeometry(source.fontOne, image));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFontTwoGeom(toPixelGeometry(source.fontTwo, image));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, zoneReady]);

  // The merchant can flip shape mid-edit (e.g. to compare straight vs
  // curved on the same product). Fill in sensible starting geometry the
  // first time a shape is used; if they'd already set it up once, switching
  // back keeps what they had instead of resetting it. Applies to whichever
  // font(s) are currently being edited, same as any other change.
  const handleShapeChange = (newShape: Zone["shape"]) => {
    setShape(newShape);
    if (!image) return;
    const needsDefault = (g: FontGeometry) =>
      newShape === "curved" ? g.radius === 0 : g.width === 0;
    const withDefault = (g: FontGeometry): FontGeometry =>
      needsDefault(g)
        ? toPixelGeometry(
            newShape === "curved"
              ? DEFAULT_CURVED_GEOMETRY
              : DEFAULT_STRAIGHT_GEOMETRY,
            image,
          )
        : g;
    updateGeom(withDefault);
  };

  // Applies an update to whichever geometry the merchant is currently
  // working on: both, if linked; just Font 1 or just Font 2 otherwise.
  const updateGeom = (updater: (g: FontGeometry) => FontGeometry) => {
    if (linked) {
      setFontOneGeom((g) => updater(g));
      setFontTwoGeom((g) => updater(g));
    } else if (fontChoice === "one") {
      setFontOneGeom((g) => updater(g));
    } else {
      setFontTwoGeom((g) => updater(g));
    }
  };

  const handleLinkedChange = (newLinked: boolean) => {
    setLinked(newLinked);
    // Re-linking snaps Font 2 back to match Font 1, so "linked" always means
    // "actually the same", not "coincidentally still equal from before".
    if (newLinked) setFontTwoGeom(fontOneGeom);
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    if (shape === "straight") {
      updateGeom((g) => ({ ...g, x: node.x(), y: node.y() }));
    } else {
      updateGeom((g) => ({ ...g, centerX: node.x(), centerY: node.y() }));
    }
  };

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    if (shape === "straight") {
      const rect = node as Konva.Rect;
      updateGeom((g) => ({
        ...g,
        x: rect.x(),
        y: rect.y(),
        width: Math.max(10, rect.width() * scaleX),
        height: Math.max(10, rect.height() * scaleY),
      }));
    } else {
      const circle = node as Konva.Circle;
      updateGeom((g) => ({
        ...g,
        centerX: circle.x(),
        centerY: circle.y(),
        radius: Math.max(10, circle.radius() * scaleX),
      }));
    }
  };

  // Derived, not state: the percentage zone is just geometry re-expressed
  // against the image's natural size, so it's computed fresh every render
  // rather than synced via an effect.
  const zone: Zone | null = image
    ? {
        shape,
        linked,
        fontOne: toPercentGeometry(fontOneGeom, image),
        fontTwo: toPercentGeometry(fontTwoGeom, image),
        fontChoice,
        maxLength,
      }
    : null;

  const handleSave = () => {
    if (!product || !zone) return;
    fetcher.submit(
      { productId: product.id, zone: JSON.stringify(zone) },
      { method: "post" },
    );
  };

  const displayWidth = image ? Math.min(480, image.width) : 0;
  const scale = image ? displayWidth / image.width : 1;
  const displayHeight = image ? image.height * scale : 0;
  const isSaving = fetcher.state !== "idle";
  const currentZoneGeom = zone
    ? fontChoice === "one"
      ? zone.fontOne
      : zone.fontTwo
    : null;

  return (
    <s-page heading="Engraving position designer">
      <s-button slot="primary-action" onClick={pickProduct}>
        {product ? "Change product" : "Choose product"}
      </s-button>

      <s-section heading={product ? product.title : "No product selected"}>
        {!product && (
          <s-paragraph>
            Pick a product to place its engraving zone. The area you set here is
            where the customer&apos;s text will appear on the storefront.
          </s-paragraph>
        )}

        {product && !image && (
          <s-paragraph>This product has no image to work with.</s-paragraph>
        )}

        {product && image && !zoneReady && <s-paragraph>Loading…</s-paragraph>}

        {product && image && zoneReady && (
          <s-stack direction="block" gap="base">
            <label
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <input
                type="checkbox"
                checked={linked}
                onChange={(e) => handleLinkedChange(e.target.checked)}
              />
              Use the same position for both fonts
            </label>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                columnGap: "0.75rem",
                rowGap: "0.6rem",
                alignItems: "center",
                maxWidth: 420,
              }}
            >
              <span style={{ fontWeight: 500 }}>Shape</span>
              <select
                value={shape}
                onChange={(e) =>
                  handleShapeChange(e.target.value as Zone["shape"])
                }
                style={{ gridColumn: "2 / span 2" }}
              >
                <option value="straight">Straight (box)</option>
                <option value="curved">Curved (ring)</option>
              </select>

              <span style={{ fontWeight: 500 }}>
                {linked ? "Font" : "Editing position for"}
              </span>
              <select
                value={fontChoice}
                onChange={(e) => setFontChoice(e.target.value as "one" | "two")}
                style={{ gridColumn: "2 / span 2" }}
              >
                {FONT_CHOICES.map((opt) => {
                  const uploaded =
                    opt.value === "one"
                      ? zoneFetcher.data?.shopFonts?.fontOne
                      : zoneFetcher.data?.shopFonts?.fontTwo;
                  return (
                    <option
                      key={opt.value}
                      value={opt.value}
                      style={{ fontFamily: opt.previewFamily }}
                    >
                      {uploaded
                        ? `${opt.label} — ${uploaded.familyName}`
                        : opt.label}
                    </option>
                  );
                })}
              </select>

              <span style={{ fontWeight: 500 }}>
                Font size{" "}
                <small>
                  (% of {shape === "straight" ? "box height" : "radius"})
                </small>
              </span>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={currentGeom.fontSize}
                onChange={(e) =>
                  updateGeom((g) => ({
                    ...g,
                    fontSize: Number(e.target.value),
                  }))
                }
              />
              <span>{currentGeom.fontSize}%</span>

              <span style={{ fontWeight: 500 }}>Max characters</span>
              <input
                type="range"
                min={1}
                max={60}
                step={1}
                value={maxLength}
                onChange={(e) => setMaxLength(Number(e.target.value))}
              />
              <span>{maxLength}</span>

              {shape === "curved" && (
                <>
                  <span style={{ fontWeight: 500 }}>Start angle</span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={currentGeom.startAngle}
                    onChange={(e) =>
                      updateGeom((g) => ({
                        ...g,
                        startAngle: Number(e.target.value),
                      }))
                    }
                  />
                  <span>{Math.round(currentGeom.startAngle)}°</span>

                  <span style={{ fontWeight: 500 }}>Arc length</span>
                  <input
                    type="range"
                    min={10}
                    max={360}
                    step={1}
                    value={currentGeom.arcLength}
                    onChange={(e) =>
                      updateGeom((g) => ({
                        ...g,
                        arcLength: Number(e.target.value),
                      }))
                    }
                  />
                  <span>{Math.round(currentGeom.arcLength)}°</span>
                </>
              )}
            </div>

            {!linked && (
              <s-paragraph>
                <s-text tone="neutral">
                  Positioning{" "}
                  {FONT_CHOICES.find((f) => f.value === fontChoice)?.label}{" "}
                  right now — switch the dropdown above to position the other
                  font.
                </s-text>
              </s-paragraph>
            )}

            <label>
              Preview text (not saved — just for you to see the font/curve while
              placing it)
              <input
                type="text"
                value={previewText}
                maxLength={maxLength}
                onChange={(e) => setPreviewText(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  maxWidth: 320,
                  marginTop: "0.25rem",
                }}
                placeholder="Type sample text…"
              />
            </label>

            <div
              style={{ border: "1px solid #e1e1e1", display: "inline-block" }}
            >
              {EngravingCanvas ? (
                <EngravingCanvas
                  image={image}
                  shape={shape}
                  geometry={currentGeom}
                  displayWidth={displayWidth}
                  displayHeight={displayHeight}
                  scale={scale}
                  previewText={previewText}
                  fontFamily={
                    (fontChoice === "one"
                      ? zoneFetcher.data?.shopFonts?.fontOne?.familyName
                      : zoneFetcher.data?.shopFonts?.fontTwo?.familyName) ??
                    FONT_CHOICES.find((f) => f.value === fontChoice)
                      ?.previewFamily ??
                    FONT_CHOICES[0].previewFamily
                  }
                  fontSize={currentGeom.fontSize}
                  fontsReadyTick={fontsReadyTick}
                  onDragEnd={handleDragEnd}
                  onTransformEnd={handleTransformEnd}
                />
              ) : (
                <div style={{ width: displayWidth, height: displayHeight }} />
              )}
            </div>

            <s-paragraph>
              <s-text tone="neutral">
                {shape === "straight" && currentZoneGeom
                  ? `x: ${currentZoneGeom.x}% · y: ${currentZoneGeom.y}% · width: ${currentZoneGeom.width}% · height: ${currentZoneGeom.height}%`
                  : currentZoneGeom
                    ? `center: ${currentZoneGeom.centerX}%, ${currentZoneGeom.centerY}% · radius: ${currentZoneGeom.radius}%`
                    : ""}
              </s-text>
            </s-paragraph>

            <s-button
              variant="primary"
              onClick={handleSave}
              {...(isSaving ? { loading: true } : {})}
            >
              Save zone
            </s-button>
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="How this works">
        <s-paragraph>
          The zone, font, size, and character limit are saved in a{" "}
          <s-text tone="neutral">
            {METAFIELD_NAMESPACE}.{METAFIELD_KEY}
          </s-text>{" "}
          metafield on the product, so the storefront can reproduce the same
          look and limit regardless of screen size.
        </s-paragraph>
        <s-paragraph>
          Curved mode is for rings: the circle you position is the ring&apos;s
          band, and the customer&apos;s text follows its curve. Type sample text
          above to preview the actual curve while you place it.
        </s-paragraph>
        <s-paragraph>
          Font 1 and Font 2 are uploaded once, store-wide, on the app&apos;s{" "}
          <s-text tone="neutral">Font settings</s-text> page. By default they
          share one position — turn off &quot;Use the same position for both
          fonts&quot; above if one font needs its own box or curve (a wider
          script versus a compact sans, say) to sit well. Whichever font a
          customer picks on the storefront, that font&apos;s own position is
          what shows up.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
