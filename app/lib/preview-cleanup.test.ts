import { describe, expect, it } from "vitest";
import {
  cleanupWindow,
  planPreviewCleanup,
  previewFileName,
  referencedPreviewNames,
  type CandidateFile,
} from "./preview-cleanup";

const NOW = new Date("2026-10-27T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const cdn = (name: string) => `https://cdn.shopify.com/s/files/1/0000/0001/files/${name}?v=1761234567`;
const file = (id: number, name: string, ageDays: number): CandidateFile => ({
  id: `gid://shopify/MediaImage/${id}`,
  url: cdn(name),
  createdAt: daysAgo(ageDays),
});

describe("previewFileName", () => {
  it("normalizes CDN URLs to a lower-case file name", () => {
    expect(previewFileName(cdn("Engraving-Preview-1.JPG"))).toBe("engraving-preview-1.jpg");
    expect(previewFileName("/files/engraving%20preview.png#x")).toBe("engraving preview.png");
    expect(previewFileName(null)).toBeNull();
    expect(previewFileName("https://cdn.shopify.com/")).toBeNull();
  });
});

describe("cleanupWindow", () => {
  it("is 30–55 days before now", () => {
    const { start, end } = cleanupWindow(NOW);
    expect(start.toISOString()).toBe(daysAgo(55));
    expect(end.toISOString()).toBe(daysAgo(30));
  });
});

describe("planPreviewCleanup", () => {
  const files = [
    file(1, "engraving-preview-1.jpg", 40), // unreferenced, in window → delete
    file(2, "engraving-preview-2.jpg", 40), // used by an order → keep
    file(3, "engraving-preview-3.jpg", 10), // too recent (could be in a cart) → keep
    file(4, "engraving-preview-4.jpg", 70), // older than we can verify → keep
    file(5, "ring-photo.jpg", 40), // not a preview → ignored
    { id: "gid://shopify/MediaImage/6", url: null, createdAt: daysAgo(40) }, // still processing → ignored
    file(7, "engraving-preview-7.jpg", 30.5), // just inside window → delete
    file(8, "engraving-preview-8.jpg", 29.9), // just outside → keep
  ];
  const plan = planPreviewCleanup(files, new Set(["engraving-preview-2.jpg"]), NOW);

  it("only deletes unreferenced previews inside the safety window", () => {
    expect(plan.deletable.map((d) => d.id)).toEqual([
      "gid://shopify/MediaImage/1",
      "gid://shopify/MediaImage/7",
    ]);
  });

  it("accounts for every preview file", () => {
    expect(plan).toMatchObject({ previewFiles: 6, referenced: 1, tooRecent: 2, tooOldToVerify: 1 });
    expect(plan.previewFiles).toBe(
      plan.deletable.length + plan.referenced + plan.tooRecent + plan.tooOldToVerify,
    );
  });

  it("treats an unparseable date as too recent (never deletes it)", () => {
    const odd = planPreviewCleanup(
      [{ id: "x", url: cdn("engraving-preview-9.jpg"), createdAt: "not a date" }],
      new Set(),
      NOW,
    );
    expect(odd.deletable).toEqual([]);
    expect(odd.tooRecent).toBe(1);
  });
});

describe("referencedPreviewNames", () => {
  it("reads only the _Engraved Preview property", () => {
    expect(
      referencedPreviewNames([
        [
          { key: "Engraving", value: "MN" },
          { key: "_Engraved Preview", value: cdn("engraving-preview-2.jpg") },
        ],
        [{ key: "_Engraved Preview", value: "https://evil.example/x.jpg" }],
        [{ key: "Note", value: cdn("engraving-preview-3.jpg") }],
        [{ key: "_Engraved Preview", value: null }],
      ]),
    ).toEqual(["engraving-preview-2.jpg"]);
  });
});
