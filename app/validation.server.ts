// The engraving validation (extensions/engraving-validation) has to be
// activated once per shop with validationCreate. New installs get it in
// afterAuth; the Setup page shows its status and can (de)activate it.

export const VALIDATION_FUNCTION_HANDLE = "engraving-validation";
export const VALIDATION_TITLE = "Engraving length and capitals";

type GraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type EngravingValidation = { id: string; enabled: boolean };

export async function findEngravingValidation(
  admin: GraphqlClient,
): Promise<EngravingValidation | null> {
  const response = await admin.graphql(
    `#graphql
      query EngravingValidationStatus {
        validations(first: 25) {
          nodes {
            id
            enabled
            shopifyFunction { handle }
          }
        }
      }`,
  );
  const json = await response.json();
  const nodes = (json.data?.validations?.nodes ?? []) as Array<{
    id: string;
    enabled: boolean;
    shopifyFunction?: { handle?: string | null } | null;
  }>;
  const ours = nodes.find((n) => n.shopifyFunction?.handle === VALIDATION_FUNCTION_HANDLE);
  return ours ? { id: ours.id, enabled: ours.enabled } : null;
}

export async function createEngravingValidation(admin: GraphqlClient): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
      mutation EngravingValidationCreate($validation: ValidationCreateInput!) {
        validationCreate(validation: $validation) {
          validation { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        validation: {
          functionHandle: VALIDATION_FUNCTION_HANDLE,
          title: VALIDATION_TITLE,
          enable: true,
          // Fail open: if the function itself errors, checkout proceeds.
          blockOnFailure: false,
        },
      },
    },
  );
  const json = await response.json();
  const errors = json.data?.validationCreate?.userErrors ?? [];
  if (errors.length > 0) return errors[0].message as string;
  if (!json.data?.validationCreate?.validation) return "Could not activate the validation.";
  return null;
}

export async function deleteEngravingValidation(admin: GraphqlClient, id: string): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
      mutation EngravingValidationDelete($id: ID!) {
        validationDelete(id: $id) {
          deletedId
          userErrors { field message }
        }
      }`,
    { variables: { id } },
  );
  const json = await response.json();
  const errors = json.data?.validationDelete?.userErrors ?? [];
  if (errors.length > 0) return errors[0].message as string;
  return null;
}

/** Idempotent: creates the validation only if this shop doesn't have it yet. */
export async function ensureEngravingValidation(admin: GraphqlClient): Promise<void> {
  if (await findEngravingValidation(admin)) return;
  const error = await createEngravingValidation(admin);
  if (error) throw new Error(`validationCreate failed: ${error}`);
}
