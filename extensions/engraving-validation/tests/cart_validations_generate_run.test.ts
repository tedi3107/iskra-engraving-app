import { describe, expect, it } from "vitest";
import {
  cartValidationsGenerateRun,
  engravingErrors,
  type CartValidationsGenerateRunInput,
} from "../src/cart_validations_generate_run";

const zone = (maxLength: number, uppercaseOnly = false) => ({ maxLength, uppercaseOnly });

function line(text: string | null, z: unknown, id = "gid://shopify/CartLine/1") {
  return {
    id,
    engraving: text === null ? null : { value: text },
    merchandise: { __typename: "ProductVariant", product: { zone: z === null ? null : { jsonValue: z } } },
  };
}

const run = (...lines: CartValidationsGenerateRunInput["cart"]["lines"]) =>
  cartValidationsGenerateRun({ cart: { lines } });

describe("engravingErrors", () => {
  it("accepts text within the limit", () => {
    expect(engravingErrors("MARIJA", zone(12))).toEqual([]);
    expect(engravingErrors("123456789012", zone(12))).toEqual([]);
  });

  it("rejects text over the limit", () => {
    expect(engravingErrors("1234567890123", zone(12))).toEqual([
      'Engraving "1234567890123" is too long — the maximum is 12 characters.',
    ]);
  });

  it("counts code points, so it is never stricter than the storefront input", () => {
    expect(engravingErrors("😀AB", zone(3))).toEqual([]); // 3 code points, 4 UTF-16 units
  });

  it("enforces uppercase only when the zone asks for it", () => {
    expect(engravingErrors("Marija", zone(12, true))).toEqual(['Engraving "Marija" must be in capital letters.']);
    expect(engravingErrors("MARIJA 2026", zone(12, true))).toEqual([]);
    expect(engravingErrors("Marija", zone(12, false))).toEqual([]);
  });

  it("reports both problems at once", () => {
    expect(engravingErrors("abcdef", zone(3, true))).toHaveLength(2);
  });

  it("ignores missing or malformed zones and empty text", () => {
    expect(engravingErrors("anything at all", null)).toEqual([]);
    expect(engravingErrors("anything", { maxLength: "x" })).toEqual([]);
    expect(engravingErrors("anything", { maxLength: 0 })).toEqual([]);
    expect(engravingErrors("", zone(1))).toEqual([]);
  });
});

describe("cartValidationsGenerateRun", () => {
  it("returns no operations for a valid cart", () => {
    expect(run(line("MN", zone(12)), line(null, zone(1)), line("no zone product", null))).toEqual({
      operations: [],
    });
  });

  it("returns one validationAdd with cart-level errors", () => {
    expect(run(line("TOO LONG TEXT", zone(5)))).toEqual({
      operations: [
        {
          validationAdd: {
            errors: [
              { message: 'Engraving "TOO LONG TEXT" is too long — the maximum is 5 characters.', target: "$.cart" },
            ],
          },
        },
      ],
    });
  });

  it("de-duplicates identical errors from repeated lines", () => {
    const result = run(line("abc", zone(2), "gid://shopify/CartLine/1"), line("abc", zone(2), "gid://shopify/CartLine/2"));
    expect(result.operations[0].validationAdd.errors).toHaveLength(1);
  });

  it("ignores non-product merchandise", () => {
    expect(
      run({ id: "gid://shopify/CartLine/9", engraving: { value: "x".repeat(99) }, merchandise: { __typename: "CustomProduct" } }),
    ).toEqual({ operations: [] });
  });
});
