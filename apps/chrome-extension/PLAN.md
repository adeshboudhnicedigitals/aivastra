# Plan: shopper-facing virtual try-on Chrome extension

## Context

The WordPress plugin only works on stores that installed it. The goal is to
make the try-on experience available to **shoppers**, on **any clothing/product
page, heuristically detected** — not limited to Ai Vastra-integrated stores
(decision confirmed explicitly: shoppers install it, detection is heuristic,
not a curated site allowlist). That means a browser extension the shopper
installs once, which then detects a product image on whatever site they're
browsing and offers to try it on using their own photo.

This is a new surface, not a port of the WordPress plugin's code. The plan
below reuses as much of the existing backend as fits and adds the minimum new
surface area required.

## Key architecture decisions

### Auth: reuse the existing device-login flow, unchanged

`POST /v1/auth/device-login`, `/device-login/google`, `/device-refresh`
(`apps/api/src/modules/auth/routes.ts`) already return tokens purely in the
JSON body with no cookie dependency — the only existing auth flow that fits a
non-browser-page client. `requireUser` (`apps/api/src/plugins/auth.ts`) is
header-only Bearer JWT, so it needs no changes either. The extension's popup
does email/password login via `device-login`; "Sign in with Google" uses
`chrome.identity.launchWebAuthFlow` to get a Google ID token, posted to
`device-login/google`. Tokens persist in `chrome.storage.local` (not `sync` —
this is per-device credential material); a 401 triggers `device-refresh`.
**No new auth backend work.**

### New job-creation route — not a reuse of `/v1/jobs/tryon` or `/v1/dev/tryon`

Neither existing route fits: `/v1/jobs/tryon` requires an admin-curated
`faceId` (wrong shape — the shopper's own photo isn't a curated model face);
`/v1/dev/tryon` (`apps/api/src/modules/dev/routes.ts:443-602`) is scoped to a
merchant's API key, not a platform user's JWT. The fix is a new, small route
that copies `/v1/dev/tryon`'s proven raw-bytes contract but authenticates with
`requireUser` instead of an API key:

- New module `apps/api/src/modules/extension/routes.ts`:
  `POST /v1/extension/tryon`, `requireUser`-guarded, same multipart-OR-base64
  JSON body shape as `/v1/dev/tryon` (`category`/`person`/`garment`), same
  MIME-sniff/size-validation calls (`sniffImageMime`, `getUploadLimitBytes`),
  uploads both images via `app.storage.putObject()`.
- New `apps/api/src/modules/extension/create-job.ts`: a `createExtensionTryonJob()`
  function, sibling to `createDevTryonJob()` (`apps/api/src/modules/dev/create-job.ts:113-179`)
  not a modification of it — it resolves `dev_tryon_categories` by slug
  exactly the same way, but calls `createDevJobCore()`
  (`apps/api/src/modules/dev/create-job.ts:18-96`, already generic over caller
  identity) with `userId` from the JWT and no `apiKeyId` (the `jobs.api_key_id`
  column is already nullable — confirmed in `packages/db/src/schema/jobs.ts`).
- New `JOB_SOURCE` value in `packages/types/src/job-taxonomy.ts`:
  `EXTENSION_TRYON: 'extension_tryon'`, following the exact pattern of
  `WORDPRESS_TRYON`/`API_TRYON`. Add it to `IMAGE_COMPRESSION_JOB_SOURCES`
  alongside the other tryon-family sources (same file area) so extension
  uploads get the same compression treatment as every other tryon path.
- Credit cost: reuse `getTryonCreditCost()` (`apps/api/src/lib/resolution-config.ts`)
  — same admin-configured price as the platform's own tryon, no new pricing
  concept needed.
- `dev_tryon_categories` (existing table) is reused unchanged for the
  category→`workflowTemplateId` mapping. **Open item:** this table needs rows
  an admin can actually pick from in the extension's category selector — same
  kind of data gap as a past session's `credit_plans` finding for the
  WordPress plugin. Check before considering this feature "done."

### No server-side CORS change needed

Route all API calls through the background service worker, **not** the
content script. Chrome grants extension **background service workers and the
popup** a CORS bypass for any origin covered by the extension's own
`host_permissions` — the browser simply doesn't enforce SOP there. That bypass
does **not** extend to content scripts, whose `fetch()` calls run subject to
the host page's own CORS like any other page script. The correct design is
therefore: the content script never calls `api.aivastra.com` directly. It
sends a `chrome.runtime.sendMessage` to the background service worker, which
holds the stored token and makes the actual `fetch()`. This also centralizes
token storage/refresh in one place instead of duplicating it across content
scripts injected into every open tab. **Net effect: zero changes to
`apps/api/src/server.ts`'s CORS allowlist.**

### Cross-origin product-image fetching also goes through the background worker

Same CORS-bypass reasoning — the content script detects *which* image to use
and messages its URL to the background worker, which fetches the bytes
(privileged, via `host_permissions`) and messages them back as a data URL.
This avoids needing a server-side image-proxy endpoint entirely.

### UI: Shadow DOM, porting `widget.js`/`widget.css`'s existing state machine and styling

Unlike the WordPress widget (which only ever runs on a site the merchant
controls), this extension runs on arbitrary unknown pages, so the injected
button+modal must be fully isolated via a shadow root to avoid the host
page's CSS/JS colliding with it. `wordpress-plugin/assets/widget.css` is
already fully self-contained (`.aivastra-*`-scoped, no WP/WC global
dependency), so it ports into a shadow root largely as-is;
`wordpress-plugin/assets/widget.js`'s state-machine functions
(upload → submit → poll/SSE → result) port with their DOM query selectors
re-targeted at the shadow root and their WooCommerce-specific bits (anything
reading WC globals) dropped.

