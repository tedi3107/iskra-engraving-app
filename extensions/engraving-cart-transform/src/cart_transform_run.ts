import type {
  CartTransformRunInput,
  CartTransformRunResult,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

// Line item properties are customer-controlled (anyone can POST
// /cart/add.js with any properties), and Shopify rejects a lineUpdate image
// that isn't on its own CDN — which can fail the whole run for the cart. So
// only URLs our upload-preview endpoint could actually have produced are
// used; anything else is ignored and that line keeps its normal image.
const SHOPIFY_CDN_PREFIX = "https://cdn.shopify.com/";

export function isShopifyCdnUrl(value: string): boolean {
  return value.startsWith(SHOPIFY_CDN_PREFIX) && !/\s/.test(value);
}

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  // Only lines the storefront actually attached a captured engraving image
  // to (properties[_Engraved Preview] there, attribute here — same
  // underlying line-item data) need anything done; every other line in the
  // cart is left completely alone.
  const operations = input.cart.lines.flatMap((line) => {
    const url = line.engravedPreview?.value;
    if (!url || !isShopifyCdnUrl(url)) return [];
    return [
      {
        lineUpdate: {
          cartLineId: line.id,
          // The image is on Shopify's own CDN — our upload-preview endpoint
          // stores it there via stagedUploadsCreate + fileCreate.
          image: { url },
        },
      },
    ];
  });

  return operations.length > 0 ? { operations } : NO_CHANGES;
}
