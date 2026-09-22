import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

const METAFIELD_NAMESPACE = "engraving";
const METAFIELD_KEY = "fonts";
const FONT_EXTENSIONS = [".woff2", ".woff", ".ttf", ".otf"];

export type StoredFont = {
  familyName: string;
  fallback: "sans-serif" | "serif";
  url: string;
};
type StoredFonts = { fontOne?: StoredFont; fontTwo?: StoredFont };

export type LibraryFont = {
  id: string;
  url: string;
  suggestedName: string;
};

function isFontUrl(url: string) {
  const withoutQuery = url.split("?")[0].toLowerCase();
  return FONT_EXTENSIONS.some((ext) => withoutQuery.endsWith(ext));
}

// Shopify CDN file URLs keep the originally-uploaded filename (Shopify
// appends its own hash before the extension), so splitting on "/" and
// trimming that hash gives a readable suggested name without us having to
// store one separately.
function suggestNameFromUrl(url: string) {
  const last = url.split("?")[0].split("/").pop() ?? "font";
  const withoutExt = last.replace(/\.[^.]+$/, "");
  const withoutHash = withoutExt.replace(/_[a-f0-9]{8,}$/i, "");
  return withoutHash.replace(/[_-]+/g, " ").trim() || "Untitled font";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query GetShopFontsAndFiles {
        shop {
          metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
            value
          }
        }
        files(first: 50, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              ... on GenericFile {
                url
                fileStatus
              }
            }
          }
        }
      }`,
  );
  const json = await response.json();
  const value = json.data?.shop?.metafield?.value as string | undefined;
  const fonts: StoredFonts = value ? JSON.parse(value) : {};

  const fileEdges = json.data?.files?.edges ?? [];
  const libraryFonts: LibraryFont[] = fileEdges
    .map((edge: any) => edge.node)
    .filter(
      (node: any) =>
        node?.fileStatus === "READY" && node?.url && isFontUrl(node.url),
    )
    .map((node: any) => ({
      id: node.id,
      url: node.url,
      suggestedName: suggestNameFromUrl(node.url),
    }));

  return {
    fontOne: fonts.fontOne ?? null,
    fontTwo: fonts.fontTwo ?? null,
    libraryFonts,
  };
};

async function saveFontToSlot(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  slot: "one" | "two",
  font: StoredFont,
) {
  const shopResponse = await admin.graphql(
    `#graphql
      query ShopAndFonts {
        shop {
          id
          metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") { value }
        }
      }`,
  );
  const shopJson = await shopResponse.json();
  const shopId = shopJson.data?.shop?.id;
  const existing: StoredFonts = shopJson.data?.shop?.metafield?.value
    ? JSON.parse(shopJson.data.shop.metafield.value)
    : {};

  const updated: StoredFonts = {
    ...existing,
    [slot === "one" ? "fontOne" : "fontTwo"]: font,
  };

  await admin.graphql(
    `#graphql
      mutation SaveShopFonts($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: METAFIELD_NAMESPACE,
            key: METAFIELD_KEY,
            type: "json",
            value: JSON.stringify(updated),
          },
        ],
      },
    },
  );
}

