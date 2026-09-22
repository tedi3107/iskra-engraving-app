import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Storefront JS has no Shopify Admin credentials, so it can't upload a file
// itself — this route is what it calls instead. Shopify signs app proxy
// requests, and authenticate.public.appProxy verifies that signature and
// hands back an admin client scoped to whichever shop actually made the
// request, without the customer needing to be logged into the app at all.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  if (!admin) {
    return Response.json(
      { error: "Could not verify this request." },
      { status: 401 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "No image provided." }, { status: 400 });
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
            filename: `engraving-preview-${Date.now()}.${file.type === "image/jpeg" ? "jpg" : "png"}`,
            mimeType: file.type || "image/png",
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
    return Response.json(
      { error: stagedErrors?.[0]?.message ?? "Could not prepare the upload." },
      { status: 500 },
    );
  }

  const uploadForm = new FormData();
  for (const p of target.parameters) uploadForm.append(p.name, p.value);
  uploadForm.append("file", file);
  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: uploadForm,
  });
  if (!uploadRes.ok) {
    return Response.json(
      { error: "The image failed to upload." },
      { status: 500 },
    );
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
  let createdFile = fileJson.data?.fileCreate?.files?.[0] as
    { id: string; fileStatus: string; image?: { url: string } } | undefined;
  if (fileErrors?.length || !createdFile) {
    return Response.json(
      { error: fileErrors?.[0]?.message ?? "Could not save the image." },
      { status: 500 },
    );
  }

  // A MediaImage is usually ready almost instantly, but Shopify processes it
  // asynchronously, so the URL isn't always in the fileCreate response yet.
  // Polling node() a few times covers that ordinary delay instead of making
  // the customer retry adding to cart.
  for (let attempt = 0; !createdFile.image?.url && attempt < 8; attempt++) {
    await new Promise((resolve) =>
      setTimeout(resolve, attempt < 3 ? 300 : 1000),
    );
    const pollResponse = await admin.graphql(
      `#graphql
        query PollFile($id: ID!) {
          node(id: $id) {
            ... on MediaImage { image { url } }
          }
        }`,
      { variables: { id: createdFile.id } },
    );
    const pollJson = await pollResponse.json();
    const polled = pollJson.data?.node as { image?: { url: string } } | null;
    if (polled?.image?.url)
      createdFile = { ...createdFile, image: polled.image };
  }

  if (!createdFile.image?.url) {
    return Response.json(
      { error: "Image is still processing." },
      { status: 202 },
    );
  }

  return Response.json({ url: createdFile.image.url });
};
