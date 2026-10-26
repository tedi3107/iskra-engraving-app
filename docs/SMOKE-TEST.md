# Manual smoke test

Run after every change that touches the storefront extension, the cart
transform, or the admin routes. Use a dev store with the Personalize block on a
product that has an engraving zone, ideally with 2+ variants (different photos)
and both fonts uploaded. Takes ~5 minutes.

Automated checks first: `npm test`, `npm run typecheck`, `npm run lint`.

## Storefront (product page)
1. Page loads with no console errors; the Personalize button shows.
2. Open the dialog, type text — the engraving renders on the product photo
   (straight **and** curved zones, if you have one of each).
3. Switch font (pill) — preview re-renders with the other font and its own
   position/size.
4. Switch variant (pill) — photo changes, engraving stays in place, price
   updates; a sold-out variant shows "Sold out" and disables Add.
5. Type past the max length — counter stops at the limit; with "Uppercase only"
   on, input is forced to capitals.
6. Zoom / lightbox on the product photo — engraving appears there too and is
   positioned correctly.
7. Refresh the page — the typed text and font are restored (draft). Add to cart
   once — the draft clears and the button reads "Personalize" again.

## Adding to cart
8. Dialog **Add to cart** — loading state, item added with properties
   `Engraving`, `Engraving Font`, `_Engraved Preview`; side cart opens.
9. Type text, close the dialog with ×, use the **theme's own** Add to cart
   button — item carries the properties above.
10. Same as 9, but reopen the dialog, edit the text, close, then use the
    theme button — the item carries the **new** text and a **fresh**
    `_Engraved Preview` (regression test for the stale-preview bug).
11. Quick-add button (appears once text is typed) adds the item.
12. Cart page and cart drawer show the engraved image (needs the per-theme
    Liquid edit from the app's "Setup cart transform" page).
13. Checkout shows the engraved image (needs the cart transform active).

## Admin (embedded app)
14. Position designer: pick a product, drag/resize the zone, switch
    straight/curved, change font size/max chars/uppercase, Save — reload and
    confirm it persisted.
15. Font settings: upload a font, pick an existing one, remove one.
16. Setup cart transform: shows status; activate / deactivate work.

## Lifecycle
17. Uninstall the app from the dev store — the webhook returns 200 and the
    shop's session is gone from the session storage (MongoDB).

## Optional theme integrations (no-code)
18. Block setting **Hide the theme's own buy buttons** on: the theme's Add to
    cart / dynamic checkout buttons disappear on personalizable products only.
19. **Engraved images in cart** app embed on: cart page and drawer show the
    engraved preview for engraved lines; other lines keep their photo.
20. Block settings **Color/material option name** / **Size option name**:
    renaming them to match a product's options renders swatches/size labels for
    those options (defaults `Material` / `Size` match the original behavior).
