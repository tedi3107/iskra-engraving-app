import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

// One-off admin utility: cartTransformCreate has to be called once per shop
// (not once per app), so every new store installation needs this same
// activation step. This page runs it through the shop's own authenticated
// admin session — whichever store this route is opened from — instead of
// requiring a separate GraphiQL/CLI session tied to a specific dev store.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query ExistingCartTransforms {
        shop {
          myshopifyDomain
        }
        cartTransforms(first: 5) {
          nodes {
            id
            functionId
            blockOnFailure
          }
        }
      }`,
  );
  const json = await response.json();

  return {
    shopDomain: json.data?.shop?.myshopifyDomain as string,
    existing: (json.data?.cartTransforms?.nodes ?? []) as {
      id: string;
      functionId: string;
      blockOnFailure: boolean;
    }[],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") ?? "activate";

  if (intent === "deactivate") {
    const id = formData.get("id");
    if (typeof id !== "string" || !id) {
      return { error: "Missing cart transform id." };
    }
    const response = await admin.graphql(
      `#graphql
        mutation DeactivateCartTransform($id: ID!) {
          cartTransformDelete(id: $id) {
            deletedId
            userErrors { field message }
          }
        }`,
      { variables: { id } },
    );
    const json = await response.json();
    const errors = json.data?.cartTransformDelete?.userErrors as
      { field: string[]; message: string }[] | undefined;
    if (errors?.length) {
      return { error: errors[0].message, intent: "deactivate" as const };
    }
    return {
      success: true,
      intent: "deactivate" as const,
      deletedId: json.data?.cartTransformDelete?.deletedId as string,
    };
  }

  const response = await admin.graphql(
    `#graphql
      mutation ActivateCartTransform($functionHandle: String!, $blockOnFailure: Boolean!) {
        cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: $blockOnFailure) {
          cartTransform { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        functionHandle: "engraving-cart-transform",
        blockOnFailure: false,
      },
    },
  );
  const json = await response.json();
  const errors = json.data?.cartTransformCreate?.userErrors as
    { field: string[]; message: string }[] | undefined;
  const cartTransformId = json.data?.cartTransformCreate?.cartTransform?.id as
    string | undefined;

  if (errors?.length) {
    return { error: errors[0].message, intent: "activate" as const };
  }
  return {
    success: true,
    intent: "activate" as const,
    cartTransformId,
  };
};

