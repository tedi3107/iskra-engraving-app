// Server-side check of the engraving rules the storefront already enforces
// (the product zone's maxLength and uppercaseOnly from the Position
// designer). The storefront can be bypassed — /cart/add.js accepts any
// properties — so checkout re-checks them here.
//
// Types are declared locally (matching src/cart_validations_generate_run.graphql)
// so this file type-checks without the generated schema types.

type Zone = { maxLength?: unknown; uppercaseOnly?: unknown } | null | undefined;

export type CartValidationsGenerateRunInput = {
  cart: {
    lines: Array<{
      id: string;
      engraving?: { value?: string | null } | null;
      merchandise: {
        __typename?: string;
        product?: { zone?: { jsonValue?: unknown } | null } | null;
      };
    }>;
  };
};

export type ValidationError = { message: string; target: string };

export type CartValidationsGenerateRunResult = {
  operations: Array<{ validationAdd: { errors: ValidationError[] } }>;
};

const CART_TARGET = "$.cart";

/** Pure rule check for one engraving against its product's zone. */
export function engravingErrors(text: string, zone: Zone): string[] {
  if (!text || !zone || typeof zone !== "object") return [];
  const errors: string[] = [];

  const maxLength = Number(zone.maxLength);
  // Code points, not UTF-16 units: the storefront input counts units, so
  // this is never stricter than what a customer could actually type.
  if (Number.isInteger(maxLength) && maxLength > 0 && Array.from(text).length > maxLength) {
    errors.push(`Engraving "${text}" is too long — the maximum is ${maxLength} characters.`);
  }
  if (zone.uppercaseOnly === true && text !== text.toUpperCase()) {
    errors.push(`Engraving "${text}" must be in capital letters.`);
  }
  return errors;
}

export function cartValidationsGenerateRun(
  input: CartValidationsGenerateRunInput,
): CartValidationsGenerateRunResult {
  const messages = new Set<string>();
  for (const line of input.cart.lines) {
    const text = line.engraving?.value;
    const zone = line.merchandise.product?.zone?.jsonValue as Zone;
    if (!text) continue;
    for (const message of engravingErrors(text, zone)) messages.add(message);
  }

  if (messages.size === 0) return { operations: [] };
  return {
    operations: [
      {
        validationAdd: {
          errors: [...messages].map((message) => ({ message, target: CART_TARGET })),
        },
      },
    ],
  };
}
