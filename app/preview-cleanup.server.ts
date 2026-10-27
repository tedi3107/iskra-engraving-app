import {
  cleanupWindow,
  planPreviewCleanup,
  referencedPreviewNames,
  type CandidateFile,
  type CleanupPlan,
} from "./lib/preview-cleanup";

type GraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const MAX_FILE_PAGES = 40; // 40 × 250 files
const MAX_ORDER_PAGES = 250; // 250 × 20 orders
const ORDERS_PER_PAGE = 20;
const LINE_ITEMS_PER_ORDER = 40; // keeps each query well under the cost limit
const DELETE_BATCH = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One GraphQL call with a few retries when Shopify throttles the app.
async function gql<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  admin: GraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let throttled = false;
    try {
      const response = await admin.graphql(query, { variables });
      const json = await response.json();
      const errors = (json.errors ?? []) as Array<{ message: string; extensions?: { code?: string } }>;
      throttled = errors.some((e) => e.extensions?.code === "THROTTLED");
      if (!throttled) {
        if (errors.length > 0) throw new Error(errors[0].message);
        return json.data as T;
      }
    } catch (error) {
      if (!/throttl/i.test(String(error))) throw error;
      throttled = true;
    }
    if (attempt >= 4) throw new Error("Shopify is busy right now — please try again in a minute.");
    await sleep(1000 * (attempt + 1));
  }
}

const isoDate = (d: Date) => d.toISOString();

async function listCandidateFiles(admin: GraphqlClient, start: Date, end: Date) {
  const files: CandidateFile[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_FILE_PAGES; page++) {
    const data: {
      files: {
        nodes: Array<{ id: string; createdAt: string; image?: { url: string } | null }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await gql(
      admin,
      `#graphql
        query PreviewCleanupFiles($after: String, $query: String) {
          files(first: 250, after: $after, query: $query, sortKey: CREATED_AT) {
            nodes {
              id
              createdAt
              ... on MediaImage { image { url } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      // Narrows the scan; planPreviewCleanup re-checks dates and names itself.
      { after, query: `created_at:>='${isoDate(start)}' created_at:<='${isoDate(end)}'` },
    );
    for (const node of data.files.nodes) {
      files.push({ id: node.id, createdAt: node.createdAt, url: node.image?.url ?? null });
    }
    if (!data.files.pageInfo.hasNextPage) return { files, complete: true };
    after = data.files.pageInfo.endCursor;
  }
  return { files, complete: false };
}

async function collectReferencedNames(admin: GraphqlClient, since: Date) {
  const names = new Set<string>();
  let ordersScanned = 0;
  let after: string | null = null;
  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    const data: {
      orders: {
        nodes: Array<{
          lineItems: {
            pageInfo: { hasNextPage: boolean };
            nodes: Array<{ customAttributes: Array<{ key: string; value: string | null }> }>;
          };
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await gql(
      admin,
      `#graphql
        query PreviewCleanupOrders($after: String, $query: String, $lineItems: Int!, $first: Int!) {
          orders(first: $first, after: $after, query: $query) {
            nodes {
              lineItems(first: $lineItems) {
                pageInfo { hasNextPage }
                nodes { customAttributes { key value } }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      {
        after,
        first: ORDERS_PER_PAGE,
        lineItems: LINE_ITEMS_PER_ORDER,
        // Every status explicitly — fulfilled orders are usually "closed".
        query: `created_at:>='${isoDate(since)}' AND (status:open OR status:closed OR status:cancelled)`,
      },
    );
    for (const order of data.orders.nodes) {
      ordersScanned++;
      // An order with more line items than we read could hide a reference.
      if (order.lineItems.pageInfo.hasNextPage) return { names, ordersScanned, complete: false };
      for (const name of referencedPreviewNames(order.lineItems.nodes.map((li) => li.customAttributes))) {
        names.add(name);
      }
    }
    if (!data.orders.pageInfo.hasNextPage) return { names, ordersScanned, complete: true };
    after = data.orders.pageInfo.endCursor;
  }
  return { names, ordersScanned, complete: false };
}

export type CleanupScan = {
  plan: CleanupPlan;
  ordersScanned: number;
  complete: boolean;
  windowStart: string;
  windowEnd: string;
};

export async function scanPreviewFiles(admin: GraphqlClient, now = new Date()): Promise<CleanupScan> {
  const { start, end } = cleanupWindow(now);
  const files = await listCandidateFiles(admin, start, end);
  const orders = await collectReferencedNames(admin, start);
  return {
    plan: planPreviewCleanup(files.files, orders.names, now),
    ordersScanned: orders.ordersScanned,
    complete: files.complete && orders.complete,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

export async function deleteFiles(admin: GraphqlClient, ids: string[]) {
  let deleted = 0;
  const errors: string[] = [];
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const data: {
      fileDelete: { deletedFileIds: string[] | null; userErrors: Array<{ message: string }> } | null;
    } = await gql(
      admin,
      `#graphql
        mutation PreviewCleanupDelete($fileIds: [ID!]!) {
          fileDelete(fileIds: $fileIds) {
            deletedFileIds
            userErrors { field message }
          }
        }`,
      { fileIds: ids.slice(i, i + DELETE_BATCH) },
    );
    deleted += data.fileDelete?.deletedFileIds?.length ?? 0;
    for (const e of data.fileDelete?.userErrors ?? []) errors.push(e.message);
  }
  return { deleted, errors };
}
