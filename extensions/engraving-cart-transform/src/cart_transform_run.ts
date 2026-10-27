import type {
  CartTransformRunInput,
  CartTransformRunResult,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

// Line item properties are customer-controlled, and a lineUpdate image that
// isn't on Shopify's CDN can fail the whole run. Only URLs our upload
// endpoint can produce are used; other lines keep their normal image.
const SHOPIFY_CDN_PREFIX = "https://cdn.shopify.com/";

export function isShopifyCdnUrl(value: string): boolean {
  return value.startsWith(SHOPIFY_CDN_PREFIX) && !/\s/.test(value);
}

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  // Only lines with a captured engraving image (properties[_Engraved Preview]
  // on the storefront, an attribute here) are changed.
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
