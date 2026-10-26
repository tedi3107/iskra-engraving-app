# Server-side engraving validation (to be added)

The storefront enforces the zone's **max characters** and **uppercase only**,
but anyone can call `/cart/add.js` directly with any `Engraving` property. For
a product that is physically engraved, the rule has to hold at checkout too.
That's what a **Cart and Checkout Validation** function is for.

It is not scaffolded in the repo yet because it needs the Shopify CLI logged in
to the app (to generate the extension and its GraphQL schema) and it adds the
`write_validations` scope, which the client has to approve once.

## 1. Generate the extension

```sh
shopify app generate extension --template cart_checkout_validation --flavor vanilla-js --name engraving-validation
```

## 2. Input query (`extensions/engraving-validation/src/cart_validations_generate_run.graphql`)

```graphql
query CartValidationsGenerateRunInput {
  cart {
    lines {
      engraving: attribute(key: "Engraving") { value }
      merchandise {
        ... on ProductVariant {
          product {
            zone: metafield(namespace: "engraving", key: "zone") { jsonValue }
          }
        }
      }
    }
  }
}
```

## 3. Logic (`src/cart_validations_generate_run.js`)

Check the operation/field names against the generated `schema.graphql`. They
follow the 2025-07+ validation API.

```js
export function cartValidationsGenerateRun(input) {
  const errors = [];
  for (const line of input.cart.lines) {
    const text = line.engraving?.value;
    const zone = line.merchandise?.product?.zone?.jsonValue;
    if (!text || !zone) continue;

    const max = Number(zone.maxLength) || 0;
    if (max > 0 && Array.from(text).length > max) {
      errors.push({
        message: `Engraving can be at most ${max} characters.`,
        target: "$.cart",
      });
    }
    if (zone.uppercaseOnly && text !== text.toUpperCase()) {
      errors.push({ message: "Engraving must be in capital letters.", target: "$.cart" });
    }
  }
  return { operations: errors.length ? [{ validationAdd: { errors } }] : [] };
}
```

Note: `toUpperCase()` can lengthen some characters (`ß` → `SS`). The storefront
uppercases as the customer types, so the comparison above stays consistent with
what it sends.

## 4. Scope and activation

1. Add `write_validations` to `scopes` in **both** `shopify.app.toml` and
   `shopify.app.jewelry-engraving-test-app.toml` and deploy. The merchant
   approves the new scope on the next app open.
2. Activate once per shop, the same way the cart transform is activated in
   `app/cart-transform.server.ts`:

```graphql
mutation {
  validationCreate(validation: {
    functionHandle: "engraving-validation"
    enable: true
    blockOnFailure: false
  }) {
    validation { id }
    userErrors { field message }
  }
}
```

Mirror `ensureCartTransform` (an `ensureValidation` called from `afterAuth`)
so new installs get it automatically.
