// Pure rules for cleaning up engraving preview images that no order uses.
// Every preview upload creates a file in the shop's Files; most belong to
// carts that never became orders.
//
// Safety window: only files 30–55 days old are ever deleted.
// - Younger files may still sit in an active cart or checkout.
// - read_orders only shows the last 60 days of orders. A preview's order is
//   always placed after the preview was uploaded, so for a file at most 55
//   days old any order using it is still visible and can be checked.

export const PREVIEW_FILE_PREFIX = "engraving-preview-";
export const MIN_AGE_DAYS = 30;
export const MAX_AGE_DAYS = 55;
export const PREVIEW_PROPERTY = "_Engraved Preview";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lower-cased file name of a Shopify CDN URL, without query or fragment. */
export function previewFileName(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url.split(/[?#]/)[0];
  let name = path.slice(path.lastIndexOf("/") + 1);
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw name if it isn't valid URI encoding
  }
  return name ? name.toLowerCase() : null;
}

export function isPreviewFileName(name: string | null): name is string {
  return !!name && name.startsWith(PREVIEW_FILE_PREFIX);
}

export function cleanupWindow(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS),
    end: new Date(now.getTime() - MIN_AGE_DAYS * DAY_MS),
  };
}

export type CandidateFile = { id: string; url: string | null; createdAt: string };

export type CleanupPlan = {
  previewFiles: number;
  tooRecent: number;
  tooOldToVerify: number;
  referenced: number;
  deletable: Array<{ id: string; fileName: string; createdAt: string }>;
};

export function planPreviewCleanup(
  files: CandidateFile[],
  referencedNames: Set<string>,
  now: Date,
): CleanupPlan {
  const { start, end } = cleanupWindow(now);
  const plan: CleanupPlan = {
    previewFiles: 0,
    tooRecent: 0,
    tooOldToVerify: 0,
    referenced: 0,
    deletable: [],
  };

  for (const file of files) {
    const fileName = previewFileName(file.url);
    if (!isPreviewFileName(fileName)) continue;
    plan.previewFiles++;

    const created = new Date(file.createdAt);
    if (Number.isNaN(created.getTime()) || created > end) {
      plan.tooRecent++;
    } else if (created < start) {
      plan.tooOldToVerify++;
    } else if (referencedNames.has(fileName)) {
      plan.referenced++;
    } else {
      plan.deletable.push({ id: file.id, fileName, createdAt: file.createdAt });
    }
  }
  return plan;
}

/** Preview file names referenced by an order's line item properties. */
export function referencedPreviewNames(
  lineItemAttributes: Array<Array<{ key: string; value?: string | null }>>,
): string[] {
  const names: string[] = [];
  for (const attributes of lineItemAttributes) {
    for (const { key, value } of attributes) {
      if (key !== PREVIEW_PROPERTY) continue;
      const name = previewFileName(value);
      if (isPreviewFileName(name)) names.push(name);
    }
  }
  return names;
}