export default function SetupCartTransform() {
  const loaderFetcher = useFetcher<typeof loader>();
  const activateFetcher = useFetcher<typeof action>();
  const deactivateFetcher = useFetcher<typeof action>();

  useEffect(() => {
    loaderFetcher.load("/app/setup-cart-transform");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check status after either action settles, so the list of existing
  // transforms (and the activate/deactivate buttons shown) reflect what
  // actually happened rather than the stale pre-action state.
  useEffect(() => {
    if (activateFetcher.data?.success || deactivateFetcher.data?.success) {
      loaderFetcher.load("/app/setup-cart-transform");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateFetcher.data, deactivateFetcher.data]);

  const data = loaderFetcher.data;
  const isChecking = loaderFetcher.state !== "idle";
  const isActivating = activateFetcher.state !== "idle";
  const isDeactivating = deactivateFetcher.state !== "idle";
  const existing = data?.existing ?? [];
  const alreadyActive = existing.length > 0;

  return (
    <s-page heading="Cart Transform setup">
      <s-section heading="Cart transform for this store">
        <s-paragraph>
          This has to be run once per store install — it's what lets the
          engraved preview image show up at checkout. It's safe to open this
          page again later; it won't create a duplicate if one already exists.
        </s-paragraph>

        {isChecking && <s-paragraph>Checking current status…</s-paragraph>}

        {data && (
          <div
            style={{
              background: "#f6f6f7",
              borderRadius: 6,
              padding: "0.75rem 1rem",
              margin: "0.75rem 0",
            }}
          >
            <p style={{ margin: 0, fontSize: "0.9em" }}>
              Store: <strong>{data.shopDomain}</strong>
            </p>
            <p style={{ margin: "0.4rem 0 0", fontSize: "0.9em" }}>
              {alreadyActive
                ? `Active (${existing.length} cart transform${existing.length > 1 ? "s" : ""} found).`
                : "Not active yet on this store."}
            </p>
          </div>
        )}

        {!alreadyActive && (
          <button
            type="button"
            disabled={isChecking || isActivating}
            onClick={() => activateFetcher.submit({}, { method: "post" })}
            style={{
              border: "none",
              borderRadius: 6,
              background: "#202020",
              color: "white",
              padding: "0.6rem 1.2rem",
              cursor: isChecking || isActivating ? "default" : "pointer",
            }}
          >
            {isActivating ? "Activating…" : "Activate cart transform"}
          </button>
        )}

        {alreadyActive &&
          existing.map((ct) => (
            <div
              key={ct.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
                border: "1px solid #e1e1e1",
                borderRadius: 6,
                padding: "0.6rem 0.75rem",
                marginBottom: "0.5rem",
              }}
            >
              <span style={{ fontSize: "0.85em", fontFamily: "monospace" }}>
                {ct.id}
              </span>
              <button
                type="button"
                disabled={isChecking || isDeactivating}
                onClick={() =>
                  deactivateFetcher.submit(
                    { intent: "deactivate", id: ct.id },
                    { method: "post" },
                  )
                }
                style={{
                  border: "1px solid #b3261e",
                  borderRadius: 4,
                  background: "white",
                  color: "#b3261e",
                  padding: "0.35rem 0.75rem",
                  cursor: isChecking || isDeactivating ? "default" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {isDeactivating ? "Deactivating…" : "Deactivate"}
              </button>
            </div>
          ))}

        {activateFetcher.data?.error && (
          <p style={{ color: "#b3261e" }}>{activateFetcher.data.error}</p>
        )}
        {activateFetcher.data?.success && (
          <p style={{ color: "#0f7b0f" }}>
            Activated — {activateFetcher.data.cartTransformId}.
          </p>
        )}
        {deactivateFetcher.data?.error && (
          <p style={{ color: "#b3261e" }}>{deactivateFetcher.data.error}</p>
        )}
        {deactivateFetcher.data?.success && (
          <p style={{ color: "#0f7b0f" }}>
            Deactivated — {deactivateFetcher.data.deletedId}.
          </p>
        )}
      </s-section>

      <s-section heading="Also needed: cart drawer & cart page (manual, per theme)">
        <s-paragraph>
          The cart transform above only affects checkout. The cart page and side
          cart drawer are rendered by the theme itself, so each new store's
          theme needs this same small edit — Cart Transform can&apos;t reach
          those templates.
        </s-paragraph>
        <s-paragraph>
          In the theme, find wherever a cart line item&apos;s image is rendered
          — usually a section or snippet named something like{" "}
          <code>main-cart-items.liquid</code> and{" "}
          <code>cart-drawer.liquid</code>, though the exact file/section name
          varies by theme (this store&apos;s theme won&apos;t match the old
          Dawn-based test store exactly — search for where{" "}
          <code>item.image</code> or similar is used). Add a check for the{" "}
          <code>_Engraved Preview</code> line item property before that image,
          falling back to the normal product image when it&apos;s not set:
        </s-paragraph>
        <pre
          style={{
            background: "#1e1e1e",
            color: "#d4d4d4",
            borderRadius: 6,
            padding: "1rem",
            overflowX: "auto",
            fontSize: "0.85em",
            lineHeight: 1.5,
          }}
        >
          {`{% assign engraved_preview = item.properties['_Engraved Preview'] %}
{% if engraved_preview != blank %}
  <img src="{{ engraved_preview }}" alt="{{ item.product.title }}" width="60" height="60">
{% elsif item.image %}
  <img src="{{ item.image | image_url: width: 120 }}" alt="{{ item.product.title }}">
{% else %}
  {%- comment -%}existing no-image placeholder, unchanged{%- endcomment -%}
{% endif %}`}
        </pre>
        <s-paragraph>
          <s-text tone="neutral">
            Note the variable is <code>item</code> here (cart context), not{" "}
            <code>line</code> — that name is specific to the order confirmation
            email template, which uses a separate Liquid context and was already
            handled for the first store.
          </s-text>
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="About deactivating">
        <s-paragraph>
          Deactivating stops the engraved preview from showing at checkout for
          new orders on this store. It doesn&apos;t affect orders already
          placed, and can be turned back on any time by activating again.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
