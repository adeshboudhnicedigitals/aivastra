# Shopify Theme Block + Corner Icon Implementation Plan (sub-project 4 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Try It On **button** becomes an app **block** the merchant adds in the theme editor; the app **embed** becomes a small icon overlaid on the top-right of the product's main image that opens the same try-on modal; the button can show an icon; onboarding page 4 finishes when the block is seen live.

**Architecture:** Both surfaces keep sharing `snippets/tryon-widget.liquid`, which now renders a *button* for `source: 'block'` and an *icon button* for `source: 'embed'`. On the storefront, `tryon-widget.js` initialises the block root with a full modal. An embed root with no block on the page is a standalone widget (icon + its own modal). An embed root **with** a block on the page is a *satellite*: its duplicate modal is removed and its icon opens the block's modal. The server records which surface was seen live (`source` on the signed `enabled` ping) in two separate flags.

**Tech Stack:** Liquid + vanilla JS + CSS (theme app extension, no build step); Fastify/Zod/Vitest (`apps/api`); React + Polaris (`apps/shopify`); `sharp` (one-off asset conversion).

Spec: `docs/superpowers/specs/2026-10-30-shopify-theme-block-icon-design.md`.

## Design decisions made while planning (the spec is amended in the final report)

1. **Two flags, not one.** `themeBlockConfirmed` (existing; the onboarding gate) is now set **only** by a `source=block` ping, plus `themeButtonBlockSeen` (new; true only from a real block ping). Legacy stores that finished under the embed rule have `themeBlockConfirmed` true but `themeButtonBlockSeen` unset, which is exactly the signal for the Dashboard "add the button block" banner (they lose their button when the embed becomes an icon). `themeEmbedConfirmed` now means "the icon embed was seen live".
2. **Deep links are two separate URLs.** Shopify's docs give `addAppBlockId` and `activateAppId` as separate link forms and do not say they can be combined (verified against shopify.dev, 2026-10-30). Onboarding page 4 therefore has two buttons: block (primary, required) and icon (optional).
3. **Satellite, not two modals.** One modal per page; the embed's icon calls `blockRoot.__aivastraOpen()`. The satellite makes its own signed `enabled` ping (`source=embed`) so icon visibility and the icon-seen flag work without touching the block's initialisation.
4. **No DOM layout in the media finder's logic path that jsdom can't evaluate.** Rendered width is only a tiebreak (zero in jsdom, so ties fall to DOM order); everything else uses selectors and computed `position`, which keeps the finder unit-testable.
5. **Tutorial screenshot.** `apps/shopify/src/assets/theme-tutorial.png` shows the App embeds panel; it now illustrates only the optional icon step. A new screenshot of "Add block" is a design task, not part of this plan.

## Global Constraints

