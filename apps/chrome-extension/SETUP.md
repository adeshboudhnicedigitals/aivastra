# Setup & execution checklist

Written so a session with no prior context can pick this up and execute
phase by phase. Read `PLAN.md` first for the *why* behind each step — this
file is the *what, in order*. Check items off (or note deviations) in
`PROGRESS.md` as you go; don't edit this checklist itself to mark things done.

Do not start this until the current WordPress plugin work
(`fixes-wrap/wp-plugin` branch) is fully pushed and merged to `dev` — this is
a standing instruction from the person driving this work, not a technical
dependency.

## Phase 0 — before writing any code

- [ ] Re-read `PLAN.md` in full; re-verify the file/line references it cites
      still match current `dev` (the repo moves fast — confirm
      `apps/api/src/modules/dev/create-job.ts`,
      `packages/types/src/job-taxonomy.ts`, and
      `apps/api/src/modules/dev/routes.ts:443-602` still look as described).
- [ ] Confirm `dev_tryon_categories` has rows suitable for an extension
      category picker (`SELECT * FROM dev_tryon_categories;` locally). If
      empty or stale, flag it — this is admin-managed data, not seeded code,
      same gap class as the WordPress plugin's `credit_plans` issue earlier.
- [ ] Reserve the Chrome Web Store listing early (even as an unpublished
      draft) to get a **stable extension ID** before wiring the manifest —
      an unpacked dev build's ID is unstable per-directory, so the real
      published ID should be known before hardcoding anything that depends
      on it.

## Phase 1 — backend

File-by-file, in `apps/api` and `packages/types`:

- [ ] `packages/types/src/job-taxonomy.ts` — add
      `EXTENSION_TRYON: 'extension_tryon'` to `JOB_SOURCE`; add it to
      `IMAGE_COMPRESSION_JOB_SOURCES` alongside `TRYON`/`API_TRYON`/
      `MERCHANT_TRYON`/`WORDPRESS_TRYON`.
- [ ] New `apps/api/src/modules/extension/create-job.ts` —
      `createExtensionTryonJob()`, modeled on `createDevTryonJob()`
      (`apps/api/src/modules/dev/create-job.ts:113-179`): resolve
      `dev_tryon_categories` by slug, check `user.isBanned`, call
      `createDevJobCore()` (`apps/api/src/modules/dev/create-job.ts:18-96`)
      with the JWT's `userId` and no `apiKeyId`.
- [ ] New `apps/api/src/modules/extension/routes.ts` —
      `POST /v1/extension/tryon`, `requireUser`-guarded. Mirror
      `/v1/dev/tryon`'s body contract (`apps/api/src/modules/dev/routes.ts:443-602`):
      multipart OR base64 JSON, fields `category`/`person`/`garment`,
      `sniffImageMime` + `getUploadLimitBytes` validation, upload via
      `app.storage.putObject()`, then call `createExtensionTryonJob()`.
- [ ] `apps/api/src/server.ts` — register the new `extension` module.
- [ ] No DB migration needed (reusing `dev_tryon_categories` as-is).
- [ ] No CORS change needed — confirm `apps/api/src/server.ts`'s CORS
      allowlist is untouched; the extension talks to the API only from its
      background service worker/popup, which get a `host_permissions`-based
      CORS bypass automatically (see `PLAN.md`).
- [ ] New integration test file, e.g.
      `apps/api/test/integration/extension-tryon.test.ts`, mirroring whatever
      `dev-tryon.test.ts` is called today — happy path, insufficient credits,
      invalid category, oversized image.
- [ ] `pnpm --filter @aivastra/api test:integration`,
      `pnpm --filter @aivastra/api typecheck`, `pnpm --filter @aivastra/api lint`
      all green before moving on.

## Phase 2 — extension package scaffold

