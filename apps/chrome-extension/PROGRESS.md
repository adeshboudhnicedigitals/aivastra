# Progress log

Dated, newest-first, append-only — same convention as the root
`docs/progress.md`. Add a new entry at the top each time work happens on this
feature; never edit or delete an older entry, only add to it.

---

## 2026-10-06 (fix: content script never ran)

User tested the MVP on a real Shopify product page
(mydesignation.com) — login via the popup worked, but the on-page "Try It On"
button never appeared on *any* site.

**Root cause:** `content/index.js` (and its imports `detect.ts`/`widget.ts`/
`shared/messaging.ts`) was tsc-emitted as plain ES module JS with bare
`import`/`export` statements. Chrome's `content_scripts` manifest entry has no
module-type option — unlike `background` (`"type": "module"`) or an HTML
`<script type="module">` (how the popup loads), a content script is always
run as a classic script. A classic script containing `import`/`export` throws
an immediate `SyntaxError` and never executes at all, so detection never ran
on any page, not just this one — the page's own markup
(`og:type="product"` + `og:image` were both present and would have matched
tier 2) was never the problem.

**Fix:** added `esbuild` as a devDependency and rewrote
`scripts/build.mjs` to (1) run `tsc --noEmit` for type-checking only, then
(2) bundle each of the three entry points (`background/index.ts`,
`content/index.ts`, `popup/popup.ts`) with esbuild into a single
dependency-free IIFE per output file — no runtime `import`/`export` left
anywhere in `dist/`. Verified: `grep -E '^\s*(import|export)\s'` across all
three `dist/*.js` outputs now matches nothing; typecheck and biome lint both
still clean (same 2 pre-existing non-blocking `noNonNullAssertion` warnings
as before, unrelated to this fix).

---

## 2026-10-06 (MVP implemented)

User decided not to wait for the WordPress plugin branch to land — asked for a
working MVP now, to test locally and iterate from. Supersedes the "not done /
deferred" note in the entry below.

**Done — backend**
- `JOB_SOURCE.EXTENSION_TRYON = 'extension_tryon'` added
  (`packages/types/src/job-taxonomy.ts`), wired into
  `IMAGE_COMPRESSION_JOB_SOURCES`'s `COMPRESSED_BY_DEFAULT`
  (`packages/types/src/image-compression.ts`) and into the Studio gallery's
  source-exclusion filter (`apps/api/src/modules/jobs/routes.ts`) so extension
  jobs don't leak into a user's own curated catalog gallery.
- `keys.extensionUpload(userId, id, ext)` added (`packages/storage/src/keys.ts`).
- `createDevJobCore`'s `apiKeyId` param widened to `string | null`
  (`apps/api/src/modules/dev/create-job.ts`) to support callers with no API key.