async function removeFontFromSlot(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  slot: "one" | "two",
) {
  const shopResponse = await admin.graphql(
    `#graphql
      query ShopAndFonts {
        shop {
          id
          metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") { value }
        }
      }`,
  );
  const shopJson = await shopResponse.json();
  const shopId = shopJson.data?.shop?.id;
  const existing: StoredFonts = shopJson.data?.shop?.metafield?.value
    ? JSON.parse(shopJson.data.shop.metafield.value)
    : {};

  const updated: StoredFonts = { ...existing };
  delete updated[slot === "one" ? "fontOne" : "fontTwo"];

  await admin.graphql(
    `#graphql
      mutation SaveShopFonts($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: METAFIELD_NAMESPACE,
            key: METAFIELD_KEY,
            type: "json",
            value: JSON.stringify(updated),
          },
        ],
      },
    },
  );
}

// Uploading a font file to Shopify (rather than linking to one hosted
// elsewhere) is a three-step dance: ask for somewhere to put it
// (stagedUploadsCreate), put it there, then tell Shopify to adopt it as a
// permanent file (fileCreate). Only after that do we know its final CDN URL,
// which is what actually gets saved.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") ?? "upload";
  const slot = formData.get("slot");

  if (slot !== "one" && slot !== "two") {
    return { error: "Invalid font slot." };
  }

  if (intent === "remove") {
    await removeFontFromSlot(admin, slot);
    return { success: true, slot, removed: true };
  }

  if (intent === "pickExisting") {
    const familyName = formData.get("familyName");
    const fallback = formData.get("fallback");
    const url = formData.get("url");
    if (typeof familyName !== "string" || !familyName.trim()) {
      return { error: "Give this font a name first." };
    }
    if (fallback !== "sans-serif" && fallback !== "serif") {
      return { error: "Invalid fallback type." };
    }
    if (typeof url !== "string" || !url) {
      return { error: "Choose a font from the list first." };
    }
    await saveFontToSlot(admin, slot, {
      familyName: familyName.trim(),
      fallback,
      url,
    });
    return { success: true, slot };
  }

  // intent === "upload" (default, kept for backward compatibility)
  const familyName = formData.get("familyName");
  const fallback = formData.get("fallback");
  const file = formData.get("file");

  if (typeof familyName !== "string" || !familyName.trim()) {
    return { error: "Give this font a name first." };
  }
  if (fallback !== "sans-serif" && fallback !== "serif") {
    return { error: "Invalid fallback type." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a font file first." };
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
            filename: file.name,
            mimeType: file.type || "font/woff2",
            httpMethod: "POST",
            resource: "FILE",
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
    return {
      error: stagedErrors?.[0]?.message ?? "Could not prepare the upload.",
    };
  }

  const uploadForm = new FormData();
  for (const p of target.parameters) uploadForm.append(p.name, p.value);
  uploadForm.append("file", file);
  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: uploadForm,
  });
  if (!uploadRes.ok) {
    return { error: "The font file failed to upload — please try again." };
  }

  const fileCreateResponse = await admin.graphql(
    `#graphql
      mutation CreateFile($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            ... on GenericFile { url }
          }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        files: [{ originalSource: target.resourceUrl, contentType: "FILE" }],
      },
    },
  );
  const fileJson = await fileCreateResponse.json();
  const fileErrors = fileJson.data?.fileCreate?.userErrors;
  let createdFile = fileJson.data?.fileCreate?.files?.[0] as
    { id: string; fileStatus: string; url?: string } | undefined;
  if (fileErrors?.length || !createdFile) {
    return { error: fileErrors?.[0]?.message ?? "Could not save font file." };
  }

  // A GenericFile is usually ready near-instantly, but Shopify processes it
  // asynchronously, so the URL isn't always in the fileCreate response yet.
  // Polling node() a few times (rather than asking the merchant to hit save
  // again) covers that ordinary delay without making it their problem.
  for (let attempt = 0; !createdFile.url && attempt < 6; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pollResponse = await admin.graphql(
      `#graphql
        query PollFile($id: ID!) {
          node(id: $id) {
            ... on GenericFile { url fileStatus }
          }
        }`,
      { variables: { id: createdFile.id } },
    );
    const pollJson = await pollResponse.json();
    const polled = pollJson.data?.node as {
      url?: string;
      fileStatus?: string;
    } | null;
    if (polled?.url) createdFile = { ...createdFile, url: polled.url };
    if (polled?.fileStatus === "FAILED") break;
  }

  if (!createdFile.url) {
    return {
      error:
        "Shopify is still processing this file — please try saving again in a moment.",
    };
  }

  await saveFontToSlot(admin, slot, {
    familyName: familyName.trim(),
    fallback,
    url: createdFile.url,
  });

  return { success: true, slot };
};