### Billing: open the existing pricing page in a new tab, don't embed Razorpay

Razorpay's checkout is an embedded JS SDK; extension pages have a strict
default CSP that makes embedding a remote script like that risky to get
through Chrome Web Store review. Defer to a fast-follow. V1: a "Buy credits"
button in the popup opens `https://app.aivastra.com/pricing` in a new tab.

## New package: `apps/chrome-extension`

Mirrors `apps/shopify`'s conventions (Vite, `package.json` script names
`dev`/`build`/`typecheck`/`lint`/`test`) — auto-discovered by
`pnpm-workspace.yaml`'s `apps/*` glob. Build tool: `@crxjs/vite-plugin` (Vite
HMR for extension dev, standard MV3 manifest generation). No framework for the
content script, matching `widget.js`'s vanilla-JS convention; the popup can
also stay vanilla HTML/TS to keep the bundle small and the CSP simple.

```
apps/chrome-extension/
  manifest.json           # MV3: permissions [storage, identity], host_permissions
                           # [https://api.aivastra.com/*, <all_urls> for detection]
  src/
    background/
      index.ts             # service worker: token storage/refresh, message router,
                            # proxies API calls + cross-origin image fetch
      api-client.ts         # device-login/device-refresh/extension-tryon calls
    content/
      index.ts              # injected on <all_urls>; runs detection, mounts shadow root
      detect.ts              # tiered heuristics: JSON-LD Product -> OG tags -> DOM fallback
      widget/                # ported widget.js state machine + widget.css, shadow-scoped
    popup/
      index.html
      popup.ts               # login, Google sign-in, credit balance, "Buy credits" link
  package.json
  vite.config.ts
```

Build-time config via Vite `import.meta.env.VITE_API_BASE_URL`, same pattern
`apps/shopify/src/lib/api.ts:17` already uses — a dev build points at
`localhost`, the shipped build at `https://api.aivastra.com`.

Monorepo wiring: add an entry to `config/ci-targets.json`'s `separateSurfaces`
array (same treatment as `apps/shopify-extension` — no Docker/server
component, so it's excluded from the normal per-service CI/deploy matrix but
still linted/typechecked/tested via the plain `pnpm -r` targets).

## Detection heuristics (content script)

Tiered, cheapest/most-reliable first:
1. `schema.org` `Product` JSON-LD (`<script type="application/ld+json">`
   containing `"@type":"Product"`) — read `image`/`offers` directly.
2. Open Graph tags — `og:type=product`, `og:image`.
3. Fallback: largest `<img>` near text matching `/add to cart|add to bag|buy now/i`.

If none match, no button is injected — avoids false positives on non-product
pages without needing a server-side allowlist of supported sites.

## Phased execution

1. **Backend** — `JOB_SOURCE.EXTENSION_TRYON`, `IMAGE_COMPRESSION_JOB_SOURCES`
   entry, `apps/api/src/modules/extension/{routes,create-job}.ts`, register in
   `apps/api/src/server.ts`. No DB migration, no CORS change.
2. **Extension skeleton** — `apps/chrome-extension` scaffold, manifest,
   background service worker with login/token-refresh/message-router.
3. **Content script** — detection heuristics, floating button, shadow-DOM
   modal ported from `widget.js`/`widget.css`.
4. **Popup** — login form, Google sign-in, credit balance (`GET /v1/credits`),
   "Buy credits" tab-open link.
5. **Polish** — error states (out of credits, detection failed, upload too
   large), Chrome Web Store listing prep (icons, privacy policy, justification
   text for the `<all_urls>` host permission — required by Store review since
   it's a broad permission).

Full step-by-step checklist for each phase lives in `SETUP.md`.

## Verification

- Backend: new integration test file under `apps/api/test/integration/` for
  `POST /v1/extension/tryon`, mirroring `dev-tryon.test.ts`'s style (happy
  path, insufficient credits, invalid category, oversized image) — run via
  `pnpm --filter @aivastra/api test:integration`. `pnpm --filter @aivastra/api
  typecheck` + `lint` for the new module.
- Extension: no automated e2e for v1 (headless-Chrome-extension testing is
  heavy for the value it adds here) — manual click-through instead, consistent
  with how this repo already treats other browser-only flows. Checklist:
  load unpacked in Chrome, verify detection fires on a real product page from
  each of 2-3 different platforms (plain HTML/schema.org site, a Shopify
  storefront, a WooCommerce storefront) to stress all three detection tiers;
  full login → upload → try-on → result loop; token refresh after forcing
  expiry; "Buy credits" opens the right tab; confirm the background worker
  (not the content script) is what's issuing the API calls (check the
  Network tab under the service worker's own DevTools context, not the page's).
- Before Store submission: confirm the manifest's `host_permissions`
  justification text in the Chrome Web Store listing accurately describes why
  broad access is needed (shopper chose "any site, heuristically" over a
  curated allowlist).

## Open design questions / not yet locked in

These are judgment calls made during planning that are worth re-confirming
before or during implementation, not before planning further:

- Exact new API route name/location (`/v1/extension/tryon` assumed) — fine to
  revisit if a better-fitting module boundary becomes obvious once backend
  work starts.
- Whether Google sign-in ships in v1 or as a fast-follow (currently planned
  for v1 since it's a near-zero-cost reuse of `device-login/google`).
- Chrome Web Store review timeline/requirements for the `<all_urls>` host
  permission — not yet researched in detail, flagged in the Polish phase.