- New module `apps/api/src/modules/extension/`:
  - `create-job.ts` — `createExtensionTryonJob()`, resolves
    `dev_tryon_categories` by slug (same table/shape the plan called for),
    checks `isBanned`, computes a real `watermark` via the existing
    `resolveQueueRouting()` (deviates from `/v1/dev/tryon`'s hardcoded
    `false` — extension users spend their own plan's credits, so they get
    their plan's actual watermark entitlement).
  - `routes.ts` — `GET /v1/extension/categories`, `POST /v1/extension/tryon`
    (multipart-or-base64-JSON body, same contract as `/v1/dev/tryon`),
    `GET /v1/extension/jobs/:id` (scoped to the caller's own `userId` +
    `source === EXTENSION_TRYON`). All `requireUser`-guarded, tagged
    `['extension']` (hidden from public Swagger docs, same as `wp-internal`).
  - Registered in `apps/api/src/server.ts`.
- New test file `apps/api/test/extension-tryon.test.ts` — 17 tests, all
  passing. Full existing suite re-run: 788/788 passing, zero regressions.

**Done — extension package (`apps/chrome-extension/`)**
- MV3 skeleton: `manifest.json`, background service worker, content script,
  popup — structure follows `PLAN.md` with one deliberate build-tooling
  deviation (see below).
- `src/background/` — `api.ts` (full API client: login/logout/credits/
  categories/submit/poll, `fetchImageAsDataUrl` via `arrayBuffer()`+`btoa`
  since `FileReader` isn't reliable in a service worker), `index.ts`
  (message router). This is the only context that calls the Aivastra API or
  fetches cross-origin product images — confirmed necessary because MV3's
  `host_permissions` CORS bypass applies only to the background worker and
  popup, not to a content script's own `fetch()`.
- `src/content/` — `detect.ts` (JSON-LD → Open Graph → DOM heuristic product
  detection), `widget.ts` + `widget.css` (shadow-DOM-isolated floating button
  + panel, state machine: login → category/photo form → poll → result),
  `index.ts` (orchestrator).
- `src/popup/` — login form, credit balance, "Buy credits" (opens
  `https://app.aivastra.com/pricing` in a new tab), logout.
- `scripts/build.mjs` + placeholder icons (`icons/icon{16,48,128}.png`).
- Verified: `pnpm install`, `typecheck` clean, `biome check` clean except 2
  non-blocking `noNonNullAssertion` style warnings (same pre-existing pattern
  as `dev-tryon-create.test.ts` elsewhere in the repo), `pnpm --filter
  @aivastra/chrome-extension build` produces a complete `dist/` folder loadable
  as an unpacked extension.

**Deliberate deviations from `PLAN.md`**
- Build tool: plain `tsc` + a small Node copy script (`scripts/build.mjs`)
  instead of Vite + `@crxjs/vite-plugin` — fewer new dependencies, lower risk,
  faster to a testable MVP. Revisit if/when HMR dev workflow is worth the
  extra tooling.
- Google sign-in: not implemented — `identity` permission intentionally
  omitted from `manifest.json`. Email/password device-login only, for now.
- Billing: no in-extension Razorpay checkout (as the plan already called for)
  — popup's "Buy credits" opens the pricing page in a new tab.
- Icons are placeholder PNGs (pink background, "AV" text), not final brand
  assets.
- No automated extension tests — `test` script is a placeholder; manual
  click-through checklist lives in `PLAN.md`'s Verification section.

**Not done / still open**
- Real icons, Google sign-in, in-extension billing, automated extension
  tests — all deferred, not blocking local testing.
- Not yet verified against a real local dev DB: whether an active
  `dev_tryon_categories` row with a valid, active `workflowTemplateId` exists
  locally (the automated test suite seeds its own isolated DB, which doesn't
  tell us anything about the shared local dev database).
- Chrome Web Store `<all_urls>` permission justification text — not yet
  written (only relevant once this ships beyond local testing).

---

## 2026-10-06

**Done**
- Full architecture and execution plan designed and written up
  (`PLAN.md`, `SETUP.md`): auth strategy (reuse device-login), new backend
  route design (`/v1/extension/tryon`, sibling to `/v1/dev/tryon`), CORS
  approach (no server change — route calls through the background worker),
  UI approach (Shadow DOM port of `widget.js`/`widget.css`), package
  structure (`apps/chrome-extension`, Vite + `@crxjs/vite-plugin`), phased
  execution checklist.
- This folder (`apps/chrome-extension/`) created with planning docs only —
  no extension code, no backend changes yet.

**Not done**
- No implementation started. Explicitly deferred until the current
  `fixes-wrap/wp-plugin` branch is pushed and merged to `dev`.

**Open questions**
- Exact final name/location for the new API route (`/v1/extension/tryon`
  assumed in the plan — fine to revisit when backend work actually starts).
- Whether `dev_tryon_categories` currently has rows suitable for an extension
  category picker — not yet checked (see Phase 0 in `SETUP.md`).
- Chrome Web Store review requirements for the `<all_urls>` host permission —
  not yet researched.
