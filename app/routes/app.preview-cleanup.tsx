import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { deleteFiles, scanPreviewFiles } from "../preview-cleanup.server";
import { MAX_AGE_DAYS, MIN_AGE_DAYS } from "../lib/preview-cleanup";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const PERMISSION_HINT =
  "The app needs permission to read orders. Approve the app's updated permissions (Shopify asks when the app is opened), then try again.";

// "check" only reports. "delete" scans again on the server and deletes what
// that fresh scan finds — the browser never chooses which files go.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const intent = (await request.formData()).get("intent");

  let scan;
  try {
    scan = await scanPreviewFiles(admin);
  } catch (error) {
    const message = String(error);
    return {
      intent,
      error: /access|permission|scope|denied|read_orders/i.test(message) ? PERMISSION_HINT : message,
    };
  }

  const summary = {
    previewFiles: scan.plan.previewFiles,
    referenced: scan.plan.referenced,
    tooRecent: scan.plan.tooRecent,
    tooOldToVerify: scan.plan.tooOldToVerify,
    deletable: scan.plan.deletable.length,
    sample: scan.plan.deletable.slice(0, 8).map((d) => d.fileName),
    ordersScanned: scan.ordersScanned,
    complete: scan.complete,
  };

  if (intent !== "delete") return { intent: "check" as const, summary };

  if (!scan.complete) {
    return {
      intent: "delete" as const,
      summary,
      error: "The scan couldn't cover everything (very large store or order), so nothing was deleted.",
    };
  }
  const result = await deleteFiles(admin, scan.plan.deletable.map((d) => d.id));
  return { intent: "delete" as const, summary, result };
};

export default function PreviewCleanup() {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;
  const summary = data && "summary" in data ? data.summary : undefined;
  const result = data && "result" in data ? data.result : undefined;
  const error = data && "error" in data ? data.error : undefined;

  const submit = (intent: "check" | "delete") => fetcher.submit({ intent }, { method: "post" });

  return (
    <s-page heading="Preview image cleanup">
      <s-section heading="Unused engraving previews">
        <s-paragraph>
          Every time a customer adds an engraved item, the app stores a preview
          image in your Files. Most belong to carts that never became orders.
          This removes those, and never touches a preview that an order uses.
        </s-paragraph>
        <s-paragraph>
          <s-text tone="neutral">
            Only previews {MIN_AGE_DAYS}–{MAX_AGE_DAYS} days old are removed.
            Newer ones may still be in a customer&apos;s cart, and for older ones
            Shopify doesn&apos;t let the app see whether an order (older than 60
            days) uses them, so they&apos;re kept. Running this every few weeks
            keeps Files tidy.
          </s-text>
        </s-paragraph>

        <s-stack direction="inline" gap="base">
          <s-button onClick={() => submit("check")} {...(busy ? { loading: true } : {})}>
            Check
          </s-button>
          {summary && summary.deletable > 0 && summary.complete && (
            <s-button
              tone="critical"
              onClick={() => submit("delete")}
              {...(busy ? { loading: true } : {})}
            >
              {`Delete ${summary.deletable} unused preview${summary.deletable === 1 ? "" : "s"}`}
            </s-button>
          )}
        </s-stack>
      </s-section>

      {error && (
        <s-section>
          <s-banner tone="critical">{error}</s-banner>
        </s-section>
      )}

      {result && (
        <s-section>
          <s-banner tone={result.errors.length ? "warning" : "success"}>
            {`Deleted ${result.deleted} preview image${result.deleted === 1 ? "" : "s"}.`}
            {result.errors.length > 0 && ` Some couldn't be deleted: ${result.errors[0]}`}
          </s-banner>
        </s-section>
      )}

      {summary && !result && (
        <s-section heading="Scan result">
          <s-unordered-list>
            <s-list-item>{`${summary.previewFiles} preview images in the ${MIN_AGE_DAYS}–${MAX_AGE_DAYS} day range checked`}</s-list-item>
            <s-list-item>{`${summary.referenced} used by orders — kept`}</s-list-item>
            <s-list-item>{`${summary.deletable} not used by any order — can be deleted`}</s-list-item>
            <s-list-item>{`${summary.ordersScanned} orders checked`}</s-list-item>
          </s-unordered-list>
          {!summary.complete && (
            <s-banner tone="warning">
              The scan couldn&apos;t cover everything (very large store or
              order), so deleting is disabled.
            </s-banner>
          )}
          {summary.sample.length > 0 && (
            <s-paragraph>
              <s-text tone="neutral">{`For example: ${summary.sample.join(", ")}`}</s-text>
            </s-paragraph>
          )}
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
