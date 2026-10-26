import { describe, expect, it } from "vitest";
import { loadStorefrontCore } from "../../app/test-utils/load-storefront-core";

const core = loadStorefrontCore();

describe("imageIdentity", () => {
  it("treats CDN/size variants of the same photo as one identity", () => {
    const a = core.imageIdentity("https://cdn.shopify.com/s/files/1/0/files/Ring_Gold.jpg?v=123&width=800");
    const b = core.imageIdentity("//shop.example/cdn/shop/files/Ring_Gold_1946x.jpg?v=9");
    const c = core.imageIdentity("/cdn/shop/files/ring_gold_800x800_crop_center.jpg");
    expect(a).toBe("ring_gold.jpg");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("decodes URI-encoded names and handles empty input", () => {
    expect(core.imageIdentity("/files/Prsten%20Zlato.png")).toBe("prsten zlato.png");
    expect(core.imageIdentity("/files/bad%E0%A4%A.png")).toBe("bad%e0%a4%a.png");
    expect(core.imageIdentity("")).toBe("");
  });
});

describe("parseObjectPosition", () => {
  it.each([
    ["", { x: 0.5, y: 0.5 }],
    ["center", { x: 0.5, y: 0.5 }],
    ["top", { x: 0.5, y: 0 }],
    ["right", { x: 1, y: 0.5 }],
    ["25% 75%", { x: 0.25, y: 0.75 }],
    ["left bottom", { x: 0, y: 1 }],
    ["10px 20px", { x: 0.5, y: 0.5 }],
  ])("%s", (raw, expected) => {
    expect(core.parseObjectPosition(raw)).toEqual(expected);
  });
});

describe("computeCrop", () => {
  const center = { x: 0.5, y: 0.5 };

  it("fill stretches each axis, no offset", () => {
    expect(core.computeCrop(1000, 500, 400, 400, "fill", center)).toEqual({
      naturalW: 1000, naturalH: 500, scaleX: 0.4, scaleY: 0.8, offsetX: 0, offsetY: 0,
    });
  });

  it("cover scales uniformly and crops the overflow evenly", () => {
    const crop = core.computeCrop(1000, 500, 400, 400, "cover", center);
    expect(crop.scaleX).toBe(0.8);
    expect(crop.scaleY).toBe(0.8);
    expect(crop.offsetX).toBe(200); // (1000*0.8 - 400) / 2
    expect(crop.offsetY).toBe(0);
  });

  it("contain letterboxes (negative offset centers the image)", () => {
    const crop = core.computeCrop(1000, 500, 400, 400, "contain", center);
    expect(crop.scaleX).toBe(0.4);
    expect(crop.offsetY).toBe(-100); // (500*0.4 - 400) / 2
  });

  it("honours object-position and returns null without sizes", () => {
    expect(core.computeCrop(1000, 500, 400, 400, "cover", { x: 0, y: 0 }).offsetX).toBe(0);
    expect(core.computeCrop(0, 500, 400, 400, "cover", center)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("keeps the previous output for the default $ format", () => {
    expect(core.formatMoney(12000, "${{amount}}")).toBe("$120.00");
    expect(core.formatMoney(12000, "")).toBe("$120.00");
  });

  it("supports Shopify money_format placeholders", () => {
    expect(core.formatMoney(123456789, "${{amount}}")).toBe("$1,234,567.89");
    expect(core.formatMoney(1234500, "{{amount_no_decimals}} RSD")).toBe("12,345 RSD");
    expect(core.formatMoney(1234567, "{{amount_with_comma_separator}} €")).toBe("12.345,67 €");
    expect(core.formatMoney(1234567, "{{ amount_with_space_separator }} kr")).toBe("12 345,67 kr");
    expect(core.formatMoney(1234567, "CHF {{amount_with_apostrophe_separator}}")).toBe("CHF 12'345.67");
  });
});

describe("variant helpers", () => {
  const variants = [
    { id: 1, options: ["Yellow", "6"], available: true, featured_media_id: 11 },
    { id: 2, options: ["Yellow", "7"], available: false, featured_media_id: null },
    { id: 3, options: ["Rose", "6"], available: true, featured_media_id: 13 },
    { id: 4, options: ["Rose", "7"], available: true, featured_media_id: null },
  ];

  it("finds an exact option combination", () => {
    expect(core.findVariantByOptions(variants, ["Rose", "7"]).id).toBe(4);
    expect(core.findVariantByOptions(variants, ["Rose", "9"])).toBeNull();
  });

  it("knows which option values are in stock given prior selections", () => {
    expect(core.optionValueHasStock(variants, 1, "7", ["Yellow", null])).toBe(false);
    expect(core.optionValueHasStock(variants, 1, "7", ["Rose", null])).toBe(true);
    expect(core.optionValueHasStock(variants, 0, "Rose", [null, null])).toBe(true);
  });

  it("picks the closest variant when switching one option", () => {
    // switching to Rose while size 7 is selected keeps size 7
    expect(core.findVariantWithOption(variants, 0, "Rose", ["Yellow", "7"]).id).toBe(4);
    // with nothing else matching, prefers a variant that has its own photo
    expect(core.findVariantWithOption(variants, 0, "Rose", ["Yellow", "9"]).id).toBe(3);
  });
});

describe("colors", () => {
  it("toHex / hexToRgb01 / highlightFromBase", () => {
    expect(core.toHex({ r: 150, g: 115, b: 31 })).toBe("#96731f");
    expect(core.toHex({ r: 300, g: -5, b: 0 })).toBe("#ff0000");
    expect(core.hexToRgb01("#ffffff")).toEqual([1, 1, 1]);
    expect(core.hexToRgb01("nope")).toEqual([0.588, 0.451, 0.122]);
    expect(core.highlightFromBase([1, 0, 0.5])).toEqual([1, 0.65, 0.825]);
  });
});
