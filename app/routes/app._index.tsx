import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { safeJsonParse } from "../lib/zone";

// Home: a status overview of everything the engraving flow depends on, with
// links to the page that fixes each item.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query EngravingStatus {
        shop {
          name
          fonts: metafield(namespace: "engraving", key: "fonts") { value }
        }
        cartTransforms(first: 5) {
          nodes { id }
        }
      }`,
  );
  const json = await response.json();
  const fonts = (safeJsonParse(json.data?.shop?.fonts?.value) ?? {}) as {
    fontOne?: { familyName?: string };
    fontTwo?: { familyName?: string };
  };

  return {
    shopName: (json.data?.shop?.name as string | undefined) ?? "",
    cartTransformActive: (json.data?.cartTransforms?.nodes ?? []).length > 0,
    fontOne: fonts.fontOne?.familyName ?? null,
    fontTwo: fonts.fontTwo?.familyName ?? null,
  };
};

function StatusRow({
  ok,
  title,
  detail,
  href,
  action,
}: {
  ok: boolean;
  title: string;
  detail: string;
  href: string;
  action: string;
}) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-badge tone={ok ? "success" : "warning"}>{ok ? "Ready" : "Action needed"}</s-badge>
        <s-stack direction="block" gap="small-200">
          <s-text type="strong">{title}</s-text>
          <s-text tone="neutral">{detail}</s-text>
        </s-stack>
        <s-link href={href}>{action}</s-link>
      </s-stack>
    </s-box>
  );
}

export default function Index() {
  const { shopName, cartTransformActive, fontOne, fontTwo } = useLoaderData<typeof loader>();
  const fontsReady = Boolean(fontOne && fontTwo);

  return (
    <s-page heading="Jewelry engraving">
      <s-section heading={shopName ? `Status for ${shopName}` : "Status"}>
        <s-stack direction="block" gap="base">
          <StatusRow
            ok={fontsReady}
            title="Engraving fonts"
            detail={
              fontsReady
                ? `Font 1: ${fontOne} · Font 2: ${fontTwo}`
                : `Font 1: ${fontOne ?? "not set"} · Font 2: ${fontTwo ?? "not set"}`
            }
            href="/app/font-settings"
            action="Font settings"
          />
          <StatusRow
            ok={cartTransformActive}
            title="Engraved image at checkout"
            detail={
              cartTransformActive
                ? "The cart transform is active on this store."
                : "The cart transform is not active yet."
            }
            href="/app/setup-cart-transform"
            action="Setup"
          />
        </s-stack>
      </s-section>

      <s-section heading="Getting a product ready">
        <s-ordered-list>
          <s-list-item>
            Upload Font 1 and Font 2 in <s-link href="/app/font-settings">Font settings</s-link>.
          </s-list-item>
          <s-list-item>
            Place the engraving zone for a product in the{" "}
            <s-link href="/app/position-designer">Position designer</s-link>.
          </s-list-item>
          <s-list-item>
            In the theme editor, add the <s-text type="strong">Engraving preview</s-text> block to
            the product template. Optionally enable the{" "}
            <s-text type="strong">Engraved images in cart</s-text> app embed.
          </s-list-item>
        </s-ordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
