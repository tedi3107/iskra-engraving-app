# Jewelry Engraving (Iskra)

A Shopify app that lets customers personalize jewelry with a **live engraving
preview** on the product photo — straight text in a box, or curved around a
ring — and carries that preview through the cart, checkout and order.

Built on Shopify's React Router app template (see `LICENSE.md`).

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| Admin app | `app/routes/app.*` | Status dashboard, **Font settings** (two store-wide fonts), **Position designer** (engraving zone per product, Konva canvas), **Setup cart transform**. |
| Storefront block | `extensions/engraving-preview/blocks/engraving-preview.liquid` + `assets/engraving-preview*.js` | "Personalize" dialog: renders the engraving (WebGL lighting) on the product photo, variant/font pickers, captures a snapshot and adds to cart with `Engraving`, `Engraving Font`, `_Engraved Preview`. |
| Cart images embed | `extensions/engraving-preview/blocks/cart-engraving-images.liquid` | Optional app embed: shows the engraved preview on the cart page / drawer. |
| Preview cleanup | `app/routes/app.preview-cleanup.tsx` | Admin page that removes preview images no order uses (30–55 days old only; needs `read_orders`). |
| Upload endpoint | `app/routes/apps.engraving.upload-preview.tsx` (app proxy `/apps/engraving`) | Stores the snapshot in the shop's Files and returns its CDN URL. Size/type checked, rate limited. |
| Cart transform | `extensions/engraving-cart-transform` | Swaps the line image at checkout for the engraved preview. Activated automatically on install. |
| Engraving validation | `extensions/engraving-validation` | Blocks checkout when an engraving breaks the product's Max characters / Uppercase only rules (catches orders that bypass the storefront). Activated automatically on install; status on the Setup page. |

Data lives in Shopify, not in an app database:

- `shop.metafields.engraving.fonts` (JSON) holds the two fonts.
- `product.metafields.engraving.zone` (JSON) holds the zone per product.

MongoDB stores only OAuth sessions and the upload rate-limit counters.

The storefront block's JavaScript is split into assets the Liquid loads in
order. There is no build step, so `shopify app deploy` ships them as they are:

| Asset | Responsibility |
| --- | --- |
| `engraving-preview-core.js` | Pure helpers: geometry, crop, curved layout, money, variant matching (unit tested) |
| `engraving-preview-storage.js` | Draft persistence (localStorage) |
| `engraving-preview-render.js` | Text silhouette, WebGL lighting, colour sampling, upload snapshot |
| `engraving-preview-overlay.js` | Overlays on the theme's gallery/zoom photos |
| `engraving-preview-variants.js` | Variant pills, photo swaps, theme picker sync |
| `engraving-preview-cart.js` | Preview upload, add to cart, theme form interception |
| `engraving-preview.js` | Entry point: `<engraving-preview>` element, wiring, dialog, fonts, input |

The admin's curved preview (`app/lib/curved-text.ts`) is checked against the
core by a parity test.

## Configuration

Environment variables (Vercel → Project → Settings → Environment Variables;
locally the Shopify CLI provides the `SHOPIFY_*` ones):

| Variable | |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (sessions + rate limits) |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` | App credentials and URL |
| `SHOP_CUSTOM_DOMAIN` | Optional |

Two app configs share one `client_id`:

- `shopify.app.jewelry-engraving-test-app.toml` is **production** (Vercel URLs).
- `shopify.app.toml` is **local dev** (tunnel URLs, auto-updated by `shopify app dev`).

Keep scopes and webhooks identical in both. Deploy with
`shopify app deploy --config jewelry-engraving-test-app`, because deploying the
dev config pushes tunnel URLs to production.

## Development

```sh
npm install
shopify app dev
```

| Command | |
| --- | --- |
| `npm test` | Unit tests (app libs + storefront core) |
| `npm run test:e2e` | Storefront browser tests (first time: `npx playwright install chromium`) |
| `npm run typecheck` / `npm run lint` | As in CI |
| `cd extensions/engraving-cart-transform && npx vitest run tests/cart_transform_run.test.ts` | Cart transform unit tests |
| `cd extensions/engraving-validation && npx vitest run tests/cart_validations_generate_run.test.ts` | Validation function unit tests |

Before a release, also run the manual checklist in `docs/SMOKE-TEST.md`.

## Setting up a store

1. Install the app. The cart transform activates automatically (check under
   **Setup cart transform**).
2. **Font settings**: upload Font 1 and Font 2.
3. **Position designer**: place the engraving zone for each product.
4. Theme editor: add the **Engraving preview** block to the product template.
   Optionally:
   - enable **Hide the theme's own buy buttons** in the block;
   - turn on the **Engraved images in cart** app embed.

   Or use the manual Liquid edits shown on the Setup page.

## Open items

- The validation function's `schema.graphql` has to be fetched once with the
  CLI before its first deploy: see `docs/VALIDATION-FUNCTION.md`.
- Preview cleanup is manual (admin → Preview cleanup). It could be scheduled
  later (e.g. a Vercel cron calling it per shop).
