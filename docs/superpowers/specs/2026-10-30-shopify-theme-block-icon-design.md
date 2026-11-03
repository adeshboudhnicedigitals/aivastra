# Shopify onboarding page 4: button block + corner icon embed

Sub-project 4 of 4 in the Shopify simplification.

## Goal

The Try It On **button** becomes an app block the merchant adds in the theme
editor. The **app embed** becomes a small icon placed over the top-right of the
product's main image. Both open the same try-on modal. The button can show an
icon. The icon asset moves into the extension.

## Current state

- `blocks/tryon-button.liquid` (embed, `target: body`) renders the whole widget;
  `tryon-widget.js` `placeWidget` moves the button above the buy buttons, waits
  up to 3s, honours `placement_selector`, else floats.
- `blocks/tryon-button-block.liquid` (block) renders the same widget; when both
  exist the block wins and the embed's button is removed.
- Markup shared via `snippets/tryon-widget.liquid` (`source: embed|block`).
- Onboarding theme step completes when a signed proxy call arrives from a live
  storefront (`markThemeEmbedSeen`, `dm !== '1'`).
- `tryon_icon.png` is untracked in the repo root, black on an opaque white
  background.

## Decisions (agreed)

- Theme step completes when the **button block** is seen live. The icon embed is
  optional.

## Design

### Roles
| Surface | Liquid | Renders | Placement |
|---|---|---|---|
| App block | `tryon-button-block.liquid` | Try It On button (+ optional icon) | Where the merchant drops it |
| App embed | `tryon-button.liquid` | Corner icon only | Auto, top-right of main product media |

One modal per page. The snippet renders the modal once (by whichever surface is
present first); `tryon-widget.js` binds every trigger (`.aivastra-tryon__button`,
`.aivastra-tryon__icon`) to it. A page with only the icon or only the button
both work.

### Widget JS / CSS
- Delete `placeWidget`, the 3s wait, `placement_selector` handling and the
  "block removes embed button" logic.
- Icon placement: locate the product's main media container (theme-agnostic
  heuristic: the featured image's nearest positioned/`media` ancestor, with the
  existing selector-based approach kept as an optional `media_selector` embed
  setting for themes it misses), append the icon `position:absolute; top; right`.
  Fallback when no media found: fixed-position corner icon on the page, so the
  entry point never disappears.
- Same enabled/hidden behaviour as today: both triggers render `hidden` and are
  revealed by the `enabled` call, so a disabled product never flashes.
- Respect login-required copy from sub-project 3 (icon and button behave alike).

### Icon asset
- Convert `tryon_icon.png` to a transparent asset (luminance to alpha, black
  glyph) and commit it as
  `apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-icon.png`;
  remove the root file. Prefer tracing to an SVG if the result is clean at 24px;
  decide at implementation by viewing both.
- Rendered with a CSS `mask-image` in `currentColor`, so it follows the button's
  text color and the icon's configurable color; no raw image tag, so theme-check's
  `width`/`height` rule does not apply.
- Block settings: `show_icon` (checkbox, default on). Embed settings:
  `icon_color`, `icon_background`, `icon_size`, optional `media_selector`;
  drop `button_*`, `promo_text` and `placement_selector` from the embed.

### Onboarding theme page
- Primary "Open theme settings" deep-links to the product template editor with
  the button block pre-added (`addAppBlockId={api_key}/tryon-button-block`,
  `target`/`template=product`). Secondary action enables the icon embed
  (`activateAppId`, as today). Verify exact parameter names and whether both can
  share one URL against Shopify's docs (shopify-dev) before implementing; if not,
  two links.
- `markThemeEmbedSeen` gate changes to source `block` (the widget already sends
  `data-source`; include it in the `enabled` query). Rename helper/setting
  to reflect "button seen"; keep the stored flag readable for stores that
  completed under the embed rule (treat both as done).
- Existing merchants who only have the old embed: after release their button
  becomes an icon, and they must add the block to get a button back. Needs a
  one-line notice in the merchant app (dashboard banner while no block has been
  seen) and a progress-log entry. Not a forced re-onboarding.

### Deploy
CI never runs `shopify app deploy`. Ship via `make shopify-deploy-staging`, verify
on a dev store, then `make shopify-deploy` from a checkout containing the commit.

## Risks

- Overlay placement varies per theme; mitigated by the fallback corner icon and
  `media_selector`. Expect per-theme support work, as with `placeWidget` today.
- Changes every live storefront's rendering at deploy time; stage first.

## Testing

- Staging dev stores: Dawn plus one older theme; block added/not added, embed
  on/off, disabled product, logged-out and logged-in.
- JS: unit-test the media-container finder against HTML fixtures.
- API: theme-seen signal accepts `block` and legacy flag.
- `shopify theme check` on the extension (width/height, schema).

## Out of scope

Per-template block placement automation, icon customization beyond color/size,
new customer-account UI extensions.