- Deep-link formats (from shopify.dev): block `https://<shop>/admin/themes/current/editor?template=product&addAppBlockId={api_key}/{handle}&target=mainSection`; embed `https://<shop>/admin/themes/current/editor?context=apps&template=product&activateAppId={api_key}/{handle}`. `{handle}` is the Liquid filename without extension: block `tryon-button-block`, embed `tryon-button`. Renaming either file silently breaks the links.
- Do not run `shopify app deploy` (CI never does; deploy is the manager's decision via `make shopify-deploy-staging` then `make shopify-deploy`).
- Theme-check: `<img>` needs `width`/`height`; this plan renders the icon with CSS `mask-image`, not `<img>`.
- The widget has no automated harness except the extracted-region jsdom test in Task 5; widget edits are checked with `node --check` plus the manual script in Task 7.
- pnpm only. No `console.log` in `apps/api` or `apps/shopify`; the widget's existing `console.warn/error` style is fine.
- API tests: `pnpm --filter @aivastra/api test` is unit only. Integration, from `apps/api`: `npx vitest run --config vitest.integration.config.ts <pattern>`; needs `pnpm docker:up`.
- Package names: `@aivastra/api`, `@aivastra/db`, `@aivastra/shopify-admin` (apps/shopify). `@aivastra/api` resolves `@aivastra/db` from `dist`: `pnpm --filter @aivastra/db build` after a schema type change.
- Never `git add -A` / `git add .`, `git stash`, `git checkout`, `git reset`, `git commit -a`. Do not edit `docs/progress.md` or `CLAUDE.md`.

## Parallel execution protocol (four plans share branch `feat/shopify-simplification`)

- Stage **explicit paths only**; commit only your task's files. Re-read before every edit; use `Edit` hunks.
- Shared files and the **only** hunks this plan may touch:
  - `snippets/tryon-widget.liquid`: the `data-placement-selector` attribute line (replace with `data-media-selector`), the `style=` attribute line, and the promo/button markup block. Plan 3 owns the `data-customer-*` / `data-login-url` attributes, the email step and the new login step; do not touch them.
  - `assets/tryon-widget.js`: the placement section at the bottom (from the `PRODUCT_FORM_SELECTORS` comment through the end of the file), the enabled-URL line, and one added line after `button.addEventListener('click', openModal);`. Plan 3 owns the email/contact step handler, `createJob`, `proceedWithPhoto`, the `steps` map, `startOver`, and the `loginRequired = body.loginRequired === true;` line in the enabled block.
  - `assets/tryon-widget.css`: edit the `.aivastra-tryon--floating` rule and **append** your block at the very end of the file under the comment `/* theme block + icon (plan 4) */`. Plan 3 inserts its block next to `.aivastra-tryon__email-submit`, not at the end.
  - `apps/api/src/modules/shopify/customer.routes.ts`: only the `markThemeEmbedSeen` call inside the `enabled` handler and the line that reads `query.source`. Plan 1 owns workflow resolution there; plan 3 owns the returned object.
  - `apps/api/src/modules/shopify/onboarding.routes.ts`: only the theme parts (`findThemeEmbedEnabled` neighbourhood, `checkThemeEmbedLive`, deep-link builders, `markThemeEmbedSeen`, the `theme-editor-url`, `theme-block-url` and `check-theme-embed` routes). Plan 1 owns `/complete`; plan 2 owns the contact schema/handler.
  - `apps/shopify/src/lib/onboarding.ts`: only delete `needsEmbedEnable` (Task 6). Plan 1 owns the rest. Re-read the file first; plan 1 rewrites most of it.
  - `apps/shopify/src/pages/DashboardPage.tsx`: only the `needsEmbedEnable`/`embedNeeded` banner and the two handlers it uses. Plan 1 removes the unrouted-products banner.
  - `apps/shopify/src/types.ts`, `packages/db/src/schema/shopify.ts`: only the `themeButtonBlockSeen` line.
- Failures in files outside this plan are not yours; report them.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-icon.png` | create | transparent icon asset (replaces root `tryon_icon.png`) |
| `.../snippets/tryon-widget.liquid`, `blocks/tryon-button.liquid`, `blocks/tryon-button-block.liquid` | modify | button vs icon rendering, schemas |
| `.../assets/tryon-widget.js`, `tryon-widget.css` | modify | satellite, icon placement, media finder, source ping |
| `apps/api/src/modules/shopify/onboarding.routes.ts` | modify | seen flags by source, block detection, deep links |
| `apps/api/src/modules/shopify/customer.routes.ts` | modify | forward `source` to the ping |
| `apps/shopify/src/lib/theme.ts` (+test) | create | `needsButtonBlock(me)` |
| `apps/shopify/src/pages/{OnboardingThemePage,DashboardPage,SettingsPage}.tsx` | modify | block-first onboarding, banner, copy |
| `apps/shopify/src/lib/themeWidgetMedia.test.ts` | create | jsdom test for the media finder |

---

### Task 1: Icon asset

**Files:**
- Create: `apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-icon.png`
- Remove: `tryon_icon.png` (repo root, untracked)

- [ ] **Step 1: Convert** (black glyph on opaque white to black glyph with alpha, tightly cropped, 256x256). Write this script to the scratchpad directory (not the repo), `convert-icon.mjs`:

```js
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/tejar/projects/aivastra/apps/dispatcher/package.json');
const sharp = require('sharp');

const src = 'C:/Users/tejar/projects/aivastra/tryon_icon.png';
const out =
  'C:/Users/tejar/projects/aivastra/apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-icon.png';
const SIZE = 256;

// Trim the white margin, fit into a square with a little breathing room, then
// turn luminance into alpha: black stays black, white becomes transparent.
const { data, info } = await sharp(src)
  .trim({ threshold: 12 })
  .resize(SIZE - 24, SIZE - 24, { fit: 'contain', background: '#ffffff' })
  .extend({ top: 12, bottom: 12, left: 12, right: 12, background: '#ffffff' })
  .greyscale()
  .raw()
  .toBuffer({ resolveWithObject: true });

const rgba = Buffer.alloc(info.width * info.height * 4);
for (let i = 0; i < data.length; i++) {
  rgba[i * 4] = 0;
  rgba[i * 4 + 1] = 0;
  rgba[i * 4 + 2] = 0;
  rgba[i * 4 + 3] = 255 - data[i];
}
await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log('wrote', out, info.width, 'x', info.height);
```

Run: `node <scratchpad>/convert-icon.mjs` (adjust the `createRequire` path if `sharp` is not resolvable there: `ls apps/dispatcher/node_modules/sharp`).

- [ ] **Step 2: Inspect.** Read the output PNG with the Read tool. Expected: the black four-point star, plus, ring and hanger/T-shirt on a **transparent** background (viewers show a checkerboard or the viewer's background, not a white square), cropped close to the glyph. If edges look jagged or a white fringe shows, raise `threshold` or accept as is; report what you saw. Check size: `ls -l` the file (expect under 40 KB).
- [ ] **Step 3: Remove the root file and commit.** Only after Step 2 looks right: `rm tryon_icon.png`.

```bash
git add apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-icon.png
git commit -m "feat(shopify-extension): transparent try-on icon asset"
```

(`tryon_icon.png` was never tracked, so there is nothing to stage for its removal.)

---

### Task 2: API: which surface was seen, block detection, deep links

**Files:**
- Modify: `apps/api/src/modules/shopify/onboarding.routes.ts`, `apps/api/src/modules/shopify/customer.routes.ts` (the ping hunk only)
- Modify: `packages/db/src/schema/shopify.ts`, `apps/shopify/src/types.ts` (add `themeButtonBlockSeen?: boolean;` beside `themeEmbedConfirmed`)
- Test: `apps/api/test/integration/shopify-onboarding.test.ts` (theme blocks only), `apps/api/src/modules/shopify/onboarding.test.ts` (pure tests), `apps/api/test/integration/shopify-customer-app-proxy.test.ts` (the ping test near line 124)

**Interfaces:**
- Produces in `onboarding.routes.ts`:
  - `export type ThemeSeenSource = 'block' | 'embed';`
  - `export function findThemeBlockPresent(content: string): boolean` (parses `templates/product.json`)
  - `export async function checkThemeLive(app, store): Promise<{ block: boolean; embed: boolean }>` (replaces `checkThemeEmbedLive`)
  - `export async function markThemeSurfaceSeen(app, store, source: ThemeSeenSource): Promise<void>` (replaces `markThemeEmbedSeen`)
- Behaviour: `source: 'block'` sets `themeBlockConfirmed` and `themeButtonBlockSeen`; `source: 'embed'` sets only `themeEmbedConfirmed`. `GET /v1/shopify/onboarding/theme-editor-url` returns `{ url, blockUrl, embedUrl }` where `url === blockUrl` (old clients keep working and now open the block link). `POST /v1/shopify/onboarding/check-theme-embed` returns `{ themeBlockConfirmed, themeEmbedConfirmed }`. The `enabled` ping reads `?source=block|embed` (anything else, or absent, means `embed`, because already-cached widget scripts send none and are embed roots).

- [ ] **Step 1: Failing tests**

`onboarding.test.ts` (pure): add to the existing imports `findThemeBlockPresent`, and:

```ts
describe('findThemeBlockPresent', () => {
  const wrap = (blocks: Record<string, unknown>) =>
    JSON.stringify({ sections: { main: { type: 'main-product', blocks } } });

  it('finds the button block in a product template section', () => {
    expect(
      findThemeBlockPresent(
        wrap({ b1: { type: 'shopify://apps/aivastra/blocks/tryon-button-block/uuid-1' } }),
      ),
    ).toBe(true);
  });
  it('ignores a disabled block', () => {
    expect(
      findThemeBlockPresent(
        wrap({ b1: { type: 'shopify://apps/aivastra/blocks/tryon-button-block/u', disabled: true } }),
      ),
    ).toBe(false);
  });
  it('does not mistake the embed for the block', () => {
    expect(
      findThemeBlockPresent(wrap({ b1: { type: 'shopify://apps/aivastra/blocks/tryon-button/u' } })),
    ).toBe(false);
  });
  it('survives a leading comment, junk, null blocks and a missing sections key', () => {
    expect(
      findThemeBlockPresent(
        `/* auto */\n${wrap({ b1: { type: 'shopify://apps/x/blocks/tryon-button-block/u' } })}`,
      ),
    ).toBe(true);
    expect(findThemeBlockPresent('not json')).toBe(false);
    expect(findThemeBlockPresent('{}')).toBe(false);
    expect(findThemeBlockPresent(wrap({ b1: null }))).toBe(false);
  });
});
```

Integration (`shopify-onboarding.test.ts`, add a describe, reusing the file's `token`/`storeId`/`app` harness and its `storeRow()`-style helper; seed a fresh store with `settings: {}`):
1. `markThemeSurfaceSeen(app, store, 'block')` sets `themeBlockConfirmed: true` and `themeButtonBlockSeen: true` and **not** `themeEmbedConfirmed`; reading `/v1/shopify/me` shows the same flags.
2. `markThemeSurfaceSeen(app, store, 'embed')` sets only `themeEmbedConfirmed: true`; `themeBlockConfirmed` stays unset.
3. Idempotent: calling `'block'` again when `themeButtonBlockSeen` is already true performs no UPDATE (assert `updatedAt` unchanged).
4. `GET /v1/shopify/onboarding/theme-editor-url` returns `url === blockUrl`, `blockUrl` containing `addAppBlockId=` and `tryon-button-block` and `target=mainSection`, `embedUrl` containing `activateAppId=` and `context=apps` and the handle `tryon-button` but not `tryon-button-block`.

In `shopify-customer-app-proxy.test.ts` near line 124 (the "embed is live" ping test): extend with signed GETs to `/v1/shopify/proxy/customer/products/<id>/enabled` using `source: 'block'` (sets `themeBlockConfirmed` and `themeButtonBlockSeen`), `source: 'embed'` (sets only `themeEmbedConfirmed`), no `source` (treated as embed), and `source: 'garbage'` (treated as embed); and `dm: '1'` with `source: 'block'` sets nothing. Copy that file's `signAppProxyQuery` usage; note `source` and `dm` must be in the signed params.

Run: `pnpm --filter @aivastra/api test -- onboarding` and (from `apps/api`) `npx vitest run --config vitest.integration.config.ts shopify-onboarding shopify-customer-app-proxy` → FAIL.

- [ ] **Step 2: Implement**

Add `themeButtonBlockSeen?: boolean;` to `ShopifyStoreSettings` in `packages/db/src/schema/shopify.ts` and `apps/shopify/src/types.ts` (comment: `// true only once a storefront rendered the Try It On *block*; legacy stores that passed onboarding under the embed rule lack it`). Run `pnpm --filter @aivastra/db build`.

`onboarding.routes.ts`:

1. After `findThemeEmbedEnabled` add:

```ts
/**
 * Pure parse: does the live theme's `templates/product.json` place our button
 * block, enabled? App blocks live in a section's `blocks`, typed
 * `shopify://apps/{app}/blocks/{handle}/{uid}`; as with findThemeEmbedEnabled,
 * only the `/blocks/{handle}/` segment is matched, because the app identifier in
 * that string cannot be computed reliably. Only an explicit `disabled: true`
 * turns a block off. A product template other than the default one is not
 * detected here; the storefront ping is the backstop. Never throws.
 */
export function findThemeBlockPresent(content: string): boolean {
  try {
    const stripped = content.replace(/^\s*\/\*[\s\S]*?\*\//, '');
    const parsed: unknown = JSON.parse(stripped);
    const sections = (parsed as { sections?: Record<string, unknown> } | null)?.sections ?? {};
    const pattern = new RegExp(`^shopify://apps/[^/]+/blocks/${TRYON_APP_BLOCK_HANDLE}/`);
    return Object.values(sections).some((section) => {
      if (typeof section !== 'object' || section === null) return false;
      const blocks = (section as { blocks?: Record<string, unknown> }).blocks ?? {};
      return Object.values(blocks).some((block) => {
        if (typeof block !== 'object' || block === null) return false;
        const typed = block as { type?: unknown; disabled?: unknown };
        return typeof typed.type === 'string' && pattern.test(typed.type) && typed.disabled !== true;
      });
    });
  } catch {
    return false;
  }
}
```

2. Replace `checkThemeEmbedLive` with `checkThemeLive` (same query, `filenames: ['config/settings_data.json', 'templates/product.json']`; read both file bodies by `filename` from `data.themes.nodes[0]?.files.nodes`; `embed = settings content ? findThemeEmbedEnabled(content) : false`; `block = product content ? findThemeBlockPresent(content) : false`; catch → `{ block: false, embed: false }` with the same warn log text adjusted to "theme live-check failed"). Update the doc comment (it mentions only the embed). Keep `MAIN_THEME_SETTINGS_QUERY` and `MainThemeSettingsData` as they are.

3. Replace `markThemeEmbedSeen` with:

```ts
export type ThemeSeenSource = 'block' | 'embed';

/**
 * Records which storefront surface is live. Called from the widget's first
 * request on a product page (see the /enabled route in customer.routes.ts), so
 * the merchant never has to say "I've enabled it".
 *
 * `block` (the Try It On button) is what ends onboarding: it sets
 * `themeBlockConfirmed`, which the wizard gate reads, and `themeButtonBlockSeen`,
 * which distinguishes a store that really renders the block from a legacy store
 * that passed onboarding under the old embed rule (those get a Dashboard prompt
 * to add the block). `embed` (the corner icon) only sets `themeEmbedConfirmed`.
 *
 * Cheap on purpose: it rides on a per-page-view request, so once the relevant
 * flag is set it returns without touching the database.
 */
export async function markThemeSurfaceSeen(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
  source: ThemeSeenSource,
): Promise<void> {
  const settings = store.settings ?? {};
  if (source === 'block' ? settings.themeButtonBlockSeen : settings.themeEmbedConfirmed) return;
  const patch =
    source === 'block'
      ? { themeBlockConfirmed: true, themeButtonBlockSeen: true }
      : { themeEmbedConfirmed: true };
  await app.db
    .update(schema.shopifyStores)
    .set({
      settings: mergeStoreSettingsObject(storeSettingsJson(), [], patch),
      updatedAt: new Date(),
    })
    .where(eq(schema.shopifyStores.id, store.id));
}
```

4. Fix the two doc comments that describe the embed as the primary surface: the one above `buildThemeEditorDeepLink` ("Deep link into ... App embeds panel with our embed switched on") stays accurate (it is the embed/icon link) but its trailing "History" paragraph gets one more line: "2026-10-30: the embed became the product-image icon; the button is the block (buildAppBlockDeepLink)". Rewrite the comment above `buildAppBlockDeepLink` to say it is now the **primary** link offered during onboarding and from Settings (remove "Offered from Settings only... onboarding itself still sends merchants to the embed"), and the block-handle comment near `TRYON_APP_BLOCK_HANDLE` to drop "When present on a product page it wins over the embed (tryon-widget.js drops the embed's button)" in favour of "its modal is shared with the embed's icon".

5. Routes:
   - `theme-editor-url`: return `{ url: blockUrl, blockUrl, embedUrl }` using `buildAppBlockDeepLink` and `buildThemeEditorDeepLink`.
   - `check-theme-embed`: 

```ts
      const settings = store.settings ?? {};
      if (settings.themeButtonBlockSeen && settings.themeEmbedConfirmed) {
        return { themeBlockConfirmed: true, themeEmbedConfirmed: true };
      }
      const live = await checkThemeLive(app, store);
      const persist = (source: ThemeSeenSource) =>
        markThemeSurfaceSeen(app, store, source).catch((err) =>
          app.log.warn({ err, storeId: store.id, source }, 'could not persist theme surface as seen'),
        );
      if (live.block) await persist('block');
      if (live.embed) await persist('embed');
      return {
        themeBlockConfirmed: Boolean(settings.themeButtonBlockSeen) || live.block,
        themeEmbedConfirmed: Boolean(settings.themeEmbedConfirmed) || live.embed,
      };
```

`customer.routes.ts`: change the import to `markThemeSurfaceSeen`; in the `enabled` handler, where `markThemeEmbedSeen(app, store).catch(...)` is called (inside `if (typeof query.signature === 'string' && query.dm !== '1')`), compute and pass the source:

```ts
        const seenSource = query.source === 'block' ? 'block' : 'embed';
        markThemeSurfaceSeen(app, store, seenSource).catch((err) =>
          req.log.warn({ err, storeId }, 'could not record theme surface as seen'),
        );
```

and update the comment above (it says "the app embed is live").

- [ ] **Step 3: Verify, commit**

Run: `pnpm --filter @aivastra/api test -- onboarding`, then (from `apps/api`) `npx vitest run --config vitest.integration.config.ts shopify-onboarding shopify-customer-app-proxy shopify-customer` → pass. `grep -rn "markThemeEmbedSeen\|checkThemeEmbedLive" apps --include=*.ts | grep -v "node_modules\|dist"` → no results. `pnpm --filter @aivastra/api typecheck` (foreign-plan errors excepted).

```bash
git add apps/api/src/modules/shopify/onboarding.routes.ts apps/api/src/modules/shopify/customer.routes.ts apps/api/src/modules/shopify/onboarding.test.ts apps/api/test/integration/shopify-onboarding.test.ts apps/api/test/integration/shopify-customer-app-proxy.test.ts packages/db/src/schema/shopify.ts apps/shopify/src/types.ts
git commit -m "feat(shopify): track the button block and the icon embed separately; block detection and deep links"
```

(Stage only your hunks with `git add -p` in the shared files.)

---

### Task 3: Liquid: button for the block, icon for the embed

**Files:**
- Modify: `apps/shopify-extension/extensions/tryon-theme-extension/snippets/tryon-widget.liquid`
- Modify: `apps/shopify-extension/extensions/tryon-theme-extension/blocks/tryon-button-block.liquid`
- Modify: `apps/shopify-extension/extensions/tryon-theme-extension/blocks/tryon-button.liquid`

- [ ] **Step 1: Snippet.** Re-read first. (a) Replace the header comment so it reads: shared markup for the Try It On **button** (rendered by the app block) and the **icon** (rendered by the app embed); `source` is `block` or `embed`; tryon-widget.js shares one modal between them. (b) Directly after the `{%- assign cfg ... -%}` line add:

```liquid
{%- liquid
  if source == 'embed'
    assign accent_bg = settings.icon_background | default: '#000000'
    assign accent_fg = settings.icon_color | default: '#FFFFFF'
  else
    assign accent_bg = settings.button_color
    assign accent_fg = settings.text_color
  endif
-%}
```

(c) Replace the `data-placement-selector="..."` attribute line with `data-media-selector="{{ settings.media_selector | escape }}"`. (d) Replace the `style="..."` attribute with:

```liquid
    style="--aivastra-button-color: {{ accent_bg }}; --aivastra-text-color: {{ accent_fg }}; --aivastra-border-radius: {{ settings.border_radius }}px; --aivastra-icon-size: {{ settings.icon_size | default: 40 }}px; --aivastra-icon-url: url('{{ 'tryon-icon.png' | asset_url }}');{% if cfg.theme.accentColor %} --aivastra-accent: {{ cfg.theme.accentColor | escape }};{% endif %}"
```

(e) Replace the promo `<p>` block and the `<button type="button" class="aivastra-tryon__button">...</button>` with:

```liquid
    {%- if source == 'embed' -%}
      <button type="button" class="aivastra-tryon__button aivastra-tryon__icon-btn" aria-label="Try it on">
        <span class="aivastra-tryon__btn-icon" aria-hidden="true"></span>
      </button>
    {%- else -%}
      {%- if settings.promo_text != blank -%}
        <p class="aivastra-tryon__promo">{{ settings.promo_text | escape }}</p>
      {%- endif -%}
      <button type="button" class="aivastra-tryon__button">
        {%- if settings.show_icon -%}
          <span class="aivastra-tryon__btn-icon" aria-hidden="true"></span>
        {%- endif -%}
        {{ settings.button_text | default: 'Try It On' | escape }}
      </button>
    {%- endif -%}
```

Leave everything after it (the modal, plan 3's steps) untouched.

- [ ] **Step 2: Block (`tryon-button-block.liquid`).** Replace the header comment with: the Try It On button as an app BLOCK; the merchant adds it in the product template (Add block); the corner icon on the product image comes from the Try It On app embed (App embeds panel) and opens the same try-on window. In the schema replace the first `paragraph` setting's `content` with `"The Try It On button, shown exactly where you place it. Turn on the Try It On app embed too if you want a try-on icon on the product image."` and add after `button_text`:

```json
    {
      "type": "checkbox",
      "id": "show_icon",
      "label": "Show icon on the button",
      "default": true
    },
```

Keep `api_base`, `promo_text`, colors and `border_radius`.

- [ ] **Step 3: Embed (`tryon-button.liquid`).** Replace the header comment with: app EMBED (target body); the merchant switches it on under App embeds; it renders a small icon placed over the top-right of the product's main image by tryon-widget.js (falls back to a floating icon); it opens the same try-on window as the Try It On button block; if the block is on the page the icon opens the block's window instead of its own. Keep the paragraph about `hidden` and the Postgres activation state (still true) and the History paragraph reduced to one line: `History: embed -> app block (2026-07-31) -> embed (button) -> embed (icon) + block (button), 2026-10-30.` Replace the schema `settings` with:

```json
  "settings": [
    {
      "type": "text",
      "id": "api_base",
      "label": "API base URL",
      "default": "https://app.aivastra.com"
    },
    {
      "type": "color",
      "id": "icon_background",
      "label": "Icon background",
      "default": "#000000"
    },
    {
      "type": "color",
      "id": "icon_color",
      "label": "Icon color",
      "default": "#FFFFFF"
    },
    {
      "type": "range",
      "id": "icon_size",
      "label": "Icon size",
      "min": 28,
      "max": 56,
      "step": 2,
      "unit": "px",
      "default": 40
    },
    {
      "type": "range",
      "id": "border_radius",
      "label": "Border radius of the try-on window buttons",
      "min": 0,
      "max": 20,
      "step": 1,
      "unit": "px",
      "default": 4
    },
    {
      "type": "text",
      "id": "media_selector",
      "label": "Product image container (advanced)",
      "info": "Leave blank to place the icon on the top-right of your main product image automatically. If it lands in the wrong spot on your theme, enter a CSS selector for the element that wraps the product image."
    }
  ]
```

- [ ] **Step 4: Verify, commit.** Validate both schemas are valid JSON: `node -e "for (const f of ['blocks/tryon-button.liquid','blocks/tryon-button-block.liquid']) { const s=require('fs').readFileSync('apps/shopify-extension/extensions/tryon-theme-extension/'+f,'utf8'); JSON.parse(s.split('{% schema %}')[1].split('{% endschema %}')[0]); console.log('ok', f); }"`. Run `npx shopify theme check --path apps/shopify-extension/extensions/tryon-theme-extension` if the CLI is available (skip with a note if not): no new offences.

```bash
git add apps/shopify-extension/extensions/tryon-theme-extension/snippets/tryon-widget.liquid apps/shopify-extension/extensions/tryon-theme-extension/blocks/tryon-button-block.liquid apps/shopify-extension/extensions/tryon-theme-extension/blocks/tryon-button.liquid
git commit -m "feat(shopify-extension): button via app block, icon via app embed"
```

(Snippet is shared with plan 3: stage only your hunks with `git add -p`.)

---

### Task 4: Widget JS: satellite, icon placement, media finder, source ping

**Files:**
- Modify: `apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.js`

- [ ] **Step 1: Ping carries the source.** In `initWidget`'s enabled check (search `customer/products/${productId}/enabled`) replace the URL expression

```js
`${PROXY_BASE}/customer/products/${productId}/enabled${isLiveStorefront() ? '' : '?dm=1'}`,
```

with

```js
`${PROXY_BASE}/customer/products/${productId}/enabled?source=${encodeURIComponent(root.dataset.source || 'embed')}${isLiveStorefront() ? '' : '&dm=1'}`,
```

Update the comment above `isLiveStorefront` ("This request also tells our API that the app embed is live...") to "...that the Try It On block (or the icon embed) is live...". Touch nothing else in that block (plan 3 edits the line after `verboseErrors = ...`).

- [ ] **Step 2: Expose the opener.** Directly after `button.addEventListener('click', openModal);` add:

```js
    // The embed's icon (see initSatellite) opens this modal when a block is also
    // on the page, so the two surfaces share one modal and one history.
    root.__aivastraOpen = openModal;
```

- [ ] **Step 3: Replace the bottom placement section.** Delete from the comment that precedes `const PRODUCT_FORM_SELECTORS` through the end of the file (the form/buy-button selectors, `firstMatch`, `findPlacementAnchor`, `placeWidget`, `placeWhenReady`, the "block wins" removal, and the init loop) and put this in its place, still inside the file's outer IIFE and ending with its closing `})();`:

```js
  // <media-finder>
  // Wrappers around a product's main media, most specific first. A theme that
  // matches none still works: the finder falls back to the featured image.
  const MEDIA_SELECTORS = [
    '.product__media-wrapper',
    '.product-media-container',
    '[data-product-media-container]',
    '.product__media-list',
    '.product-gallery',
    '.product__gallery',
    '.product-images',
    '.product__images',
  ];

  // Thumbnails of the same image share its file name, so they must not win.
  const THUMBNAIL_SELECTOR =
    '[class*="thumb" i], [data-thumbnail], header, footer, nav, [class*="cart" i], [class*="recommend" i]';

  function safeQuery(scope, selector) {
    // A merchant-typed selector can be invalid, and querySelector throws on those.
    try {
      return scope.querySelector(selector);
    } catch (_err) {
      return null;
    }
  }

  // "…/files/shirt_200x.jpg?v=1" and "…/files/shirt_1100x.jpg" are the same
  // image: drop the extension and Shopify's _{w}x{h} size suffix.
  function imageKey(url, base) {
    try {
      const last = new URL(url, base).pathname.split('/').pop() || '';
      return last.replace(/\.[a-z0-9]+$/i, '').replace(/_(\d+x\d*|\d*x\d+)(@\dx)?$/i, '');
    } catch (_err) {
      return '';
    }
  }

  function imageSources(img) {
    const out = [img.currentSrc, img.getAttribute('src'), img.getAttribute('data-src')];
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (srcset) out.push(srcset.split(',')[0].trim().split(/\s+/)[0]);
    return out.filter(Boolean);
  }

  function isPositioned(win, el) {
    const position = win.getComputedStyle(el).position;
    return !!position && position !== 'static';
  }

  // Returns { el, needsRelative } or null. `opts` is { selector, productImage }.
  // Rendered width is only a tiebreak between matching images: it is 0 in a test
  // DOM, where ties fall to document order.
  function findMediaContainer(doc, win, opts) {
    if (opts.selector) {
      const el = safeQuery(doc, opts.selector);
      if (el) return { el, needsRelative: !isPositioned(win, el) };
    }

    const wanted = opts.productImage ? imageKey(opts.productImage, win.location.href) : '';
    const imgs = Array.prototype.slice
      .call(doc.querySelectorAll('img'))
      .filter((img) => !img.closest(THUMBNAIL_SELECTOR));

    let candidates = wanted
      ? imgs.filter((img) =>
          imageSources(img).some((src) => imageKey(src, win.location.href) === wanted),
        )
      : [];
    if (candidates.length === 0) {
      const scope = MEDIA_SELECTORS.map((s) => safeQuery(doc, s)).find(Boolean) ||
        safeQuery(doc, 'main, #MainContent, [role="main"]');
      if (scope) candidates = imgs.filter((img) => scope.contains(img));
    }
    if (candidates.length === 0) return null;

    let best = candidates[0];
    let bestWidth = best.getBoundingClientRect().width;
    for (let i = 1; i < candidates.length; i++) {
      const width = candidates[i].getBoundingClientRect().width;
      if (width > bestWidth) {
        best = candidates[i];
        bestWidth = width;
      }
    }

    // Prefer an ancestor the theme already positioned: overlaying it changes no
    // layout. Otherwise a known media wrapper, otherwise the image's block parent.
    let node = best.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (node === doc.body || node === doc.documentElement) break;
      if (isPositioned(win, node)) return { el: node, needsRelative: false };
    }
    const wrapper = best.closest(MEDIA_SELECTORS.join(','));
    if (wrapper) return { el: wrapper, needsRelative: true };
    let parent = best.parentElement;
    while (parent && parent.tagName === 'PICTURE') parent = parent.parentElement;
    return parent ? { el: parent, needsRelative: true } : null;
  }
  // </media-finder>

  function placeIcon(root) {
    const found = findMediaContainer(document, window, {
      selector: root.dataset.mediaSelector,
      productImage: root.dataset.productImage,
    });
    if (!found) return false;
    // Only when the theme left the container static, so the icon has something
    // to be absolute against.
    if (found.needsRelative) found.el.style.position = 'relative';
    found.el.appendChild(root);
    root.classList.add('aivastra-tryon--icon');
    return true;
  }

  // Themes that render the gallery with JS may not have it in the DOM yet, so
  // wait briefly. Falling back to a floating icon beats an icon stranded at the
  // end of <body> looking like the app is broken.
  function placeIconWhenReady(root) {
    if (placeIcon(root)) return;
    const observer = new MutationObserver(() => {
      if (placeIcon(root)) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      if (root.classList.contains('aivastra-tryon--icon')) return;
      root.classList.add('aivastra-tryon--icon', 'aivastra-tryon--floating');
      console.warn(
        '[aivastra] Try It On: no product image found, showing a floating icon. ' +
          'Set a CSS selector in Theme editor -> App embeds -> Try It On to place it.',
      );
    }, 3000);
  }

  // An embed icon on a page that also has the Try It On block: the block owns the
  // modal, so this root's duplicate modal is dropped and the icon opens the
  // block's. It still makes its own signed enabled ping (source=embed): that is
  // what reveals the icon only for enabled products and what records the icon as
  // seen. App Proxy path is fixed by shopify.app.toml, as in initWidget.
  function initSatellite(root, blockRoot) {
    const duplicates = root.querySelectorAll('.aivastra-tryon__modal, .aivastra-tryon__lightbox');
    for (let i = 0; i < duplicates.length; i++) duplicates[i].remove();
    const icon = root.querySelector('.aivastra-tryon__button');
    if (!icon) return;
    icon.addEventListener('click', () => {
      if (typeof blockRoot.__aivastraOpen === 'function') blockRoot.__aivastraOpen();
    });
    const shopify = window.Shopify;
    const live =
      !shopify ||
      (!shopify.designMode &&
        !(shopify.theme && shopify.theme.role && shopify.theme.role !== 'main'));
    fetch(
      `/apps/widget/customer/products/${Number(root.dataset.productId)}/enabled?source=embed${live ? '' : '&dm=1'}`,
      { headers: { 'ngrok-skip-browser-warning': 'true' } },
    )
      .then((res) => {
        if (!res.ok) throw new Error(`enabled check failed: ${res.status}`);
        return res.json();
      })
      .then((body) => {
        if (body.enabled) root.hidden = false;
      })
      .catch((err) => {
        // Fail open, like initWidget: an unreachable API must not hide the icon.
        console.warn('[aivastra tryon] enabled check failed, showing icon anyway', err);
        root.hidden = false;
      });
  }

  const roots = Array.prototype.slice.call(document.querySelectorAll('.aivastra-tryon'));
  const blockRoots = roots.filter((r) => r.dataset.source === 'block');
  const embedRoots = roots.filter((r) => r.dataset.source !== 'block');
  const blockRoot = blockRoots[0] || null;

  // Blocks first so their modal exists before an icon is wired to open it. Each
  // is contained: a theme that strips or renames one element used to throw out of
  // the whole loop and take every other widget on the page down with it. A
  // failure still leaves that surface inert but is loud in the console.
  for (let i = 0; i < blockRoots.length; i++) {
    try {
      initWidget(blockRoots[i]);
    } catch (err) {
      console.error('[aivastra tryon] widget failed to initialize', err);
    }
  }
  for (let i = 0; i < embedRoots.length; i++) {
    try {
      placeIconWhenReady(embedRoots[i]);
      if (blockRoot) initSatellite(embedRoots[i], blockRoot);
      else initWidget(embedRoots[i]);
    } catch (err) {
      console.error('[aivastra tryon] widget failed to initialize', err);
    }
  }
})();
```

Before deleting, confirm no other code references `placeWhenReady`, `placeWidget`, `findPlacementAnchor`, `data-placement-selector`, `data-source="block"` removal logic: `grep -n "placeWhenReady\|placeWidget\|findPlacementAnchor\|placementSelector\|PRODUCT_FORM_SELECTORS\|BUY_BUTTON_SELECTORS\|firstMatch" tryon-widget.js` must show only the lines you are deleting.

- [ ] **Step 4: Verify, commit.** `node --check apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.js` (no output = OK). `grep -c "<media-finder>\|</media-finder>"` = 2.

```bash
git add apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.js
git commit -m "feat(shopify-extension): icon placement on product media; embed icon shares the block's modal"
```

(Stage only your hunks with `git add -p` if plan 3 has uncommitted edits in this file.)

---

### Task 5: CSS and the media-finder unit test

**Files:**
- Modify: `apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.css`
- Create: `apps/shopify/src/lib/themeWidgetMedia.test.ts`
- Modify: `apps/shopify/package.json`, `pnpm-lock.yaml` (adds `jsdom` as a devDependency)

- [ ] **Step 1: Add jsdom.** Run `pnpm --filter @aivastra/shopify-admin add -D jsdom`. Stage only `apps/shopify/package.json` and `pnpm-lock.yaml`'s hunks for jsdom (`git add -p pnpm-lock.yaml` if others touched it; if the lockfile diff contains unrelated changes, report instead of staging them).

- [ ] **Step 2: Failing test** `apps/shopify/src/lib/themeWidgetMedia.test.ts`:

```ts
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// tryon-widget.js is a plain browser script with no module system. Its media
// finder sits between two marker comments; evaluate just that region.
const widgetPath = resolve(
  __dirname,
  '../../../shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.js',
);
const region = readFileSync(widgetPath, 'utf8').split('// <media-finder>')[1]?.split('// </media-finder>')[0];
if (!region) throw new Error('media-finder markers missing from tryon-widget.js');