- [ ] `mkdir -p apps/chrome-extension/src/{background,content,popup}`
- [ ] `apps/chrome-extension/package.json` — name, scripts
      (`dev`/`build`/`typecheck`/`lint`/`test`), devDependencies including
      `@crxjs/vite-plugin`, `vite`, `typescript`. Match `apps/shopify/package.json`'s
      shape where sensible (script names, TS config extends
      `tsconfig.base.json`).
- [ ] `apps/chrome-extension/vite.config.ts` — wire `@crxjs/vite-plugin`
      against `manifest.json`.
- [ ] `apps/chrome-extension/manifest.json` — MV3, `permissions: ["storage",
      "identity"]`, `host_permissions: ["https://api.aivastra.com/*", "<all_urls>"]`,
      background service worker entry, content script `matches: ["<all_urls>"]`,
      popup entry, icons.
- [ ] `apps/chrome-extension/src/background/api-client.ts` — thin wrapper
      calling `device-login`, `device-login/google`, `device-refresh`,
      `/v1/extension/tryon`, `/v1/credits`.
- [ ] `apps/chrome-extension/src/background/index.ts` — service worker:
      `chrome.storage.local` token read/write, `chrome.runtime.onMessage`
      router (login, logout, get-credits, submit-tryon,
      fetch-cross-origin-image), 401-triggers-refresh logic.
- [ ] Add `apps/chrome-extension` to `config/ci-targets.json`'s
      `separateSurfaces` array (same treatment as `apps/shopify-extension`).
- [ ] `.env.example` or equivalent documenting `VITE_API_BASE_URL` for local
      vs. production builds, matching `apps/shopify`'s `VITE_API_BASE_URL`
      convention.

## Phase 3 — content script

- [ ] `apps/chrome-extension/src/content/detect.ts` — three-tier heuristic
      (JSON-LD `Product` → Open Graph → largest-image-near-buy-text fallback).
      No button injected if nothing matches.
- [ ] `apps/chrome-extension/src/content/widget/` — port
      `wordpress-plugin/assets/widget.js`'s state machine and
      `wordpress-plugin/assets/widget.css` into a shadow root. Re-target DOM
      queries at the shadow root; drop any WooCommerce-global-reading code
      paths (there shouldn't be much — `widget.css` is already fully
      self-contained).
- [ ] `apps/chrome-extension/src/content/index.ts` — orchestrates: run
      detection on page load, inject floating button near the detected
      product image, mount the shadow-DOM modal on click, message the
      background worker for auth state / image fetch / job submission (never
      call the API directly from here).

## Phase 4 — popup

- [ ] `apps/chrome-extension/src/popup/index.html` + `popup.ts` — login form
      (email/password → `device-login` via background message), "Sign in with
      Google" button (`chrome.identity.launchWebAuthFlow` → `device-login/google`),
      credit balance display (`GET /v1/credits` via background message),
      "Buy credits" button opening `https://app.aivastra.com/pricing` in a
      new tab.

## Phase 5 — polish and store prep

- [ ] Error states: out of credits, detection failed, image too large, job
      failed server-side, network/offline.
- [ ] Icons (16/32/48/128px) and a short promotional description.
- [ ] Privacy policy page (required by Chrome Web Store) — must accurately
      describe what the extension reads (page content for product detection,
      the user's uploaded photo) and what it sends to Ai Vastra's backend.
- [ ] `host_permissions` justification text for Store review, explaining why
      `<all_urls>` is needed (heuristic detection on arbitrary sites was an
      explicit product choice, not an oversight).
- [ ] Manual click-through checklist (see `PLAN.md`'s Verification section)
      run to completion and recorded in `PROGRESS.md`.

## Rollback / blast-radius notes

- Everything in Phase 1 is additive (new module, new enum value, new table
  reuse) — nothing existing is modified except `server.ts`'s route
  registration list and `job-taxonomy.ts`'s enum, both append-only changes.
- The extension package itself has zero runtime coupling to any other app —
  deleting `apps/chrome-extension` and reverting the Phase 1 backend diff
  fully removes the feature with no cleanup elsewhere.
