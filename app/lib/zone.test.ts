import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRAIGHT_GEOMETRY,
  DEFAULT_ZONE,
  isDegenerate,
  migrateZone,
  parseZoneInput,
  toPercentGeometry,
  toPixelGeometry,
  type FontGeometry,
  type Zone,
} from "./zone";

const image = { width: 800, height: 400 };

describe("migrateZone", () => {
  it("falls back to the default zone for empty / non-object input", () => {
    expect(migrateZone(null)).toBe(DEFAULT_ZONE);
    expect(migrateZone(undefined)).toBe(DEFAULT_ZONE);
    expect(migrateZone("nope")).toBe(DEFAULT_ZONE);
  });

  it("coerces a missing uppercaseOnly to false on current-format zones", () => {
    const current = {
      shape: "straight",
      linked: true,
      fontOne: DEFAULT_STRAIGHT_GEOMETRY,
      fontTwo: DEFAULT_STRAIGHT_GEOMETRY,
      fontChoice: "two",
      maxLength: 12,
    };
    const zone = migrateZone(current);
    expect(zone.uppercaseOnly).toBe(false);
    expect(zone.fontChoice).toBe("two");
    expect(zone.maxLength).toBe(12);
  });

  it("keeps uppercaseOnly: true when it is already saved", () => {
    const zone = migrateZone({ ...DEFAULT_ZONE, uppercaseOnly: true });
    expect(zone.uppercaseOnly).toBe(true);
  });

  it("lifts a legacy flat zone into linked fontOne/fontTwo", () => {
    const legacy = {
      shape: "curved",
      fontChoice: "one",
      maxLength: 18,
      x: 10,
      y: 20,
      width: 30,
      height: 10,
      centerX: 55,
      centerY: 45,
      radius: 22,
      startAngle: 180,
      arcLength: 120,
      fontSize: 50,
    };
    const zone = migrateZone(legacy);
    expect(zone.shape).toBe("curved");
    expect(zone.linked).toBe(true);
    expect(zone.uppercaseOnly).toBe(false);
    expect(zone.fontOne).toEqual(zone.fontTwo);
    expect(zone.fontOne).toMatchObject({
      centerX: 55,
      centerY: 45,
      radius: 22,
      startAngle: 180,
      arcLength: 120,
      fontSize: 50,
    });
  });

  it("fills geometry fields missing from a legacy zone with defaults", () => {
    const zone = migrateZone({ shape: "straight", fontChoice: "one", maxLength: 10, x: 5 });
    expect(zone.fontOne.x).toBe(5);
    expect(zone.fontOne.width).toBe(DEFAULT_STRAIGHT_GEOMETRY.width);
    expect(zone.fontOne.fontSize).toBe(DEFAULT_STRAIGHT_GEOMETRY.fontSize);
  });
});

describe("isDegenerate", () => {
  const base: FontGeometry = { ...DEFAULT_STRAIGHT_GEOMETRY };

  it("straight: width or height <= 0 is degenerate", () => {
    expect(isDegenerate("straight", { ...base, width: 0 })).toBe(true);
    expect(isDegenerate("straight", { ...base, height: -1 })).toBe(true);
    expect(isDegenerate("straight", base)).toBe(false);
  });

  it("curved: only radius matters", () => {
    expect(isDegenerate("curved", { ...base, radius: 0 })).toBe(true);
    expect(isDegenerate("curved", { ...base, width: 0, radius: 5 })).toBe(false);
  });
});

describe("pixel <-> percent geometry", () => {
  it("converts percentages to pixels using the right axis for each field", () => {
    const px = toPixelGeometry(
      { ...DEFAULT_STRAIGHT_GEOMETRY, x: 25, y: 50, width: 50, height: 10, centerX: 50, centerY: 50, radius: 25 },
      image,
    );
    expect(px.x).toBe(200);
    expect(px.y).toBe(200);
    expect(px.width).toBe(400);
    expect(px.height).toBe(40);
    expect(px.centerX).toBe(400);
    expect(px.centerY).toBe(200);
    // radius is a percentage of image WIDTH (matches the storefront)
    expect(px.radius).toBe(200);
  });

  it("round-trips within the 0.1% rounding the save step applies", () => {
    const saved: FontGeometry = {
      x: 12.3,
      y: 45.6,
      width: 33.3,
      height: 14.1,
      centerX: 51.2,
      centerY: 48.8,
      radius: 21.7,
      startAngle: 200,
      arcLength: 140,
      fontSize: 55,
    };
    expect(toPercentGeometry(toPixelGeometry(saved, image), image)).toEqual(saved);
  });

  it("rounds angles to whole degrees and percentages to one decimal", () => {
    const out = toPercentGeometry(
      { ...DEFAULT_STRAIGHT_GEOMETRY, x: 100 / 3, startAngle: 10.6, arcLength: 99.4 },
      { width: 100, height: 100 },
    );
    expect(out.x).toBe(33.3);
    expect(out.startAngle).toBe(11);
    expect(out.arcLength).toBe(99);
  });

  it("DEFAULT_ZONE is a valid, non-degenerate zone", () => {
    const zone: Zone = DEFAULT_ZONE;
    expect(isDegenerate(zone.shape, zone.fontOne)).toBe(false);
    expect(isDegenerate(zone.shape, zone.fontTwo)).toBe(false);
  });
});

describe("parseZoneInput", () => {
  const valid = {
    shape: "curved",
    linked: false,
    fontOne: { ...DEFAULT_STRAIGHT_GEOMETRY },
    fontTwo: { ...DEFAULT_STRAIGHT_GEOMETRY, fontSize: 40 },
    fontChoice: "two",
    maxLength: 24,
    uppercaseOnly: true,
  };

  it("accepts what the Position designer submits and drops unknown keys", () => {
    const zone = parseZoneInput(JSON.stringify({ ...valid, extra: "<script>" }));
    expect(zone).toEqual(valid);
    expect(zone).not.toHaveProperty("extra");
  });

  it("accepts a zone dragged partly off the image", () => {
    const zone = parseZoneInput(
      JSON.stringify({ ...valid, fontOne: { ...valid.fontOne, x: -12.5, centerX: 104.2 } }),
    );
    expect(zone?.fontOne.x).toBe(-12.5);
  });

  it.each([
    ["not JSON", "{oops"],
    ["wrong shape", JSON.stringify({ ...valid, shape: "wavy" })],
    ["wrong fontChoice", JSON.stringify({ ...valid, fontChoice: "three" })],
    ["non-integer maxLength", JSON.stringify({ ...valid, maxLength: 2.5 })],
    ["maxLength 0", JSON.stringify({ ...valid, maxLength: 0 })],
    ["string number", JSON.stringify({ ...valid, fontOne: { ...valid.fontOne, x: "10" } })],
    ["missing geometry field", JSON.stringify({ ...valid, fontTwo: { x: 1 } })],
    ["degenerate circle", JSON.stringify({ ...valid, fontOne: { ...valid.fontOne, radius: 0 } })],
    ["non-boolean linked", JSON.stringify({ ...valid, linked: "yes" })],
  ])("rejects %s", (_label, input) => {
    expect(parseZoneInput(input)).toBeNull();
  });

  it("round-trips DEFAULT_ZONE", () => {
    expect(parseZoneInput(JSON.stringify(DEFAULT_ZONE))).toEqual(DEFAULT_ZONE);
  });
});