type Found = { el: Element; needsRelative: boolean } | null;
const findMediaContainer = new Function(`${region}\nreturn findMediaContainer;`)() as (
  doc: Document,
  win: Window,
  opts: { selector?: string; productImage?: string },
) => Found;

const find = (opts: { selector?: string; productImage?: string } = {}) =>
  findMediaContainer(document, window, opts);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findMediaContainer', () => {
  it('uses the merchant selector when it matches', () => {
    document.body.innerHTML = '<div id="mine"></div><img src="/a.jpg">';
    expect(find({ selector: '#mine' })?.el.id).toBe('mine');
  });

  it('ignores an invalid merchant selector instead of throwing', () => {
    document.body.innerHTML = '<main><img src="/a.jpg"></main>';
    expect(() => find({ selector: '###bad[' })).not.toThrow();
  });

  it('finds the featured image across size suffixes and returns its positioned ancestor', () => {
    document.body.innerHTML = `
      <div class="gallery" style="position:relative">
        <div><img src="//cdn.shopify.com/s/files/1/products/shirt_1100x.jpg?v=3"></div>
      </div>
      <img src="//cdn.shopify.com/s/files/1/products/other_1100x.jpg">`;
    const found = find({ productImage: '//cdn.shopify.com/s/files/1/products/shirt_200x.jpg?v=3&width=200' });
    expect(found?.el.className).toBe('gallery');
    expect(found?.needsRelative).toBe(false);
  });

  it('skips thumbnails that share the image file name', () => {
    document.body.innerHTML = `
      <ul class="product__thumbs"><li><img src="/files/shirt_100x.jpg"></li></ul>
      <div class="product__media-wrapper"><img src="/files/shirt_900x.jpg"></div>`;
    const found = find({ productImage: '/files/shirt_200x.jpg' });
    expect(found?.el.className).toBe('product__media-wrapper');
    expect(found?.needsRelative).toBe(true);
  });

  it('falls back to the first image inside a known media wrapper', () => {
    document.body.innerHTML = `
      <header><img src="/logo.png"></header>
      <div class="product-gallery"><img src="/unrelated.jpg"></div>`;
    expect(find({ productImage: '/files/not-there.jpg' })?.el.className).toBe('product-gallery');
  });

  it('marks a static container as needing position:relative and skips <picture>', () => {
    document.body.innerHTML = '<main><div id="box"><picture><img src="/x.jpg"></picture></div></main>';
    const found = find();
    expect(found?.el.id).toBe('box');
    expect(found?.needsRelative).toBe(true);
  });

  it('returns null when the page has no usable image', () => {
    document.body.innerHTML = '<header><img src="/logo.png"></header><p>hello</p>';
    expect(find({ productImage: '/files/shirt.jpg' })).toBeNull();
  });
});
```

Run: `pnpm --filter @aivastra/shopify-admin test -- themeWidgetMedia` → should PASS once Task 4 is in (if it fails, the finder has a real bug; fix the finder in `tryon-widget.js`, not the test, unless the test's expectation contradicts the finder's documented rules).

- [ ] **Step 3: CSS.** In `tryon-widget.css`: (a) find `.aivastra-tryon--floating` (`grep -n "floating" tryon-widget.css`) and keep the rule as the fixed-position fallback but make sure it works for an icon (position fixed, right 16px, bottom 16px, z-index high, no width stretch); (b) **append at the end of the file** (do not insert elsewhere):

```css
/* theme block + icon (plan 4) */
.aivastra-tryon__btn-icon {
  display: inline-block;
  width: 1.15em;
  height: 1.15em;
  margin-right: 0.5em;
  vertical-align: -0.2em;
  background-color: currentColor;
  -webkit-mask: var(--aivastra-icon-url) center / contain no-repeat;
  mask: var(--aivastra-icon-url) center / contain no-repeat;
}

