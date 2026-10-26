import { describe, expect, it } from "vitest";
import { cartTransformRun, isShopifyCdnUrl } from "../src/cart_transform_run";

const URL_1 = "https://cdn.shopify.com/s/files/1/0000/0000/files/engraving-preview-1.jpg";

function line(id: string, value?: string | null) {
  return {
    id,
    quantity: 1,
    engravedPreview: value === undefined ? null : { value },
  };
}

describe("cartTransformRun", () => {
  it("returns no operations for an empty cart", () => {
    expect(cartTransformRun({ cart: { lines: [] } })).toEqual({ operations: [] });
  });

  it("leaves lines without an engraved preview alone", () => {
    const result = cartTransformRun({
      cart: { lines: [line("gid://shopify/CartLine/1"), line("gid://shopify/CartLine/2", "")] },
    });
    expect(result).toEqual({ operations: [] });
  });

  it("swaps the image of a line that carries an engraved preview", () => {
    const result = cartTransformRun({
      cart: { lines: [line("gid://shopify/CartLine/1", URL_1)] },
    });
    expect(result).toEqual({
      operations: [
        { lineUpdate: { cartLineId: "gid://shopify/CartLine/1", image: { url: URL_1 } } },
      ],
    });
  });

  it("only touches engraved lines in a mixed cart", () => {
    const result = cartTransformRun({
      cart: {
        lines: [
          line("gid://shopify/CartLine/1"),
          line("gid://shopify/CartLine/2", URL_1),
          line("gid://shopify/CartLine/3", null),
        ],
      },
    });
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      lineUpdate: { cartLineId: "gid://shopify/CartLine/2" },
    });
  });
});

describe("untrusted preview URLs", () => {
  it("ignores URLs that are not on Shopify's CDN", () => {
    const result = cartTransformRun({
      cart: {
        lines: [
          line("gid://shopify/CartLine/1", "https://evil.example.com/x.jpg"),
          line("gid://shopify/CartLine/2", "http://cdn.shopify.com/x.jpg"),
          line("gid://shopify/CartLine/3", "https://cdn.shopify.com.evil.com/x.jpg"),
          line("gid://shopify/CartLine/4", "javascript:alert(1)"),
        ],
      },
    });
    expect(result).toEqual({ operations: [] });
  });

  it("still transforms the valid lines of a cart that also has a bad one", () => {
    const result = cartTransformRun({
      cart: {
        lines: [
          line("gid://shopify/CartLine/1", "https://evil.example.com/x.jpg"),
          line("gid://shopify/CartLine/2", URL_1),
        ],
      },
    });
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      lineUpdate: { cartLineId: "gid://shopify/CartLine/2" },
    });
  });

  it("isShopifyCdnUrl", () => {
    expect(isShopifyCdnUrl(URL_1)).toBe(true);
    expect(isShopifyCdnUrl("https://cdn.shopify.com/a b.jpg")).toBe(false);
    expect(isShopifyCdnUrl("")).toBe(false);
  });
});
