import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function load() {
  const path = fileURLToPath(new URL("../../extensions/engraving-preview/assets/cart-engraving-images.js", import.meta.url));
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function("module", "exports", readFileSync(path, "utf8"))(mod, mod.exports);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mod.exports as any;
}
const api = load();

describe("previewsFromCart", () => {
  it("maps engraved lines to 1-based row indexes and keys", () => {
    const cart = {
      items: [
        { key: "a:1", properties: {} },
        { key: "b:2", properties: { Engraving: "MN", "_Engraved Preview": "https://cdn.shopify.com/s/files/x.jpg" } },
        { key: "c:3", properties: null },
      ],
    };
    expect(api.previewsFromCart(cart)).toEqual([
      { index: 2, key: "b:2", url: "https://cdn.shopify.com/s/files/x.jpg" },
    ]);
  });

  it("ignores URLs that are not on Shopify's CDN", () => {
    const cart = { items: [{ key: "a", properties: { "_Engraved Preview": "javascript:alert(1)" } }] };
    expect(api.previewsFromCart(cart)).toEqual([]);
    expect(api.previewsFromCart(null)).toEqual([]);
  });
});
