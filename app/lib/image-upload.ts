// Pure helpers for the storefront preview upload (apps.engraving.upload-preview).
// Kept free of server/runtime imports so they can be unit tested.

export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024; // the storefront sends ~0.2–1 MB JPEGs

export type PreviewImageType = "image/jpeg" | "image/png" | "image/webp";

const EXTENSIONS: Record<PreviewImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Decides the type from the file's own leading bytes ("magic numbers"),
// never from the client-supplied Content-Type / filename, so a non-image
// (HTML, SVG with script, executable…) can't be stored as a "preview".
export function detectImageType(bytes: Uint8Array): PreviewImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  return null;
}

export function extensionFor(type: PreviewImageType): string {
  return EXTENSIONS[type];
}

const MEDIA_IMAGE_GID = /^gid:\/\/shopify\/MediaImage\/\d+$/;

export function isMediaImageGid(id: unknown): id is string {
  return typeof id === "string" && MEDIA_IMAGE_GID.test(id);
}