function FontSlot({
  slot,
  current,
  libraryFonts,
}: {
  slot: "one" | "two";
  current: StoredFont | null;
  libraryFonts: LibraryFont[];
}) {
  const fetcher = useFetcher<typeof action>();
  const [familyName, setFamilyName] = useState("");
  // Fallback is no longer merchant-facing, but the storefront's font-family
  // CSS still expects one on every stored font, so it's fixed here rather
  // than removed from the data shape.
  const fallback = "sans-serif" as const;
  const [dragOver, setDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSaving = fetcher.state !== "idle";

  // A slot occupied by an existing font is locked against new uploads or
  // library picks until it's explicitly cleared — this avoids silently
  // overwriting a font that's already in use on the storefront.
  const isLocked = Boolean(current) && !isSaving;

  const upload = (file: File) => {
    setPendingFile(file);
    const fd = new FormData();
    fd.append("intent", "upload");
    fd.append("slot", slot);
    fd.append("familyName", familyName || file.name.replace(/\.[^.]+$/, ""));
    fd.append("fallback", fallback);
    fd.append("file", file);
    fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  };

  const pickExisting = (libFont: LibraryFont) => {
    const fd = new FormData();
    fd.append("intent", "pickExisting");
    fd.append("slot", slot);
    fd.append("familyName", familyName || libFont.suggestedName);
    fd.append("fallback", fallback);
    fd.append("url", libFont.url);
    fetcher.submit(fd, { method: "post" });
    setShowLibrary(false);
  };

  const removeCurrent = () => {
    const fd = new FormData();
    fd.append("intent", "remove");
    fd.append("slot", slot);
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <div
      style={{
        border: "1px solid #e1e1e1",
        borderRadius: 8,
        padding: "1rem",
        flex: 1,
      }}
    >
      <h3 style={{ marginTop: 0 }}>{slot === "one" ? "Font 1" : "Font 2"}</h3>

      {current && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            background: "#f6f6f7",
            borderRadius: 6,
            padding: "0.6rem 0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          <span style={{ fontSize: "0.9em" }}>
            Currently: <strong>{current.familyName}</strong>
          </span>
          <button
            type="button"
            onClick={removeCurrent}
            disabled={isSaving}
            style={{
              border: "1px solid #c4c4c4",
              borderRadius: 4,
              background: "white",
              padding: "0.25rem 0.6rem",
              cursor: isSaving ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {isSaving && fetcher.formData?.get("intent") === "remove"
              ? "Removing…"
              : "Remove font"}
          </button>
        </div>
      )}

      {isLocked ? (
        <p
          style={{
            fontSize: "0.9em",
            color: "#8a6d00",
            background: "#fff8e5",
            padding: "0.6rem 0.75rem",
            borderRadius: 6,
          }}
        >
          To add a different font here, remove the current one first.
        </p>
      ) : (
        <>
          <label style={{ display: "block", marginBottom: "0.5rem" }}>
            Name this font
            <input
              type="text"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="e.g. Avenue de Madison"
              style={{ display: "block", width: "100%", marginTop: "0.2rem" }}
            />
          </label>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) upload(file);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            style={{
              border: `2px dashed ${dragOver ? "#202020" : "#c4c4c4"}`,
              borderRadius: 6,
              padding: "1.5rem",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver ? "#f6f6f7" : "transparent",
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".woff,.woff2,.ttf,.otf"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
              }}
            />
            {isSaving && pendingFile ? (
              <span>Uploading {pendingFile.name}…</span>
            ) : (
              <span>
                Drag a .woff2/.woff/.ttf/.otf file here, or click to choose one
              </span>
            )}
          </div>

          <div
            style={{
              textAlign: "center",
              margin: "0.5rem 0",
              color: "#8a8a8a",
              fontSize: "0.85em",
            }}
          >
            or
          </div>

          {!showLibrary ? (
            <button
              type="button"
              onClick={() => setShowLibrary(true)}
              disabled={libraryFonts.length === 0}
              style={{
                width: "100%",
                border: "1px solid #c4c4c4",
                borderRadius: 6,
                background: "white",
                padding: "0.6rem",
                cursor: libraryFonts.length === 0 ? "default" : "pointer",
                color: libraryFonts.length === 0 ? "#a0a0a0" : "inherit",
              }}
            >
              {libraryFonts.length === 0
                ? "No font files already in this store's Files"
                : `Choose from Files already in this store (${libraryFonts.length})`}
            </button>
          ) : (
            <div style={{ border: "1px solid #e1e1e1", borderRadius: 6 }}>
              {libraryFonts.map((libFont) => (
                <div
                  key={libFont.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    padding: "0.5rem 0.75rem",
                    borderBottom: "1px solid #f0f0f0",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.9em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {libFont.suggestedName}
                  </span>
                  <button
                    type="button"
                    onClick={() => pickExisting(libFont)}
                    disabled={isSaving}
                    style={{
                      border: "1px solid #202020",
                      borderRadius: 4,
                      background: "#202020",
                      color: "white",
                      padding: "0.25rem 0.6rem",
                      cursor: isSaving ? "default" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Use this
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setShowLibrary(false)}
                style={{
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  padding: "0.5rem",
                  cursor: "pointer",
                  color: "#8a8a8a",
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}

      {fetcher.data?.error && (
        <p style={{ color: "#b3261e", marginBottom: 0 }}>
          {fetcher.data.error}
        </p>
      )}
      {fetcher.data?.success && !fetcher.data?.removed && (
        <p style={{ color: "#0f7b0f", marginBottom: 0 }}>Saved.</p>
      )}
    </div>
  );
}

export default function FontSettings() {
  const fetcher = useFetcher<typeof loader>();
  const data = fetcher.data;
  useEffect(() => {
    fetcher.load("/app/font-settings");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <s-page heading="Font settings">
      <s-section heading="Custom engraving fonts">
        <s-paragraph>
          Upload the two fonts customers can choose between when personalizing a
          product. These apply store-wide — each product&apos;s engraving zone
          (Position Designer) just picks Font 1 or Font 2.
        </s-paragraph>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            marginTop: "1rem",
          }}
        >
          <FontSlot
            slot="one"
            current={data?.fontOne ?? null}
            libraryFonts={data?.libraryFonts ?? []}
          />
          <FontSlot
            slot="two"
            current={data?.fontTwo ?? null}
            libraryFonts={data?.libraryFonts ?? []}
          />
        </div>
      </s-section>

      <s-section slot="aside" heading="How this works">
        <s-paragraph>
          Uploaded files are stored as Shopify Files (visible under Settings →
          Files in your admin) and referenced by the storefront via a normal CSS{" "}
          <s-text tone="neutral">@font-face</s-text> rule — no theme font-picker
          involved, so any font file you own works, not just Shopify&apos;s
          built-in library.
        </s-paragraph>
        <s-paragraph>
          Already uploaded a font file for something else? Use &quot;Choose from
          Files already in this store&quot; instead of uploading it again — it
          lists the 50 most recently added font files (.woff2/.woff/.ttf/.otf)
          from your Files library.
        </s-paragraph>
        <s-paragraph>
          A slot with a font in it is locked — remove the current font first if
          you want to replace it. This keeps you from accidentally overwriting a
          font that&apos;s already live on the storefront.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
