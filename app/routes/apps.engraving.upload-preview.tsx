import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { allowRequest } from "../rate-limit.server";
import {
  MAX_PREVIEW_BYTES,
  detectImageType,
  extensionFor,
  isMediaImageGid,
} from "../lib/image-upload";

// Storefront JS has no Shopify Admin credentials, so it can't upload a file
// itself — this route is what it calls instead. Shopify signs app proxy
// requests, and authenticate.public.appProxy verifies that signature and
// hands back an admin client scoped to whichever shop actually made the
// request, without the customer needing to be logged into the app at all.
//
// Because any storefront visitor can reach it, every request is bounded:
// size cap, real image type (magic bytes), and per-shop / per-customer rate
// limits. Responses:
//   200 { url }              — preview stored and ready
//   202 { pending: true, id } — stored, Shopify still processing; poll GET ?id=
//   4xx/5xx { error }         — the storefront adds to cart without a preview

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type AdminClient = NonNullable<Awaited<ReturnType<typeof authenticate.public.appProxy>>["admin"]>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readImageUrl(admin: AdminClient, id: string): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
      query PollFile($id: ID!) {
        node(id: $id) {
          ... on MediaImage { image { url } }
        }
      }`,
    { variables: { id } },
  );
  const body = await response.json();
  const node = body.data?.node as { image?: { url: string } | null } | null;
  return node?.image?.url ?? null;
}

// Status check for a preview that was still processing when POST returned.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) return json({ error: "Could not verify this request." }, 401);

  const id = new URL(request.url).searchParams.get("id");
  if (!isMediaImageGid(id)) return json({ error: "Invalid id." }, 400);

  // admin is scoped to the requesting shop, so another shop's file id simply
  // resolves to nothing here.
  const url = await readImageUrl(admin, id);
  return url ? json({ url }) : json({ pending: true, id }, 202);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.public.appProxy(request);
  if (!admin || !session) {
    return json({ error: "Could not verify this request." }, 401);
  }

  // Cheap rejection before reading the body when the client is honest about size.
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_PREVIEW_BYTES + 64 * 1024) {
    return json({ error: "Image too large." }, 413);
  }

  const params = new URL(request.url).searchParams;
  const shop = session.shop;
  const customerId = params.get("logged_in_customer_id");
  const allowed =
    (await allowRequest(`upload:shop:${shop}:min`, 60, MINUTE)) &&
    (await allowRequest(`upload:shop:${shop}:day`, 3000, DAY)) &&
    (!customerId || (await allowRequest(`upload:customer:${shop}:${customerId}`, 15, MINUTE)));
  if (!allowed) {
    return json({ error: "Too many uploads, please try again shortly." }, 429);
  }

  const formData = await request.formData();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "No image provided." }, 400);
  }
  if (file.size > MAX_PREVIEW_BYTES) {
    return json({ error: "Image too large." }, 413);
  }
  const imageType = detectImageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!imageType) {
    return json({ error: "Unsupported image type." }, 415);
  }

  const stagedResponse = await admin.graphql(
    `#graphql
      mutation StagedUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        input: [
          {
            filename: `engraving-preview-${Date.now()}.${extensionFor(imageType)}`,
            mimeType: imageType,
            httpMethod: "POST",
            resource: "IMAGE",
          },
        ],
      },
    },
  );
  const stagedJson = await stagedResponse.json();
  const stagedErrors = stagedJson.data?.stagedUploadsCreate?.userErrors;
  const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0] as
    | {
        url: string;
        resourceUrl: string;
        parameters: { name: string; value: string }[];
      }
    | undefined;
  if (stagedErrors?.length || !target) {
    return json({ error: stagedErrors?.[0]?.message ?? "Could not prepare the upload." }, 500);
  }

  const uploadForm = new FormData();
  for (const p of target.parameters) uploadForm.append(p.name, p.value);
  uploadForm.append("file", new File([file], `engraving.${extensionFor(imageType)}`, { type: imageType }));
  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: uploadForm,
  });
  if (!uploadRes.ok) {
    return json({ error: "The image failed to upload." }, 500);
  }

  const fileCreateResponse = await admin.graphql(
    `#graphql
      mutation CreateFile($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            ... on MediaImage { image { url } }
          }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        files: [{ originalSource: target.resourceUrl, contentType: "IMAGE" }],
      },
    },
  );
  const fileJson = await fileCreateResponse.json();
  const fileErrors = fileJson.data?.fileCreate?.userErrors;
  const createdFile = fileJson.data?.fileCreate?.files?.[0] as
    | { id: string; fileStatus: string; image?: { url: string } | null }
    | undefined;
  if (fileErrors?.length || !createdFile) {
    return json({ error: fileErrors?.[0]?.message ?? "Could not save the image." }, 500);
  }

  // A MediaImage is usually ready almost instantly, but Shopify processes it
  // asynchronously. Wait briefly here (most uploads finish inside this
  // window); anything slower is handed back as "pending" for the storefront
  // to poll via GET, instead of holding this request open for seconds.
  let url = createdFile.image?.url ?? null;
  for (let attempt = 0; !url && attempt < 4; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 2 ? 300 : 700));
    url = await readImageUrl(admin, createdFile.id);
  }

  return url ? json({ url }) : json({ pending: true, id: createdFile.id }, 202);
};
