import { describe, expect, it } from "vitest";
import { deleteFiles, scanPreviewFiles } from "./preview-cleanup.server";

const NOW = new Date("2026-10-27T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const url = (name: string) => `https://cdn.shopify.com/s/files/1/0/files/${name}?v=1`;

type Call = { query: string; variables?: Record<string, unknown> };

// Fake admin client: routes by operation name and serves scripted pages.
function fakeAdmin(pages: { files: unknown[]; orders: unknown[]; deletes?: unknown[] }) {
  const calls: Call[] = [];
  const queue = { files: [...pages.files], orders: [...pages.orders], deletes: [...(pages.deletes ?? [])] };
  return {
    calls,
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      calls.push({ query, variables: options?.variables });
      const key = query.includes("PreviewCleanupFiles")
        ? "files"
        : query.includes("PreviewCleanupOrders")
          ? "orders"
          : "deletes";
      const data = queue[key].shift();
      return new Response(JSON.stringify({ data }));
    },
  };
}

const filesPage = (nodes: unknown[], hasNextPage = false) => ({
  files: { nodes, pageInfo: { hasNextPage, endCursor: hasNextPage ? "next" : null } },
});
const ordersPage = (orders: Array<{ previews: string[]; more?: boolean }>, hasNextPage = false) => ({
  orders: {
    nodes: orders.map((o) => ({
      lineItems: {
        pageInfo: { hasNextPage: !!o.more },
        nodes: o.previews.map((p) => ({ customAttributes: [{ key: "_Engraved Preview", value: url(p) }] })),
      },
    })),
    pageInfo: { hasNextPage, endCursor: hasNextPage ? "next" : null },
  },
});
const mediaImage = (id: number, name: string, age: number) => ({
  id: `gid://shopify/MediaImage/${id}`,
  createdAt: daysAgo(age),
  image: { url: url(name) },
});

describe("scanPreviewFiles", () => {
  it("follows pagination for files and orders and keeps previews used by orders", async () => {
    const admin = fakeAdmin({
      files: [
        filesPage([mediaImage(1, "engraving-preview-1.jpg", 40)], true),
        filesPage([mediaImage(2, "engraving-preview-2.jpg", 41)]),
      ],
      orders: [ordersPage([{ previews: [] }], true), ordersPage([{ previews: ["engraving-preview-2.jpg"] }])],
    });
    const scan = await scanPreviewFiles(admin, NOW);
    expect(scan.complete).toBe(true);
    expect(scan.ordersScanned).toBe(2);
    expect(scan.plan.deletable.map((d) => d.id)).toEqual(["gid://shopify/MediaImage/1"]);
    expect(scan.plan.referenced).toBe(1);
  });

  it("asks for orders of every status within the window", async () => {
    const admin = fakeAdmin({ files: [filesPage([])], orders: [ordersPage([])] });
    await scanPreviewFiles(admin, NOW);
    const orderQuery = admin.calls.find((c) => c.query.includes("PreviewCleanupOrders"))!.variables!.query;
    expect(orderQuery).toContain(`created_at:>='${daysAgo(55)}'`);
    expect(orderQuery).toContain("status:open OR status:closed OR status:cancelled");
  });

  it("reports an incomplete scan when an order has more line items than were read", async () => {
    const admin = fakeAdmin({
      files: [filesPage([mediaImage(1, "engraving-preview-1.jpg", 40)])],
      orders: [ordersPage([{ previews: [], more: true }])],
    });
    expect((await scanPreviewFiles(admin, NOW)).complete).toBe(false);
  });

  it("retries when Shopify throttles", async () => {
    let first = true;
    const admin = {
      graphql: async (query: string) => {
        if (first) {
          first = false;
          return new Response(JSON.stringify({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }));
        }
        return new Response(JSON.stringify({ data: query.includes("Files") ? filesPage([]) : ordersPage([]) }));
      },
    };
    expect((await scanPreviewFiles(admin, NOW)).complete).toBe(true);
  }, 10_000);

  it("surfaces non-throttling API errors (e.g. missing read_orders)", async () => {
    const admin = {
      graphql: async (query: string) =>
        new Response(
          JSON.stringify(
            query.includes("Files")
              ? { data: filesPage([]) }
              : { errors: [{ message: "Access denied for orders field. Required access: `read_orders`." }] },
          ),
        ),
    };
    await expect(scanPreviewFiles(admin, NOW)).rejects.toThrow(/read_orders/);
  });
});

describe("deleteFiles", () => {
  it("deletes in batches of 50 and collects user errors", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `gid://shopify/MediaImage/${i}`);
    const admin = fakeAdmin({
      files: [],
      orders: [],
      deletes: [
        { fileDelete: { deletedFileIds: ids.slice(0, 50), userErrors: [] } },
        { fileDelete: { deletedFileIds: ids.slice(50, 100), userErrors: [] } },
        { fileDelete: { deletedFileIds: ids.slice(100, 119), userErrors: [{ message: "File is in use" }] } },
      ],
    });
    const result = await deleteFiles(admin, ids);
    expect(admin.calls.map((c) => (c.variables!.fileIds as string[]).length)).toEqual([50, 50, 20]);
    expect(result).toEqual({ deleted: 119, errors: ["File is in use"] });
  });
});
