import type {
  CartTransformRunInput,
  CartTransformRunResult,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  // Only lines the storefront actually attached a captured engraving image
  // to (properties[_Engraved Preview] there, attribute here — same
  // underlying line-item data) need anything done; every other line in the
  // cart is left completely alone.
  const operations = input.cart.lines
    .filter((line) => line.engravedPreview?.value)
    .map((line) => ({
      lineUpdate: {
        cartLineId: line.id,
        // The image must already be on Shopify's own CDN — which it is,
        // since our upload-preview endpoint stores it there via
        // stagedUploadsCreate + fileCreate. A URL from anywhere else would
        // be rejected with invalid_image_url.
        image: {
          url: line.engravedPreview!.value!,
        },
      },
    }));

  return operations.length > 0 ? { operations } : NO_CHANGES;
}
