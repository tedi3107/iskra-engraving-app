// Activating the cart transform is per shop (cartTransformCreate has to run
// once on every store that installs the app). Doing it right after auth
// means a new install works at checkout without the merchant having to find
// the "Setup cart transform" page — that page still exists for status
// checks and manual activate/deactivate.

export const CART_TRANSFORM_FUNCTION_HANDLE = "engraving-cart-transform";

type GraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function ensureCartTransform(admin: GraphqlClient): Promise<void> {
  const existingResponse = await admin.graphql(
    `#graphql
      query EnsureCartTransformExisting {
        cartTransforms(first: 5) {
          nodes { id }
        }
      }`,
  );
  const existing = await existingResponse.json();
  if ((existing.data?.cartTransforms?.nodes ?? []).length > 0) return;

  const createResponse = await admin.graphql(
    `#graphql
      mutation EnsureCartTransformCreate($functionHandle: String!, $blockOnFailure: Boolean!) {
        cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: $blockOnFailure) {
          cartTransform { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        functionHandle: CART_TRANSFORM_FUNCTION_HANDLE,
        blockOnFailure: false,
      },
    },
  );
  const created = await createResponse.json();
  const errors = created.data?.cartTransformCreate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(`cartTransformCreate failed: ${errors[0].message}`);
  }
}