/* The embed's icon: a round badge on the product image. The glyph takes the
   text colour, the disc the button colour, so it reads on any photo. */
.aivastra-tryon--icon {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  margin: 0;
  width: auto;
}
.aivastra-tryon--icon.aivastra-tryon--floating {
  position: fixed;
  top: auto;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
}
.aivastra-tryon__icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--aivastra-icon-size, 40px);
  height: var(--aivastra-icon-size, 40px);
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  color: var(--aivastra-text-color, #fff);
  background: var(--aivastra-button-color, #000);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.aivastra-tryon__icon-btn .aivastra-tryon__btn-icon {
  width: 60%;
  height: 60%;
  margin: 0;
  vertical-align: baseline;
}
```

Check that the existing generic `.aivastra-tryon__button` rule (full-width, padding, background) does not fight `.aivastra-tryon__icon-btn`: if it sets `width: 100%`, `padding`, or `border-radius`, make the icon rule win by raising specificity (`.aivastra-tryon .aivastra-tryon__icon-btn`) rather than using `!important`.

- [ ] **Step 4: Commit**

```bash
git add apps/shopify/src/lib/themeWidgetMedia.test.ts apps/shopify/package.json pnpm-lock.yaml apps/shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.css
git commit -m "feat(shopify-extension): icon styles and media-finder test"
```

(`git add -p` for `pnpm-lock.yaml` and the CSS file if another plan has uncommitted hunks there.)

---

### Task 6: Merchant app: block-first onboarding, Dashboard prompt, Settings copy

**Files:**
- Create: `apps/shopify/src/lib/theme.ts`, `apps/shopify/src/lib/theme.test.ts`
- Modify: `apps/shopify/src/pages/OnboardingThemePage.tsx`, `apps/shopify/src/pages/DashboardPage.tsx`, `apps/shopify/src/pages/SettingsPage.tsx`, `apps/shopify/src/lib/onboarding.ts` (delete `needsEmbedEnable` only), `apps/shopify/src/lib/onboarding.test.ts` (delete its `needsEmbedEnable` cases only)

**Interfaces:**
- Consumes: `GET /v1/shopify/onboarding/theme-editor-url` returning `{ url, blockUrl, embedUrl }`; `POST /v1/shopify/onboarding/check-theme-embed` returning `{ themeBlockConfirmed, themeEmbedConfirmed }`; `me.store.settings.{themeBlockConfirmed, themeButtonBlockSeen, themeEmbedConfirmed}`.
- Produces: `needsButtonBlock(me: ShopifyMe): boolean` in `lib/theme.ts`: true when the store passed onboarding (`themeBlockConfirmed`) but has never seen the block render (`!themeButtonBlockSeen`).

- [ ] **Step 1: Failing test** `lib/theme.test.ts` (use the fixture style from `onboarding.test.ts` to build a minimal `ShopifyMe`; cast partial objects with `as unknown as ShopifyMe`):

```ts
import { describe, expect, it } from 'vitest';
import type { ShopifyMe } from '../types';
import { needsButtonBlock } from './theme';

const me = (settings: Record<string, unknown>) =>
  ({ store: { settings } }) as unknown as ShopifyMe;

describe('needsButtonBlock', () => {
  it('is true for a store that passed onboarding under the old embed rule', () => {
    expect(needsButtonBlock(me({ themeBlockConfirmed: true, themeEmbedConfirmed: true }))).toBe(true);
  });
  it('is false once the block has rendered on a storefront', () => {
    expect(needsButtonBlock(me({ themeBlockConfirmed: true, themeButtonBlockSeen: true }))).toBe(false);
  });
  it('is false for a store still in onboarding (the wizard handles it)', () => {
    expect(needsButtonBlock(me({}))).toBe(false);
  });
});
```

Run: `pnpm --filter @aivastra/shopify-admin test -- theme` → FAIL.

- [ ] **Step 2: Implement `lib/theme.ts`**

```ts
import type { ShopifyMe } from '../types';

/**
 * A store that passed onboarding while the storefront entry point was the app
 * embed's button: it has `themeBlockConfirmed` but no storefront has ever
 * rendered the button *block*. Since the embed became a corner icon, such a
 * store has no Try It On button until the merchant adds the block, so the
 * Dashboard says so. Clears on its own the first time the block renders (the
 * widget's signed ping sets `themeButtonBlockSeen`).
 */
export function needsButtonBlock(me: ShopifyMe): boolean {
  const { themeBlockConfirmed, themeButtonBlockSeen } = me.store.settings;
  return (themeBlockConfirmed ?? false) && !(themeButtonBlockSeen ?? false);
}
```

- [ ] **Step 3: Onboarding theme page**

Re-read `OnboardingThemePage.tsx`, then:
- `themeEmbedDone` → rename to `blockDone = me.store.settings.themeBlockConfirmed ?? false` (the wizard gate); add `const iconDone = me.store.settings.themeEmbedConfirmed ?? false;`. Update the comment above (it says both flags are set together).
- Polling effect and `checkStatus` keep their logic, keyed on `blockDone`. `checkStatus` still POSTs `check-theme-embed` (now checks block and icon).
- `THEME_STEPS` becomes:

```ts
const THEME_STEPS = [
  {
    title: 'Open Theme Settings',
    description: 'Click the button below. The Try It On button is added to your product page.',
  },
  {
    title: 'Position the Try It On button',
    description: 'Drag it where you want it on the product page, then click Save.',
  },
  {
    title: 'Optional: turn on the product image icon',
    description: 'Use the second button to add a try-on icon on your product photos.',
  },
];
```

- `openThemeEditor` takes which link to open: the API now returns `{ url, blockUrl, embedUrl }`; add

```tsx
  async function openThemeEditor(which: 'block' | 'embed') {
    setOpeningEditor(which);
    setError(null);
    try {
      const links = await apiFetch<{ blockUrl: string; embedUrl: string }>(
        '/v1/shopify/onboarding/theme-editor-url',
      );
      window.open(which === 'block' ? links.blockUrl : links.embedUrl, '_blank', 'noopener');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setOpeningEditor(null);
    }
  }
```

with `const [openingEditor, setOpeningEditor] = useState<'block' | 'embed' | null>(null);`.
- Buttons (inside the existing `.theme-tall-button` `BlockStack`): primary "Open theme settings" → `openThemeEditor('block')`, `loading={openingEditor === 'block'}`, `disabled={blockDone}`; secondary "Add try-on icon to product images (optional)" → `openThemeEditor('embed')`, `loading={openingEditor === 'embed'}`, `disabled={iconDone}`; then "Refresh status" as today (`disabled={blockDone && iconDone}`).
- Status panel: when `blockDone` show "AI Vastra Try It On button activated" (success) and, below it, `iconDone ? 'Product image icon on' : 'Product image icon: optional, not turned on'` as subdued text; the not-done copy becomes "If Save is greyed out, it's already added. Press Refresh status and we'll detect it automatically." and the `checkedNotFound` caution: "Not detected yet. Make sure the Try It On button is saved to your product page, then press Refresh status again in a moment, or open any product page on your live store (not the theme editor preview), which also confirms it automatically."
- Continue: `continueDisabled={!blockDone}` (was `themeEmbedDone`).
- The tutorial `<img>` stays; change its `alt` to "The theme editor's App embeds panel with the Try It On switch marked 1 and the Save button marked 2 (optional icon step)".

- [ ] **Step 4: Dashboard and Settings**

`DashboardPage.tsx` (re-read; plan 1 is removing the unrouted banner in the same file, so touch only these hunks): replace the import `needsEmbedEnable` with `import { needsButtonBlock } from '../lib/theme';` (keep `isTryOnOff` from `../lib/onboarding`); `embedNeeded` becomes `me != null && needsButtonBlock(me)`; the handler that calls `/v1/shopify/onboarding/theme-editor-url` now opens `blockUrl` (the `url` field is the block link, so the destructure `const { url }` already works; just update its comment "Opens the theme editor's App embeds panel with our embed switched on" to "Opens the product template with the Try It On button block staged"); update the nearby comment at ~215 ("For stores that already flipped the embed on...") to "For stores that already added the block before reopening this page". Banner: `title="Add the Try It On button to your product page"`, action `content: 'Add button'`, body: "Try It On is now a button you add to your product page (the app embed is now a small icon on your product photos). Until you add it, shoppers only see the icon. Already added it? Press Check now, or this message clears on its own once we see the button on a product page of your store." Keep the Check now flow (`check-theme-embed`).

`SettingsPage.tsx`: update the copy near line 216-222 (the "Add button block" card): the paragraph currently says "By default the Try It On app embed places the button above your Add to cart ... replaces the embed's button". Replace with: "The Try It On button is an app block: add it to your product page and drag it where you want it. The Try It On app embed adds a small icon on your product photos that opens the same try-on window." Keep the existing button (it opens `theme-block-url`).

`lib/onboarding.ts` (re-read first; plan 1 rewrote it): delete `needsEmbedEnable` and its doc comment. `lib/onboarding.test.ts`: delete the `needsEmbedEnable` describe block and its import. Run `grep -rn "needsEmbedEnable" apps/shopify/src` → no results.

- [ ] **Step 5: Verify, commit**

Run: `pnpm --filter @aivastra/shopify-admin test && pnpm --filter @aivastra/shopify-admin typecheck && pnpm --filter @aivastra/shopify-admin lint` (failures in files owned by other plans are not yours; report them).

```bash
git add apps/shopify/src/lib/theme.ts apps/shopify/src/lib/theme.test.ts apps/shopify/src/pages/OnboardingThemePage.tsx apps/shopify/src/pages/DashboardPage.tsx apps/shopify/src/pages/SettingsPage.tsx apps/shopify/src/lib/onboarding.ts apps/shopify/src/lib/onboarding.test.ts
git commit -m "feat(shopify): onboarding adds the button block first; icon optional; prompt legacy stores to add the block"
```

(`git add -p` for the shared files so you stage only your hunks.)

---

### Task 7: Verification and manual dev-store script (no deploy)

- [ ] **Step 1: Automated.** Report counts for: `pnpm --filter @aivastra/api test -- onboarding`; from `apps/api`: `npx vitest run --config vitest.integration.config.ts shopify-onboarding shopify-customer-app-proxy shopify-customer`; `pnpm --filter @aivastra/shopify-admin test`; `node --check` on the widget; the schema JSON check from Task 3; `pnpm --filter @aivastra/api typecheck` and `pnpm --filter @aivastra/shopify-admin typecheck`.
- [ ] **Step 2: Put the manual script in your final report** for whoever deploys to a staging dev store (`make shopify-deploy-staging`): (1) theme with Dawn: onboarding page 4, "Open theme settings" opens the editor with the Try It On button staged in the product's main section; Save; the page's status flips to activated within 5s of a live product page view; (2) "Add try-on icon" opens the App embeds panel with the embed switched on; Save; a round icon appears at the top-right of the main product image and opens the **same** modal as the button (check there is exactly one modal and one history); (3) disable the product: both icon and button disappear; (4) embed on, **no** block: the icon alone works and opens its own modal; (5) block on, embed off: button only; (6) one older (non-JSON) theme: the embed icon appears or falls back to the floating icon after ~3s with the console warning; (7) a store that passed onboarding before this release: Dashboard shows "Add the Try It On button" until the block renders; (8) theme editor preview and an unpublished theme do **not** flip any flag (`dm=1`).
- [ ] **Step 3: Report** (no commit).

---

## Final report additions for the manager

- Behaviour changes for `docs/progress.md`: `themeBlockConfirmed` is now set only by `source=block`; new flag `themeButtonBlockSeen`; `themeEmbedConfirmed` means the icon; `/theme-editor-url` returns `blockUrl` and `embedUrl` (`url` = block link); `check-theme-embed` now also inspects `templates/product.json`; embed settings changed (`button_*`, `promo_text`, `placement_selector` removed; `icon_*`, `media_selector` added), which resets those merchant-saved values.
- **Live-store impact to flag before any production deploy:** every storefront with the embed on loses its button at deploy and shows an icon instead until the merchant adds the block. This needs a staging pass (Task 7) and a merchant-facing note.
- State outside the repo: `shopify app deploy` publishes this; nothing in CI does.
- Open items: new "Add block" tutorial screenshot (design); `jsdom` devDependency added to `apps/shopify`; icon re-render resilience on themes that rebuild the gallery after load is not handled (the floating fallback only covers "never found").

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| Block = button; embed = corner icon on the main image; same modal | 3, 4 |
| Delete `placeWidget`, the 3s button wait, `placement_selector`, "block wins" logic | 4 |
| Icon placement heuristic, fallback floating icon, `media_selector` | 4, 5 |
| Button icon (`show_icon`), transparent asset, mask in `currentColor` | 1, 3, 5 |
| Move `tryon_icon.png` to the extension's assets | 1 |
| Onboarding page 4: block deep link primary, icon link secondary | 2, 6 |
| Completes when the block is seen live; legacy flag still honoured | 2, 6 |
| Existing merchants: Dashboard notice, no forced re-onboarding | 2, 6 |
| `shopify app deploy` is the manager's call; staging first | 7 |
| Risks: theme variance (fallback + selector), whole-storefront change | 4, 7 |
