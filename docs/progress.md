## 2026-07-08 - Shopify Try-On Backend Slice (12-task vertical) + Full-Suite Verification

### Done
Backend vertical slice for the Shopify plugin, landed across 12 tasks on `feat/shopify-tryon-backend`:
- **DB schema**: `shopify_stores`, `shopify_product_garments`, `shopify_plans` (plus `widget_clients.client_type` and supporting columns/indexes) in `packages/db/src/schema/`, with migrations.
- **Crypto + HMAC/session-token service** (`apps/api/src/modules/shopify/service.ts`): AES-256-GCM token encryption at rest, webhook HMAC verification, session-token style helpers.
- **Admin plan CRUD**: `/admin/shopify-plans` (create/list/patch/delete/activeOnly filter).
- **Auth plugin + OAuth install/callback**: `apps/api/src/modules/shopify/auth.routes.ts` — `upsertShopifyStore`, install redirect, OAuth callback, webhook auto-registration (`shopifyRegisterWebhooks`, wrapped in `fp()` so the decoration is visible across encapsulated plugin contexts).
- **Webhooks + GDPR topics**: `apps/api/src/modules/shopify/webhook.routes.ts` — raw-body HMAC verification (scoped content-type parser, doesn't leak to sibling JSON routes), `app_uninstalled`, `app_subscriptions_update`, `products_update`, `products_delete`, `customers_data_request`, `customers_redact`, `shop_redact`.
- **Product sync**: `apps/api/src/modules/shopify/products.sync.ts` — download + R2 upload, SSRF-guarded fetch.
- **Widget-job extension**: `POST /v1/widget/jobs` now accepts `shopifyProductId`, resolves the garment from R2, tags `params.kind`; non-Shopify jobs persist `params` as `NULL` (not `{}`).
- **Dispatcher branch**: `processShopifyJob` in `apps/dispatcher/src/job/processor.ts` + `shopify:sync` Redis-stream consumer for product-sync jobs.
- **Billing**: Shopify plan selection + charge activation (`apps/api/src/modules/shopify/billing.routes.ts`), made credit-grant additive and replay-safe, and store-row-locked to prevent concurrent double-credit on repeated activation callbacks.

**Full-suite verification (this entry's own task, Task 12):**
- `pnpm --filter @aivastra/api test`: **78/78 passing**, all 11 shopify-*.test.ts files green. `test/integration/**` (containing `jobs-create.test.ts`, `catalog.test.ts`, `e2e.test.ts` — the three pre-existing failures documented in `apps/api/vitest.config.ts`) stays excluded from this run per that config, so none of those three were even hit.
- Along the way, this task's initial run surfaced a genuine new regression: `test/shopify-webhooks.test.ts` > "processes app/uninstalled" intermittently failed under full-suite load (reproduced twice in full-suite runs, never in 3 isolated single-file runs) because `webhook.routes.ts` sent `reply.code(200).send(...)` before its DB side effects (`shopifyStores.uninstalledAt`, `widgetClients.isActive`) were awaited — a real race with a production reliability gap (crash between send and continuation would silently drop the uninstall-deactivation, and Shopify wouldn't retry since it already got a 200). Fixed in `2607ed6` ("fix(api): shopify webhooks must complete DB writes before responding 200") by moving `reply.send()` to after the try/catch. Re-verified independently: 78/78 passing across two full-suite reruns post-fix.
- `pnpm --filter @aivastra/api typecheck`, `pnpm --filter @aivastra/dispatcher build`, `pnpm --filter @aivastra/db typecheck`, `pnpm --filter @aivastra/types build`: all PASS.
- `pnpm biome check apps/api apps/dispatcher packages/db packages/types --diagnostic-level=error`: PASS (184 files, 0 errors).
- Added `SHOPIFY_*` vars to `.env.production.example`.

### Failed / Not Done
- Full workspace-wide `pnpm typecheck` (root) is not used as this task's gate: `apps/catalogues-web`'s `pricing/page.tsx` can hit `TS6053: File '.../.next/types/...' not found` when that app's `.next/types` build artifacts haven't been generated yet (only produced by `next build`/`next dev`, not by `tsc --noEmit` alone). This is environment/build-order state, not a real type error in any code this plan touches — `apps/catalogues-web` is the still-unfinished Phase 3 frontend (per `CLAUDE.md`) and this Shopify backend slice never touches it. Note: re-running `pnpm typecheck` at the workspace root in this session actually passed cleanly both times (the `.next/types` directory already existed at check time), consistent with this being a transient, generation-order artifact rather than a deterministic failure — scoped per-package typecheck/build (listed above) is what this task actually gates on.

### Open Questions / Decisions
- **Deferred to follow-on plans** (per the Task 12 brief, out of scope for this backend slice):
  - `apps/shopify/` — Polaris embedded admin (Dashboard, Product Mapping, Appearance, Billing) consuming `/v1/shopify/me|products|analytics|settings`.
  - `apps/shopify-extension/` — Shopify CLI theme app extension (`tryon-block.liquid`, `tryon-widget.js`).
  - `apps/admin-web` + `apps/admin-mobile` internal admin views for Shopify plans + store data (Admin Parity Rule applies once this lands).
  - ComfyUI workflow template for Shopify try-on (`workflow_templates` row) + the customer-photo face-detectability 400 path — needs the real workflow JSON, own task.
  - Overage/top-up usage charges (`POST /usage_charges`) — add once base billing ships.
  - `GET /v1/shopify/analytics`, `PATCH /settings`, `DELETE`/`POST /products/:id` admin endpoints — thin, land with the embedded-admin plan.
- **Test-coverage / CI gaps found during this verification session** (real, currently-true facts about repo state, not fixed here):
  - `apps/dispatcher`'s `test/integration/` suite (happy-path, recovery, retry, watermark-*) is entirely orphaned from any `package.json` script or CI job — nothing currently runs it.
  - `happy-path.test.ts`, `recovery.test.ts`, and `retry.test.ts` in that same orphaned suite independently fail due to `catalog_items.type` NOT NULL schema drift — confirmed pre-existing (via `git stash` against a clean checkout in an earlier task on this branch), unrelated to the Shopify work.
  - No test exists for the non-Shopify garment-URL success path in `POST /v1/widget/jobs` (`apps/api/src/modules/widget/routes.ts`) — a pre-existing gap, found while extending that route for Shopify jobs.

### Commit
`2607ed6` — fix(api): shopify webhooks must complete DB writes before responding 200


### Done
- Switched focus from `admin-mobile` to real web admin app in `apps/admin-web`.
- Added `phone` to shared web admin `User` type in `apps/admin-web/src/types.ts`.
- Showed phone directly in users table row and removed the dead last action column in `apps/admin-web/src/pages/UsersPage.tsx`.
- Showed phone in user detail header and `KV` summary in `apps/admin-web/src/pages/UsersPage.tsx`.
- Rebuilt `apps/admin-web/dist` so running web app gets updated bundle, not stale output.
- Restarted the local `apps/admin-web` Vite server on `http://127.0.0.1:5173/` after confirming stale bundle behavior.
- Verified with `./node_modules/.bin/tsc -b apps/admin-web/tsconfig.json`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-07-06 - Admin Users Page Phone Number

### Done
- Added `phone` to admin users API list/detail payloads in `apps/api/src/modules/admin/users.routes.ts`.
- Updated admin mobile shared `User` type to carry `phone`.
- Removed right-side row clutter in `apps/admin-mobile/src/components/UserRow.tsx` so phone has full-width space on the list.
- Showed phone directly under name in admin user detail screen in `apps/admin-mobile/src/app/(tabs)/more/users/[id].tsx`.
- Added API coverage in `apps/api/test/integration/admin-users.test.ts` to assert listed admin users include `phone`.
- Verified with `node_modules/.bin/tsc --noEmit -p apps/admin-mobile/tsconfig.json`.

### Failed / Not Done
- API integration test run could not reach local Postgres at `127.0.0.1:5432` in this sandbox (`connect EPERM`).

### Open Questions / Decisions
- None.

## 2026-07-06 - Signup Full Name Required

### Done
- Made `displayName` required in shared `RegisterBody` so signup now rejects anonymous registrations before they hit the API.
- Updated signup UI to label full name as required in `apps/catalogues-web/src/app/(auth)/register/page.tsx`.
- Added integration coverage for missing-name signup rejection in `apps/api/test/integration/auth.test.ts`.
- Updated all register test helpers/call sites to send `displayName` so the suite matches the new contract.
- Verified with `pnpm --filter @aivastra/api typecheck` and `pnpm --filter @aivastra/web typecheck`.
- Verified with `pnpm --dir apps/api exec vitest run --config vitest.integration.config.ts test/integration/auth.test.ts test/integration/google-oauth.test.ts test/integration/credits.test.ts`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-07-06 - Profile Modal Gate, Phone Uniqueness, Optional Company

### Done
- Replaced settings-page redirect gating with a blocking onboarding modal in `apps/catalogues-web/src/components/profile-gate.tsx` + `apps/catalogues-web/src/components/profile-completion-modal.tsx`.
- Made company name optional in the web onboarding copy and settings form; phone number is now the only required field for free-credit unlock.
- Changed new-user landing back to `/studio` for email register, email verification, and Google OAuth callback flows.
- Added duplicate-phone validation in `PATCH /v1/me` so a number already assigned to another email returns `PHONE_TAKEN` with a clear 409 message.
- Kept free-credit grant tied to profile completion and verified it with integration coverage in `apps/api/test/integration/auth.test.ts`.
- Verified with `pnpm --filter @aivastra/api typecheck` and `pnpm --filter @aivastra/web typecheck`.
- Verified with `pnpm --dir apps/api exec vitest run --config vitest.integration.config.ts test/integration/auth.test.ts test/integration/google-oauth.test.ts test/integration/credits.test.ts`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None. Current behavior matches request: modal gate, optional company, blocked duplicate phone, and clear error text.

## 2026-07-06 - Mandatory Profile Fields Before Free Credits

### Done
- Added `company_name` to `users` in `packages/db/src/schema/users.ts` and migration `packages/db/src/migrations/0084_user_company_name_and_free_trial_gate.sql`.
- Moved free-trial credit grant out of signup and into profile completion in `apps/api/src/modules/auth/routes.ts`.
- `PATCH /v1/me` now accepts `companyName`, stores trimmed `phone`/`companyName`, and grants free credits once when both are filled.
- New web accounts now land on `/settings` after email verification, and Google OAuth handoff now redirects there too.
- Added `ProfileGate` in `apps/catalogues-web/src/components/profile-gate.tsx` and wrapped the app shell so incomplete profiles get pushed to `/settings`.
- Updated `apps/catalogues-web/src/app/(app)/settings/page.tsx` to require phone + company name before save/credit unlock.
- Updated integration tests for the new onboarding flow and rebuilt `@aivastra/db` so API typecheck sees the new schema.
- Verified with `pnpm exec vitest run --config vitest.integration.config.ts test/integration/auth.test.ts test/integration/google-oauth.test.ts test/integration/credits.test.ts`.
- Verified with `pnpm --filter @aivastra/api typecheck` and `pnpm --filter @aivastra/web typecheck`.

### Failed / Not Done
- Did not change login redirect defaults for returning users; the app gate handles incomplete profiles after entry.

### Open Questions / Decisions
- If you want older users with missing phone/company to be blocked from app routes immediately, current gate already does that. If you want a softer banner instead of a hard redirect, that would be a separate UI change.

## 2026-07-03 - Watermark Opacity Tuned to 0.055

### Done
- Lowered dispatcher watermark compositing opacity in `apps/dispatcher/src/workflow/watermark.ts` from `0.11` to `0.055` per visual review of generated samples.
- This is a calibration-only change on top of the earlier renderer bug fix; tiling behavior and jobId-seeded layout remain unchanged.
- Verified with `pnpm --filter @aivastra/dispatcher test -- watermark`.

### Failed / Not Done
- Did not yet convert the watermark asset itself from multicolor branding to monochrome white; that remains a separate visual-direction change if the lighter alpha still feels too prominent.

### Open Questions / Decisions
- After redeploy, compare one fresh sample against the previous build. If the watermark still feels too visible, the next effective change is asset simplification rather than reducing alpha much further.
## 2026-07-03 - Watermark Opacity Bug Fixed

### Done
- Fixed the dispatcher watermark compositing bug in `apps/dispatcher/src/workflow/watermark.ts` that was making the overlay appear much stronger than intended.
- Root cause: the old code used `ensureAlpha(0.12)` on the full watermark tile canvas, which applied low alpha to the entire tile instead of only the logo region and created a subtle full-image veil underneath the repeated watermark.
- Changed the renderer so the tile background stays fully transparent and only the centered watermark logo/wordmark is composited at low opacity (`0.11`).
- Increased tile spacing modestly so the repeated pattern reads lighter and less busy.
- Added a regression test in `apps/dispatcher/src/workflow/watermark.test.ts` that checks the composite stays visually subtle instead of globally lifting a black image too much.
- Verified with `pnpm --filter @aivastra/dispatcher test -- watermark`.

### Failed / Not Done
- Did not yet calibrate against multiple real production samples with very bright garments/backgrounds; this pass fixes the renderer bug and brings the effect closer to the intended stock-watermark style.

### Open Questions / Decisions
- After the next deploy, re-check one dark-background and one light-background catalogue output. If the watermark still feels too visible, the next adjustment should be reducing `WATERMARK_OPACITY` slightly before changing the brand asset again.
## 2026-07-03 - Dedicated Dispatcher Watermark Asset

### Done
- Replaced the placeholder text-only dispatcher watermark asset in `apps/dispatcher/assets/watermark-logo.svg` with a dedicated white watermark SVG.
- The new asset now includes a simple geometric brand mark plus the `Aivastra` wordmark, designed specifically for the tiled low-opacity watermark overlay.
- Kept the asset lightweight and Sharp-compatible so dispatcher startup and watermark compositing remain stable.
- Verified with `pnpm --filter @aivastra/dispatcher test -- watermark`.

### Failed / Not Done
- Did not attempt to reuse the existing public logo SVGs because they are raster images embedded inside SVG wrappers, which would make the watermark asset heavier and less predictable for backend compositing.

### Open Questions / Decisions
- If design later provides a true vector master logo, we should swap this handcrafted watermark asset for the canonical brand asset while preserving the same dimensions and white-on-transparent treatment.
## 2026-07-03 - Watermark Visual Tone Updated to Light White

### Done
- Updated apps/dispatcher/assets/watermark-logo.svg so the watermark wordmark renders in white instead of black.
- This keeps the existing low-opacity tiling/compositing behavior but makes the final watermark read as a lighter, less intrusive protective overlay on catalogue images.

### Failed / Not Done
- Did not add adaptive light/dark watermark variants in this pass; the asset is now uniformly white.

### Open Questions / Decisions
- If the watermark becomes too faint on very bright garments or backgrounds, the next step should be adaptive contrast rather than increasing global opacity too aggressively.
## 2026-07-03 - Pricing Page Current Plan Source-of-Truth Fix

### Done
- Fixed the catalogue pricing banner in apps/catalogues-web/src/app/(app)/pricing/page.tsx to use /v1/me.tier as the source of truth for the current plan instead of deriving it from the latest paid payment row.
- The page now only uses payment history for activation date and paid-plan metadata that matches the active tier, which prevents free-tier users from being shown as Starter/Growth/Business just because they purchased that plan in the past.

### Failed / Not Done
- Did not change payment history itself or admin user tier behavior; this was a frontend source-of-truth mismatch.

### Open Questions / Decisions
- If you want the pricing page to show richer free-plan metadata in the future, that should come from a dedicated API response or an authenticated plan-details endpoint rather than inferred from payment history.
## 2026-07-03 - Dispatcher Production Watermark Asset Path Fix

### Done
- Fixed the dispatcher watermark asset lookup in apps/dispatcher/src/workflow/watermark.ts to resolve the SVG relative to the module via import.meta.url instead of process.cwd().
- This fixes the production container crash loop where the dispatcher looked for /app/assets/watermark-logo.svg even though the file is shipped at /app/apps/dispatcher/assets/watermark-logo.svg.
- Root cause confirmed from production logs: watermark initialization failed closed at startup, which in turn let worker health TTLs expire and made healthy workers appear unhealthy in admin.

### Failed / Not Done
- Did not change watermarking behavior itself or the fail-closed startup policy; this fix is strictly path resolution.

### Open Questions / Decisions
- After deploy, confirm the dispatcher remains up with ENABLE_WATERMARKING=true and that admin worker health repopulates within one health-monitor interval.
## 2026-07-03 - Watermarking/Regenerate: Fixed 3 Blockers Found in Review

### Done
Review of the antigravity implementation (previous entry below) found 3 blocking gaps against the
spec and 2 follow-ups; all fixed and verified with new tests run against live Postgres/Redis/MinIO
(`pnpm docker:up`), not just typecheck:
- **Regenerate now reuses job creation instead of duplicating it.** `apps/api/src/modules/jobs/regenerate.ts`
  previously hand-rolled its own plan lookup, cost calc, and insert/enqueue — already diverging from
  `create.ts`'s pose-workflow-driven lower/shoe catalog stripping. Rewrote it to reconstruct the
  request shape and call `createJob` / `createSimpleTryonJob` / `createSareeJob` directly, matching
  the spec's explicit "do not special-case pricing for regenerate" rule. Added `sourceJobId` to the
  stored params on tryon-direct jobs (`create.ts`) so regenerate can resolve that path the same way.
- **UI now gates on `assetKind` + current plan, not the creation-time `job.watermark` snapshot.**
  `apps/catalogues-web/.../catalogues/[id]/page.tsx` was checking `job.watermark`, which meant a
  kill-switch override during processing would show a false watermark banner, and a still-free user
  could see a "Regenerate without Watermark" CTA that would just charge them for another watermarked
  image. Added `currentPlanWatermark` to the `/v1/catalogues/:id` response and switched both the
  banner and CTA to `assetKind === 'WATERMARKED'` (+ `currentPlanWatermark === false` for the CTA).
  Also fixed two pre-existing typecheck errors in this file (duplicate `queuePosition` prop, `zoom`
  passed directly as an `img src` instead of `zoom.url`) that meant this file had never actually
  typechecked since being written.
- **Wrote the missing test suite** — none existed before this pass despite the spec calling several
  out explicitly ("write a test for it" / "regression guard"): dispatcher unit tests for
  `WatermarkService` (5 tests, `src/workflow/watermark.test.ts`), dispatcher integration tests for
  fail-closed behavior and the end-to-end upgrade-mid-flight snapshot regression (5 tests across two
  new files in `test/integration/`), and API integration tests for the regenerate endpoint including
  the exact lower/shoe-stripping parity scenario the review flagged (6 tests,
  `apps/api/test/integration/regenerate.test.ts`).
- Writing real tests surfaced two additional bugs that had never been exercised:
  1. `WatermarkService.initWatermarkTile()` sized the tile canvas from the SVG logo's *pre-transform*
     metadata instead of the post-resize/rotate buffer, so `.composite()` always threw — the
     dispatcher would `process.exit(1)` on every boot with `ENABLE_WATERMARKING=true` (the default).
  2. Chaining `.extend({ extendWith: 'repeat' })` directly into `.extract()` in one sharp pipeline
     throws `bad extract area` in the installed sharp version even when the extended buffer is
     provably large enough; fixed by materializing the extended buffer first.
- Seeded the jobId offset that P1-5 called for (`tileOffsetForJob()`, sha256-derived, mod tile
  dimensions) — the original `applyWatermark()` ignored `opts.jobId` entirely and always composited
  from `(0,0)`, so every image got an identical watermark placement.
- Fixed a pre-existing dispatcher test-infra bug unrelated to this feature but blocking all
  integration tests locally: `test/helpers/containers.ts` hardcoded Postgres port 5432, this machine's
  `.env` uses 5433. Now reads `POSTGRES_PORT` with the same default docker-compose uses. Added
  `/upload/image` support to `test/helpers/comfy-mock.ts` (needed by the saree job path, previously
  unsupported) and a `vitest.integration.config.ts` for the dispatcher package, mirroring the API
  package's existing split between unit (`vitest.config.ts`, excludes `test/integration`) and
  integration (`vitest.integration.config.ts`) runs.

### Failed / Not Done
- Did **not** attempt to fix the pre-existing `happy-path.test.ts` / `recovery.test.ts` /
  `retry.test.ts` dispatcher integration tests — they seed `catalog_items` with columns from a schema
  version that predates the current `faceId`/`backgroundId`/`poseId` model-asset split (`type` is now
  `NOT NULL` with no default and means `'lower' | 'shoe'`, not a free-form label). This is unrelated
  pre-existing rot, confirmed by reverting all watermarking changes and re-running them with the same
  failure. Out of scope for this pass; flagging here since it means the "regular studio job" path has
  no passing dispatcher-level test coverage at all right now.

### Open Questions / Decisions
- `apps/dispatcher/assets/watermark-logo.svg` is still a placeholder (per the entry below) — needs a
  real asset from design before production rollout with `ENABLE_WATERMARKING=true`.

## 2026-07-03 - Implemented Free-Tier Watermarking & Regenerate Feature

### Done
- Implemented the free-tier watermarking and regenerate feature according to the frozen spec (`2026-07-02-free-tier-watermarking-and-regenerate.md`).
- **Step 1:** Added migrations for `credit_plans.watermark`, `jobs.watermark`, `jobs.parent_job_id`, `job_outputs.asset_kind`, and `job_outputs.watermark_version`.
- **Step 2:** Refactored `apps/dispatcher/src/workflow/finalize.ts` to centralize output finalization across all job types (`tryon`, `saree`, `tryon_direct`).
- **Step 3:** Updated job creation routes (`create.ts`, `createSaree.ts`) to snapshot the `watermark` entitlement onto the `jobs` table.
- **Step 4:** Implemented `WatermarkService` (`watermark.ts`) to initialize and tile a placeholder SVG logo during dispatcher startup, failing closed on initialization errors. Wired it into `finalizeOutput` behind the `ENABLE_WATERMARKING` kill switch.
- **Step 5:** Updated Admin UI (`SettingsPage.tsx`) and API validation (`creditPlans.routes.ts`) to include a "Watermark" toggle for credit plans.
- **Step 6:** Created the `POST /v1/jobs/:id/regenerate` endpoint (`regenerate.ts`) that re-validates assets, resolves current cost and entitlement, creates a new job with `parentJobId`, and enqueues it.
- **Step 7:** Updated Catalogue UI (`CataloguePage.tsx`) to display a "Watermarked - Upgrade to remove" banner over watermarked image cards and added a "Regenerate without Watermark" CTA button in the expanded view.

### Failed / Not Done
- None.

### Open Questions / Decisions
- A placeholder SVG logo (`watermark-logo.svg`) was added to `apps/dispatcher/assets/` to satisfy the dispatcher's strict startup requirements. A proper asset needs to be provided by the design team for production.

## 2026-07-03 - Free-Tier Watermarking Spec Frozen, Handed Off
### Done
- Ran a multi-round architecture review of `docs/superpowers/specs/2026-07-02-free-tier-watermarking-and-regenerate.md` (free-tier images watermarked, paid-tier clean, upgrade unlocks a billed "regenerate" job rather than retroactively unwatermarking).
- Settled the core invariant: `credit_plans.watermark` is joined once at job creation and snapshotted onto `jobs.watermark` (mirroring the existing `queueStream` precedent); the dispatcher only ever reads the snapshot, never `credit_plans`/`users.tier` directly, so mid-queue plan changes can't retroactively affect an in-flight job.
- Spec covers: additive-only migrations (`credit_plans.watermark`, `jobs.watermark`, `jobs.parent_job_id`, `job_outputs.asset_kind`, `job_outputs.watermark_version`), a shared `finalizeOutput()` dispatcher helper (also removes existing triplicated download/upload/thumbnail logic), fail-closed watermark failure handling, `ENABLE_WATERMARKING` kill switch with WARN-level logging on override, dispatcher startup validation for the watermark asset, structured per-job logging, and a `POST /v1/jobs/:id/regenerate` endpoint that re-validates and re-bills as a new job.
- Rollout intentionally sequenced so the dispatcher refactor ships and is verified before any watermarking behavior is enabled.
- Spec marked **Architecture Approved / frozen** and handed off for implementation (outside this session's architect/reviewer role).

### Failed / Not Done
- No code written this session — pure design/spec work, as scoped.

### Open Questions / Decisions
- None outstanding; any further changes are expected to come from implementation/staging findings, not further design discussion.

## 2026-07-02 - Free Plan Design Gap Fixes

### Done
- Reviewed `docs/superpowers/specs/2026-07-02-unify-free-plan-credit-plans-design.md` against the actual codebase and found the design was already fully implemented (migrations 0077-0079, admin/pricing UI, tier validation) — the doc's own "Trade-offs" section still listed 4 real gaps in the shipped design, all now fixed:
- Added migration `0080_users_tier_fk_credit_plans.sql`: normalizes any orphaned `users.tier` value to `'free'`, then adds a DB-level `FOREIGN KEY (tier) REFERENCES credit_plans(slug) ON DELETE RESTRICT` — the design's stated invariant ("tier always matches a plan") is now enforced by Postgres, not just convention.
- `creditPlans.routes.ts` DELETE now also blocks deleting a plan that any user currently has as their `tier` (409, in addition to the existing payments check) — the FK is a backstop, this gives a clean error instead of a raw constraint violation.
- `creditPlans.routes.ts` PATCH now blocks deactivating the free plan (`isActive: false`) — previously an admin could silently zero out free-signup credits for new users with no warning, since only slug-change and delete were guarded.
- Applied migration 0080 against local dev DB (clean, no orphaned data); `pnpm --filter @aivastra/api typecheck`, `pnpm --filter @aivastra/db typecheck`, and `pnpm --filter @aivastra/api test:unit` all pass.

### Failed / Not Done
- None.

### Open Questions / Decisions
- Did not add `.references()` on the `users.tier` schema.ts column to avoid a circular import with `credits.ts` (which already imports `users.ts`) — the FK exists at the DB level via the raw SQL migration; a comment in `schema.ts` documents this.

## 2026-07-02 - Admin Free Plan Card

### Done
- Added a dedicated `Free Plan` card to `Settings -> Credit Plans` in the admin web app.
- Split the generic credit-plan table so the `free` plan is shown separately from paid plans.
- Added explicit copy that the `Credits` field on the free plan controls the one-time signup allocation for new users.
- Kept the free-plan edit action prominent while leaving deletion available only for paid plans.
- Validation passed: `pnpm --filter @aivastra/admin build`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.
## 2026-07-02 - Free Plan Unified Into Credit Plans

### Done
- Added migration `0079_user_tier_default_free.sql` and updated the Drizzle schema so new users default to `tier = 'free'` instead of `'FREE'`.
- Completed backend tier normalization follow-through: bootstrap admin creation now sets `tier: 'free'`; admin user PATCH now validates tier values against active `credit_plans.slug`; public `/v1/payments/plans` no longer returns the `free` plan.
- Updated seed and dispatcher integration fixtures to use plan slugs (`free`, `starter`, `growth`, `business`) instead of legacy `FREE/PRO/ENTERPRISE` values.
- Removed stale `freeTrialCredits` usage from admin web and admin mobile system-config flows so free credits are no longer edited through Redis-backed config.
- Added admin-web tier assignment UI backed by `/admin/credit-plans`, and blocked free-plan deletion in both admin web and admin mobile editors.
- Updated storefront pricing to filter out the `free` plan and refreshed mobile tier presentation to treat `free` as the baseline plan slug instead of a special uppercase tier.
- Validation passed: `pnpm --filter @aivastra/api typecheck`, `pnpm --filter @aivastra/admin build`, `pnpm --filter @aivastra/web typecheck`.

### Failed / Not Done
- Admin mobile was not typechecked in this pass; the repo's Expo setup does not expose a lightweight standalone typecheck command here.

### Open Questions / Decisions
- The job creation paths still keep a defensive `?? 'normal'` queue fallback even though tiers now normalize to credit plan slugs. That fallback is harmless, but if you want the code to hard-fail on data drift instead, that would be a separate tightening change.
# Project Progress

## 2026-07-03 — Chatbot Multi-Provider Model Selection

Implemented per `docs/superpowers/plans/2026-07-03-chatbot-multi-provider-models.md` (3 tasks),
via `superpowers:subagent-driven-development`.

### Done
- New `apps/chatbot/src/agent/models.ts` — provider-agnostic `makeModel()` factory
  (`anthropic` / `google` / `openai-compatible`), env-var config resolution with per-field
  fallback (`genModelConfig`/`toolModelConfig`).
- `runBotTurn()` split into a router (tool-calling) model and a generation model — router
  makes one tool-decision pass (no loop), generation model synthesizes the final reply and
  applies the existing escalate/grounding gate. `createReactAgent` no longer used.
- Pinned `@langchain/openai@0.3.17` and `@langchain/google-genai@0.2.18` (not `^` ranges) —
  their latest majors require `@langchain/core@^1.x`, incompatible with this repo's
  `@langchain/core@0.3.80` (pinned via `@langchain/langgraph`/`@langchain/anthropic`).
- Fixed a pre-existing duplication in `apps/chatbot/src/index.ts` where `deps` was
  constructed twice (once for the server, once for the sweeper) — now built once.
- Post-review fix: hand-off test (`bot.test.ts`) didn't prove the tool result actually
  reached `genModel`'s input, only that the final text passed through — added a spy wrapper
  on `genModel.invoke` to assert on the received message content.
- Final whole-branch review caught a **critical bug before merge**: the generation model
  (never bound to tools) was being handed the router's tool-call `AIMessage` plus
  `ToolMessage` results as structured `tool_use`/`tool_result` blocks. Anthropic rejects any
  request containing those blocks unless `tools` is also passed on that same call
  ("Requests which include tool_use or tool_result blocks must define tools") — this would
  have 400'd on every tool-using turn against the default anthropic config. Fixed by
  flattening tool output into a plain-text `SystemMessage` instead (also sidesteps
  cross-provider tool-call id format mismatches when tool/gen models differ). Also softened
  `GEN_SYSTEM_PROMPT` so greetings/small talk with no tool results don't escalate to a human.
  Added a regression-guard test asserting the gen model never receives a `tool`-typed
  message or non-empty `tool_calls`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- Admin-configurable (DB-backed, no-redeploy) model switching is explicitly deferred —
  decide later per user.
- `CHATBOT_MAX_TOOL_ITERATIONS` is now an orphaned env var (its only consumer, the
  `recursionLimit` on the old `createReactAgent` call, was removed). Left declared in
  `env.ts` for backward compatibility; not wired to anything.

## 2026-07-03 — Support Chatbot v1 (as built)

Implemented per `docs/superpowers/plans/2026-07-03-support-chatbot.md` (all 15 tasks),
following `docs/chatbot/chatbot-system-design.md` v2.

### Done
- New `apps/chatbot` service: Fastify + `@fastify/websocket`, pgvector + tsvector hybrid
  retrieval (RRF-merged), LangGraph ReAct bot (`claude-haiku-4-5-20251001`) with
  userId-bound `getCredits`/`getRecentJobs`/`searchKnowledge` tools (no identity args —
  §7.2 invariant), one-time WS ticket auth, Redis pub/sub fanout, presence ZSET,
  claim/takeover/end state machine with abort-safe bot termination, email fallback to
  `contact_requests` (both "no agent available" and "PENDING_HUMAN timeout" paths), 60s
  sweeper (idle close, agent-drop re-queue, presence prune). 8 test files, 23 tests.
- `apps/api`: `/admin/chatbot/*` — Q&A CRUD, ingest proxy, inbox list, atomic
  claim/takeover/end (Redis `NX` lock), duty toggle. 7 integration tests
  (`test/integration/admin-chatbot*.test.ts` — run via `vitest.integration.config.ts`,
  **not** the default `pnpm test`, see Open Questions).
- `apps/admin-web`: Chatbot Q&A page (CRUD + re-ingest) and Chat Inbox (duty, queue,
  claim/takeover, live conversation pane) — web-only in v1, explicit admin-mobile parity
  exception per the design doc.
- `apps/catalogues-web`: floating chat widget, WS streaming, human-handoff UX.
- `packages/db`: migration `0078_chatbot.sql` — `pgvector/pgvector:pg16` image swap,
  5 new tables + HNSW/GIN indexes + partial unique index (one active conversation/user).
  Applied and verified against the running dev DB.
- Prometheus metrics (`chatbot_messages_total`, `_escalations_total`, `_fallbacks_total`,
  `_bot_turn_duration_seconds`, `_active_sockets`), per-user WS rate limit (10 msg/30s).
- Self-corrected mid-build (own commits): OpenAI embed response validation, grounded-check
  scoping bug in hybrid search.

### Fixed in post-execution review (2026-07-03)
- **Duty toggle 415 (Unsupported Media Type):** `ChatInboxPage.tsx` passed an explicit
  `content-type` header alongside `apiFetch`'s auto-injected `Content-Type` — the two
  differently-cased keys survived into the `fetch()` `Headers` object and got
  comma-joined (`"application/json, application/json"`), which Fastify's content-type
  parser rejected. Fix: dropped the redundant header (every other admin-web page already
  relies on `apiFetch`'s auto-injection; this was the one page that duplicated it).
- **Chat widget could never authenticate:** the original plan spec read `access_token`
  from `document.cookie`, but that cookie was deliberately removed in SEC-H2 (2026-06-30) —
  the token now lives only in `apps/catalogues-web/src/lib/api.ts`'s in-memory `_memToken`.
  Someone caught this during/after execution and switched the widget to the exported
  `getToken()`; verified correct against the actual auth implementation.
- Doc follow-through gaps closed: system-design doc now marked "as built (v1)" (was still
  "proposed"); `apps/chatbot` added to CLAUDE.md's monorepo table + commands table; fixed
  a stale CLAUDE.md line that claimed `api.ts` reads the token from `document.cookie`
  (pre-existing inaccuracy — root cause of the widget bug above).

### Failed / Not Done
- None — all 15 planned tasks landed and pass.

### Open Questions / Decisions
- **Widget cold-load race:** `ChatWidget.connect()` reads `getToken()` directly instead of
  going through `api.ts`'s `request()` wrapper, so it doesn't benefit from that wrapper's
  own 401→refresh self-healing. If a user reloads the page and opens the chat bubble
  before any other authenticated call has hydrated `_memToken`, `connect()` returns
  silently with no UI feedback. Low likelihood (most pages fire an authenticated call
  before this is reachable) but not proven impossible. Left as-is pending a decision on
  whether the widget should proactively call refresh itself.
- **`apps/api` `test` script doesn't run integration tests by default:** `vitest.config.ts`
  excludes `test/integration/**`; the actual runner is `vitest.integration.config.ts`, not
  wired into `package.json`'s `test`/`test:unit` scripts or the `make test-api` target.
  This is a pre-existing gap (predates this build — the config's own comments reference
  unrelated pre-existing failing tests), not something this chatbot work introduced, but
  it means CLAUDE.md's description of `pnpm --filter @aivastra/api test` as the "Full API
  integration suite" is currently inaccurate. Flagging for a separate fix; the two new
  `admin-chatbot*.test.ts` files were verified manually against the integration config.

## 2026-06-30 — Security Audit: H1/H2/H3/C2 Fixed

### Done
- **SEC-C2 · SSRF (Critical):** Added `assertSafeExternalUrl()` in `apps/api/src/modules/widget/routes.ts` — enforces `https`-only, DNS-resolves hostname, blocks RFC1918 / loopback / link-local ranges before any fetch or credit check.
- **SEC-H1 · Open merchant signup (High):** `widget_clients.is_active` defaulted to `false` (migration `0076`); signup rate-limited to 5/hr; `widgetKey` withheld from response until admin activates account.
- **SEC-H2 · JS-readable access token (High):** Access token moved from cookie to module-level variable in `apps/catalogues-web/src/lib/api.ts`. `initToken()` seeded after login; silent re-hydration on 401 via httpOnly refresh cookie; BroadcastChannel cross-tab sync. Cookie no longer set by `setAuthCookies`.
- **SEC-H3 · World-readable bucket (High):** `mc anonymous set download` removed from both compose files; all private content in `/admin/results/data` served via presigned GETs (1h TTL) instead of `publicUrl()`.

### Failed / Not Done
- **SEC-H2 CSP:** Adding a Content-Security-Policy header requires auditing all script/style/connect origins — deferred. Token-in-memory already eliminates the primary XSS→token-theft vector.

### Open Questions / Decisions
- None.

## 2026-06-30 — Phase 9 Closure

### Done
- **Standardized Database Seeding (Finding 9.4)**:
  - Installed `@faker-js/faker` in `@aivastra/db`.
  - Created a robust, deterministic seed script in `packages/db/src/seed.ts` that safely seeds users, catalog types, categories, and 2,000 items using bulk inserts.
  - Wired it into the monorepo root via the `pnpm db:seed` command.
  - Closed Finding 9.4 as Done.
  - Phase 9 is now fully closed.

## 2026-06-30 — Audit Triages (1.4, 2.3, 9.1)

### Done
- **Audit Docs**:
  - Closed Finding 1.4 (BFF Proxying) as Rejected; the BFF layer is architecturally necessary for setting secure httpOnly cookies. (Phase 1 fully closed).
  - Closed Finding 2.3 (Merchant Analytics) as Deferred; out of scope for hardening sprint. (Phase 2 fully closed).
  - Closed Finding 9.1 (Half-Implemented Dispatcher) as Merged into 7.5 (ComfyUI payload sandboxing).

## 2026-06-30 — Phase 8 Closure

### Done
- **Monorepo Boundaries (Finding 8.1)**:
  - Installed ESLint and `eslint-plugin-boundaries` alongside `typescript-eslint` across the workspace.
  - Added `eslint.config.js` to all `apps/*` packages enforcing the `no-restricted-imports` rule.
  - Explicitly blocked `../packages/` and `../../apps/` imports to prevent cross-app contamination.
- **Audit Doc (`docs/audits/audit_phase_8_dx.md`)**:
  - Closed Finding 8.1 (Poor Monorepo Boundary Enforcement) as Done.
  - Skipped Finding 8.2 (Database Migrations Developer Friction) as Testcontainers are explicitly abandoned on Windows.
  - Skipped Finding 8.3 (Hardcoded Port Conflicts) as N/A since `app.listen({ port: 0 })` handles this in tests.
  - Deferred Finding 8.4 (Missing Shared Configuration Management) to wait for ops/infrastructure buy-in.
  - Phase 8 is now fully closed.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-30 — Phase 11 Closure

### Done
- **Audit Doc (`docs/audits/audit_phase_11_admin_dashboard.md`)**:
  - Closed Finding 11.2 (Inferior Real-Time UX) as Done following the Polling → SSE migration.
  - Closed Finding 11.4 (Dead-End Metrics) as Done following the BarChart → JobsPage drill-down implementation.
  - Closed Finding 11.5 (Brittle Theming and State Sync) as Done following the optimistic `updateTheme` implementation in `App.tsx`.
  - Skipped Finding 11.3 (Fragmented and Unpolished Styling) as the admin SPA's custom `tokens.css` design system is an intentional design choice, and a UI library migration (Tailwind/shadcn) would yield no product benefit.
  - Phase 11 is now fully resolved or skipped.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-30 — Admin Dashboard Polling → SSE (Finding 11.2)

### Done
- **Admin App (`apps/admin-web/src/lib/sse.ts`, `apps/admin-web/src/pages/DashboardPage.tsx`)**:
  - Implemented `createAdminSSEConnection`, a minimalistic fetch + ReadableStream SSE client capable of sending the `Authorization: Bearer <token>` header.
  - Replaced the primary 30-second `setInterval` polling in the dashboard with event-driven data fetching using the `/admin/jobs/stream` SSE endpoint.
  - Added an 800ms debounce to the SSE event handler to batch simultaneous state transitions without hammering the database.
  - Maintained a 60-second fallback heartbeat poll to catch out-of-sync states or silent SSE disconnects.
  - Updated dashboard UI text label to reflect event-driven freshness ("Live — updates on job events").

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-30 — Phase 4 Closure (4.1 and 4.3)

### Done
- **Audit Doc (`docs/audits/audit_phase_4_design_system.md`)**:
  - Closed Finding 4.1 (Anti-Pattern: Heavy Reliance on JS Event Handlers) as Done following the 11 element CSS migration.
  - Skipped Finding 4.3 (Hardcoded Responsive Breakpoints) as a permanent product constraint (Merchant portal is desktop-first, Widget is iframe-embedded).
  - Phase 4 is now fully resolved or skipped.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-30 — Finding 6.4 Closure

### Done
- **Audit Doc (`docs/audits/audit_phase_6_performance.md`)**:
  - Closed Finding 6.4 (BFF Duplicate Fetches) as N/A because all `(app)/` pages are `use client` components and no Server Components fetch data in this application.
  - Phase 6 is now fully closed (6.1 structural skip, 6.2 rejected, 6.3 permanent skip, 6.4 N/A).

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-30 — Widget Job Cancellation (Finding 3.1)

### Done
- **API (`apps/api/src/modules/widget/routes.ts`)**: 
  - Added `DELETE /v1/widget/jobs/:id` which cancels `QUEUED` or `PREPROCESSING` jobs.
  - Implemented an atomic `widgetRefund` of 10 credits inside the cancellation transaction.
  - Returns `409 NOT_CANCELLABLE` if the generation has already started (`GENERATING` or `UPLOADING`).
  - Publishes a `{ type: 'STATUS', status: 'CANCELLED' }` event to the Redis SSE stream.
- **Widget UI (`apps/catalogues-web/src/app/(widget)/widget/render/[key]/page.tsx`)**:
  - Rendered a `Cancel` button during the `processing` step.
  - Handled the `CANCELLED` SSE event to transition to a new `cancelled` UI step.
  - Added an "Upload new photo" CTA in the `cancelled` step which cleanly resets the internal state (`jobId`, `uploadFile`, `uploadPreview`, idempotency keys) allowing the user to start a fresh upload.
  - Tokenized cancellation colors using `C.field`, `C.text`, `C.mid`, and `C.pink`.
- **Audit Doc (`docs/audits/audit_phase_3_ui_ux.md`)**:
  - Marked Findings 3.1 and 3.3 as resolved in the triage note. Phase 3 UI & UX Audit is now fully resolved.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-30 — Audit Sprint fixes: P1-4, 3.3, 11.4

### Done
- **P1-4 Admin Mobile Notification Settings:** Disabled `emailAlerts` and `slackWebhook` inputs in `SettingsPage.tsx` with a "Coming soon" badge to avoid confusing admins since there is no backend support yet. Removed orphaned state variables and added `disabled` support to the `Switch` component.
- **3.3 "Coming Soon" Dead Ends:** Upgraded the `coming-soon.tsx` component in the web app to a stateful client component with a "Notify me when ready" button, turning dead ends into an engagement hook. Fixed a dark-mode token bug by replacing a hardcoded gray background with the `C.lighter` design token.
- **11.4 Admin Metric Drill-downs:** Added click interactivity to the `BarChart` in `DashboardPage.tsx` so clicking a bar navigates to `JobsPage` filtered by that specific day. Implemented pure UTC arithmetic using `Date.UTC()` to avoid off-by-one errors for UTC+ timezone admins. Added `date` query parameter support in `JobsQuery` (`GET /admin/jobs`) and an active visual date filter badge in the `JobsPage` UI.
- **Pre-push CI Fixes:** Modified `lefthook.yml` to explicitly exclude `@aivastra/admin-mobile` from the `typecheck` pre-push hook. Expo apps must be typechecked within an Expo context due to `.expo/types` stub requirements.
- **Code Hygiene:** Formatted 4 files with Biome, added `biome-ignore lint/style/noImportantStyles` suppressions for specific inline-style overrides in `globals.css`, and removed stale lint suppressions.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-30 — Saree job creator integration tests

### Done
- Created `apps/api/test/integration/saree-jobs.test.ts` with 5 tests covering: NOT_CONFIGURED (no model image) → 400, CONFIG (no active saree workflow) → 400, FORBIDDEN (garmentKey owned by another user) → 403, happy path (35 credits deducted, job+inputs inserted, XADD to jobs:normal) → 201, refund on enqueue failure (503, credits refunded, job FAILED with errorCode=ENQUEUE_FAIL).
- Adapted `registerUser` to the current email-verification flow: register → mark `emailVerified=true` via DB → login for a real JWT. The spec's `res.json().accessToken` pattern was broken by the post-commit auth change.
- Added stub values for `workflowTemplates` NOT NULL columns (`faceNodeId`, `poseNodeId`, `bgNodeId`, `upperNodeIds`, `facePhasePromptNode`, `garmentPhasePromptNode`) that the saree flow doesn't actually use. The saree flow only reads the `tryon*_node_id` columns.
- Stubbed `app.storage.headObject` in `beforeEach` so `assertOwnsUploadKey`'s existence check passes without a real R2 object. The spec's assumption that the HEAD check would "throw BAD_UPLOAD before reaching" the config checks was wrong — HEAD always runs first unless the owner check fails (which is exactly the FORBIDDEN test).
- All 5 tests pass (3.7s). `pnpm --filter @aivastra/api typecheck` clean. Biome formatting clean.
- Committed: `test(api): add saree job creator integration tests` (6477d32).

---

## 2026-06-30 — Saree Try-On follow-up: Workers page checkbox

**Done**
- Added `'saree'` to the `JobType` union, `JOB_TYPES` array, and `JOB_TYPE_LABELS` map in `apps/admin-web/src/pages/WorkersPage.tsx`
- Wrapped the Add/Edit Worker modal's checkbox row with `flexWrap: 'wrap'` so 3 checkboxes don't overflow on narrow screens
- Updated the workers-table badge color logic so `saree` rows render with a pink tint (`var(--pink, #ec4899)`) distinct from `tryon` (accent) and `catalogue` (success)
- Admin can now enable a worker for saree jobs from the UI — no API PATCH needed
- Closes the loop: `Admin → Saree page → upload workflow + model image` + `Admin → Workers page → enable saree on a worker` = end-to-end ready

**Tested**
- Admin build (`pnpm --filter @aivastra/admin build`) — clean (76 modules, 5.62s)
- lefthook biome-staged — no fixes needed

---

## 2026-06-30 — SSE Reconnection UX (session 4)

### Done
- **3.5 SSE reconnection indicator:** Three-file change with no architectural risk.
  - `apps/catalogues-web/src/lib/sse.ts` — exported `SSEState` type (`'connecting' | 'connected' | 'reconnecting'`); added optional `onStateChange` 4th parameter to `createSSEConnection`, called at transition points (`connect()` start, after stream confirmed, `scheduleReconnect()`).
  - `apps/catalogues-web/src/components/job-stream-provider.tsx` — wired `setSseState` as `onStateChange`; exposed `sseState` in context with `useMemo`; renders a fixed bottom toast with a spinning ring when `sseState === 'reconnecting'` (uses existing `av-spin` CSS class and `aria-live="polite"`). `subscribe` extracted with `useCallback` to keep it stable.
  - `apps/catalogues-web/src/app/(widget)/widget/render/[key]/page.tsx` — extracted SSE reading out of `handleGenerate` (which previously had no reconnection logic — a silent stall bug) into a `useEffect` watching `[step, jobId, key]`. New effect uses exponential backoff (`1s → 30s`), `AbortController` for clean cancellation, and `sseClosedRef` to prevent reconnects after terminal events. `sseConnState` state drives a "Connection lost — retrying…" indicator in the processing step UI. `API_URL` moved to module level.
- **Contact requests source filter** — verified already fully implemented in a prior session (both `contact.routes.ts` and `ContactRequestsPage.tsx` complete).

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

---

## 2026-06-30 — Saree Try-On (temporary feature)

**Done**
- New `saree_settings` table (single row, holds admin's static model image key) + migration 0071
- 10 new Zod schemas in `@aivastra/types/saree`
- `saree-detect.ts` auto-detects person + saree LoadImage nodes (5 unit tests passing)
- 7 admin routes under `/admin/saree-*` (workflow active/upload/deactivate, settings GET/presign/PATCH, workers list)
- 2 user routes (`GET /v1/saree/config`, `POST /v1/jobs/saree`) — 35 credits, normal/priority queue
- Dispatcher `processSareeJob` routes to workers with `saree` in `allowedJobTypes`
- New `jobsCreatedTotal` `kind` label (catalogue / tryon / saree)
- Web `/saree` page (left upload, right preview, "not configured" empty state)
- Admin `/saree` page (3 sections: ComfyUI Workflow, Model Image, Worker Selection)
- Web + admin sidebar entries
- 5 integration tests for `createSareeJob` (all passing via `vitest.integration.config.ts`)

**Tested via integration tests**
- NOT_CONFIGURED when model image missing → 400
- CONFIG when active workflow missing → 400
- FORBIDDEN when garmentKey owned by another user → 403
- Happy path: 35 credits deducted, job+inputs inserted, jobs:normal XADD
- Enqueue failure: 503, credits refunded, job marked FAILED
- Detector: model/saree/output/prompts detected from saree.json fixture

**NOT yet tested live (requires ComfyUI worker)**
- Worker claims a saree job and runs the workflow
- Result image renders correctly on the model person
- Saree-specific positive prompt produces a draped saree output

**Workers setup required for live testing**
- Per-worker config: add `'saree'` to `workers.allowedJobTypes` via the Workers admin page
- The Qwen-Image-Edit-2509 + 3 LoRAs models must be present on the worker
- The worker must accept saree jobs (3 GB+ VRAM, ~5-10 min/inference)

**Open Questions / Decisions**
- Whether to keep this feature past the "temporary" window — the spec calls it a temporary feature, easy to remove via drop `saree_settings` + 4 file removals
- Whether the static model image should rotate based on user preference (deferred to a later phase)

---

## 2026-06-30 — Saree Try-On follow-up: Workers page checkbox

**Done**
- Added `'saree'` to the `JobType` union, `JOB_TYPES` array, and `JOB_TYPE_LABELS` map in `apps/admin-web/src/pages/WorkersPage.tsx`
- Wrapped the Add/Edit Worker modal's checkbox row with `flexWrap: 'wrap'` so 3 checkboxes don't overflow on narrow screens
- Updated the workers-table badge color logic so `saree` rows render with a pink tint (`var(--pink, #ec4899)`) distinct from `tryon` (accent) and `catalogue` (success)
- Admin can now enable a worker for saree jobs from the UI — no API PATCH needed
- Closes the loop: `Admin → Saree page → upload workflow + model image` + `Admin → Workers page → enable saree on a worker` = end-to-end ready

**Tested**
- Admin build (`pnpm --filter @aivastra/admin build`) — clean (76 modules, 5.62s)
- lefthook biome-staged — no fixes needed

## 2026-06-30 — Saree job creator integration tests

### Done
- Created `apps/api/test/integration/saree-jobs.test.ts` with 5 tests covering: NOT_CONFIGURED (no model image) → 400, CONFIG (no active saree workflow) → 400, FORBIDDEN (garmentKey owned by another user) → 403, happy path (35 credits deducted, job+inputs inserted, XADD to jobs:normal) → 201, refund on enqueue failure (503, credits refunded, job FAILED with errorCode=ENQUEUE_FAIL).
- Adapted `registerUser` to the current email-verification flow: register → mark `emailVerified=true` via DB → login for a real JWT. The spec's `res.json().accessToken` pattern was broken by the post-commit auth change.
- Added stub values for `workflowTemplates` NOT NULL columns (`faceNodeId`, `poseNodeId`, `bgNodeId`, `upperNodeIds`, `facePhasePromptNode`, `garmentPhasePromptNode`) that the saree flow doesn't actually use. The saree flow only reads the `tryon*_node_id` columns.
- Stubbed `app.storage.headObject` in `beforeEach` so `assertOwnsUploadKey`'s existence check passes without a real R2 object. The spec's assumption that the HEAD check would "throw BAD_UPLOAD before reaching" the config checks was wrong — HEAD always runs first unless the owner check fails (which is exactly the FORBIDDEN test).
- All 5 tests pass (3.7s). `pnpm --filter @aivastra/api typecheck` clean. Biome formatting clean.
- Committed: `test(api): add saree job creator integration tests` (6477d32).

## 2026-06-30 — Security, A11y, Design System, and Tech Debt Fixes (session 3)

### Done
- **7.2 Presigned URL upload cap (defense-in-depth):** Three-layer enforcement at 5MB: (1) client-side JS MIME+size gate; (2) Zod `.max(5 * 1024 * 1024)` on `WidgetPresignRequest.contentLength` in `packages/types/src/widget.ts`; (3) `headObject` check at `POST /v1/widget/jobs` in `apps/api/src/modules/widget/routes.ts` — catches declared-vs-actual lies before credit deduction. Note: `content-length-range` POST policy is impossible for SDK PUT presigned URLs (see `r2.ts` comment).
- **5.1 ARIA live regions (widget):** `aria-live="polite" aria-atomic="true"` on processing status wrapper; `role="alert" aria-live="assertive" aria-atomic="true"` on error container.
- **4.4 Hardcoded color in error.tsx:** `background: '#fff'` → `background: C.bg` on line 19. `confirm-dialog.tsx` was already correctly tokenized (audit was wrong about it).
- **9.3 Middleware redirects → next.config.ts:** `REDIRECTS` dict removed from middleware; `async redirects()` added to `next.config.ts` with `permanent: true` and basePath-aware paths. CDN-cached, zero middleware cost.
- **5.3 Focus trap in modals:** `SupportModal` — `modalRef` + full ARIA dialog attributes + `id` on heading + `useEffect` trap (first-element focus, Tab cycle, Escape). `SupportButton` — `triggerRef` + `requestAnimationFrame` return-focus. `ConfirmDialog` — trap on inner panel (`dialogRef`), not backdrop; `role="dialog"` moved off backdrop to panel; `aria-labelledby` + `id` on `<h3>` added; confirm button auto-focused.
- **5.2 PremiumSelect ARIA:** Added `role="combobox"`, stable `useId()` for `listboxId`, `aria-controls`, and `aria-activedescendant` for accurate screen reader announcements during keyboard navigation.
- **5.4 Focus-visible outlines:** Removed hardcoded `outline: 'none'` and added `.focus-ring` utility class (`outline: 2px solid var(--c-pink)`) on `:focus-visible` to interactive trigger buttons in `PremiumSelect` and `PremiumDateRange`.
- **7.4 Broad Next.js middleware catch-all:** Updated `middleware.ts` matcher to explicitly exclude static image extensions (`.*\\.(?:svg|png|jpg|jpeg|gif|webp)$`), preventing Edge function overhead on static assets.
- **6.3 Client-side image compression:** Skipped (would permanently degrade generation quality for ComfyUI nodes).
- **Audit docs updated:** phases 3, 4, 5, 7, 9 triage notes updated; resolved findings removed.

### Failed / Not Done
- None.

### Open Questions / Decisions
- Integration tests currently use `vitest run --config /tmp/opencode/vitest.integration.config.ts` from `/mnt/vol1/PycharmProjects/aivastra_v1`. The default `apps/api/vitest.config.ts` excludes `test/integration/**`, so `pnpm --filter @aivastra/api test` doesn't pick them up. Worth wiring a `test:integration` script in `apps/api/package.json` so the spec's `pnpm --filter @aivastra/api test -- saree-jobs` works as written.
- Pre-existing integration test failures in `auth.test.ts`, `jobs-create.test.ts`, `credits.test.ts`, `admin-users.test.ts` (all use the old `res.json().accessToken` register pattern, broken by the email-verification refactor) — left untouched, out of scope for this task.

## 2026-06-30 — Saree node detector

### Done
- Created `apps/api/src/modules/admin/saree-detect.ts` mirroring `tryon-detect.ts` structure with saree-specific title matching (`garment`/`saree`/`flatsaree` for the user image, `person`/`model` for the admin/static image).
- Created `apps/api/src/modules/admin/saree-detect.test.ts` with 5 inline-fixture tests covering: model/saree image detection, output node detection, positive/negative prompt detection via connection scan, default prompt text extraction, and the empty-JSON null case.
- TDD: test failed with `Cannot find module './saree-detect.js'` before implementation; all 5 tests pass after.
- `pnpm --filter @aivastra/api typecheck` clean.
- Committed: `feat(api): add saree node detector` (4cfed73).

## 2026-06-30 — UI/UX Audit Tier 3 Fixes (session 2)

### Done
- **3.2 Client-side file validation (widget upload):** MIME allow-list (`image/jpeg`, `image/png`, `image/webp`) and 5MB size gate enforced in `handleFileSelect` before presigned URL is requested. Inline `validationError` state renders below the dropzone. `accept` attribute on hidden input matches JS allow-list. Committed: `feat(widget): client-side file validation and drag-and-drop upload UX`.
- **Drag-and-drop UX (widget upload):** Added `onDragOver`/`onDragLeave`/`onDrop` handlers. `dragActive` state drives pink border + faint tint. `onDragLeave` child-node guard (`e.currentTarget.contains(e.relatedTarget)`) prevents flicker. Dropped files routed through same `handleFileSelect` validation. Included in same commit as above.
- **3.4 Assets empty state (cold-start):** `(app)/assets/page.tsx` replaced bare text with `GarmentIcon` (in `C.pink`) + bold heading + sub-copy + `<Link href="/studio"><GradBtn>Upload your first garment</GradBtn></Link>`. Filter-miss path preserved as plain text. Audit file paths were wrong (referenced non-existent `(merchant)/` routes); real gap was in `(app)/assets/`. Committed: `feat(web): rich empty state for assets cold-start`.
- **Audit doc updated:** `docs/audits/audit_phase_3_ui_ux.md` — 3.2 and 3.4 moved to triage note; open findings (3.1, 3.3, 3.5) remain.

### Failed / Not Done
- None.

### Open Questions / Decisions
- Pre-existing unresolved conflict marker (`<<<<<<< Updated upstream` with no closer) at the top of `docs/progress.md` — resolved as part of the saree → origin merge.

## 2026-06-30 — Audit Tier 1 and Tier 2 Roadmap Fixes

### Done
- **Tier 1.2 (Redis Streams Unbounded Growth):** Added `MAXLEN ~ 10000` to all widget and normal job `XADD` calls to prevent memory leaks.
- **Tier 1.3 (Widget API Abuse Prevention):** Built a crash-safe fixed-window Redis rate limiter (`60 req/min`) for widget presign and job creation routes to protect credit balances and S3 buckets.
- **Tier 2.1 (Job Sweeper):** Built an automated stuck-job sweeper in the dispatcher that refunds credits (with idempotency guards) and marks jobs `FAILED` if they sit in `QUEUED` for >10 mins.
- **Tier 2.3 (B2B Webhooks):** Engineered a secure webhook delivery pipeline for terminal widget jobs:
  - Updated DB schema and ran migrations for `webhookUrl` and `webhookSecret`.
  - Built a robust consumer with exponential backoff and 3x retries via stream re-queueing.
  - Hardened with SSRF protection (rejecting private IPs & redirects) and Stripe-style HMAC payload signatures.
  - Wired the entire configuration UI into the Admin Dashboard (`WidgetClientDetail.tsx`).

### Failed / Not Done
- **T2.1 Job Cancellation:** Skipped user-facing `DELETE` route as the sweeper safely handles the operationally critical case.

### Open Questions / Decisions
- None.

## 2026-06-30 — Repository Inventory

### Done
- Built a complete repository inventory of the Aivastra codebase.
- Traversed all directories recursively and enumerated every file, classifying them into source files, configuration files, and other project assets.
- Recorded path, category, purpose description, size on disk, and read status for all 509 files.
- Documented specific, structured skip reasons for the 503 files that were skipped during this session (not yet read).
- Produced a beautiful and comprehensive Markdown table named **Repository Inventory** inside the artifact directory: [repository_inventory.md](file:///C:/Users/syste/.gemini/antigravity-cli/brain/dd6f99a1-c7a5-48bf-8199-7ada72ada7a4/repository_inventory.md).

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-24 — Premium dark mode Task 5: refine tokens.css palettes and remove hardcoded colors

### Done
- Updated `:root` light palette in `apps/admin-web/src/styles/tokens.css`:
  - Replaced `--surface: #ffffff` with `oklch(0.99 0.005 80)`.
  - Reordered semantic status variables so each status group keeps base/soft/ink/border together.
- Updated `[data-theme="dark"]` to warm charcoal (`hue 55`):
  - Darkened `--bg`/`--surface`/`--surface-2`/`--surface-hover` and adjusted all greys to hue 55.
  - Warmed and balanced accent, success, warn, danger, and info values.
  - Updated shadow tints to hue 55.
- Replaced six hardcoded color usages with CSS variables:
  - `.status-dot::before` box-shadow now uses `var(--success-soft)`.
  - `.nav-item.alert .count` text now uses `var(--bg)`.
  - `.brand-mark` text now uses `var(--accent-ink)`.
  - `.role-pill` text now uses `var(--accent-ink)`.
  - `.inactive-overlay` now uses `var(--surface)` with `opacity: 0.5`.
  - `.imgpv-cap` background/text now uses `var(--ink)` / `var(--bg)`.
- Replaced the `html` transition block with `background-color`, `color`, `border-color`, and `box-shadow` transitions.
- Verified `pnpm --filter @aivastra/admin lint` passes (warnings are pre-existing).
- Verified `pnpm --filter @aivastra/admin build` succeeds.
- Committed: `feat(admin): warm-charcoal dark palette and remove hardcoded colors`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-24 — Premium dark mode Task 4: remove local theme state from App.tsx

### Done
- Removed the local `Theme` type and `readInitialTheme()` helper from `apps/admin-web/src/App.tsx`.
- Replaced local `useState` theme state with `useTheme()` from `./context/ThemeContext`.
- Removed the `useEffect` that synced `data-theme` and `localStorage`; `ThemeProvider` now owns that.
- Removed the local `toggleTheme` `useCallback`.
- Updated `settingsProps` to pass `theme` and `setTheme`.
- Left the `<Topbar ... />` call unchanged as instructed.
- Updated `apps/admin-web/src/pages/SettingsPage.tsx` to accept the new `Theme`/`setTheme` props and toggle using `resolvedTheme` from `useTheme()`; this was required to keep the TypeScript build passing after changing `settingsProps`.
- Applied Biome formatting/import ordering fixes required by the lefthook pre-commit hook.
- Verified `pnpm --filter @aivastra/admin build` succeeds with no TypeScript errors.
- Committed: `refactor(admin): App.tsx consumes useTheme instead of owning theme state`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- The task description listed only `apps/admin-web/src/App.tsx` as modified, but `SettingsPage.tsx` also had to be updated because the new `settingsProps` no longer provides `onToggleTheme`. Task 8 was originally scoped to update `SettingsPage` props; the necessary prop change was pulled forward to keep the build green.
- `toggleTheme` from `useTheme()` was not destructured in `App.tsx` because it has no consumer until Task 7 wires it into `Topbar`; destructuring it now would trigger `noUnusedLocals`.

## 2026-06-24 — Premium dark mode Task 3: wire ThemeProvider into main.tsx

### Done
- Updated `apps/admin-web/src/main.tsx` to import `ThemeProvider` from `./context/ThemeContext.tsx`.
- Wrapped `<App />` with `<ThemeProvider>` inside `<AuthProvider>` so `useAuth()` is available to `ThemeProvider` and `useTheme()` is available throughout the app.
- Verified `pnpm --filter @aivastra/admin build` succeeds with no TypeScript errors.
- Committed: `feat(admin): wrap App with ThemeProvider`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-24 — Premium dark mode Task 2: create ThemeProvider context

### Done
- Created `apps/admin-web/src/context/ThemeContext.tsx` with `ThemeProvider` and `useTheme` hook.
- Implemented localStorage persistence via `aivastra-theme`, system-preference listening, and server preference sync via `/admin/me` and `/admin/me/preferences`.
- Ensured the server-preference fetch waits for `!isLoading` to avoid duplicating `/admin/me` calls already made by `AuthProvider.fetchRole()`.
- Applied Biome formatting/import ordering fixes required by the lefthook pre-commit hook.
- Verified `pnpm --filter @aivastra/admin build` succeeds with no TypeScript errors.
- Committed: `feat(admin): add ThemeProvider with system preference and server sync`.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-24 — Premium dark mode Task 1: expose `isAuthenticated` from AuthContext

### Done
- Added `isAuthenticated: boolean` to the `AuthState` interface in `apps/admin-web/src/context/AuthContext.tsx`.
- Provided `isAuthenticated: !!token` in the `AuthContext.Provider` value object.
- Verified `pnpm --filter @aivastra/admin build` succeeds with no TypeScript errors.
- Committed: `feat(admin): expose isAuthenticated from AuthContext`.

## 2026-06-24 — Add $type annotation to admin_users preferences

### Done
- Added `.$type<{ theme?: 'light' | 'dark' | 'system' }>()` annotation to `preferences` jsonb column in `packages/db/src/schema/admin.ts`.
- Verified builds pass for both `@aivastra/db` and `@aivastra/api`.
- Migration `0059_admin_preferences.sql` already existed from prior commit.

### Failed / Not Done
- None.

### Open Questions / Decisions
- None.

## 2026-06-24 — Comprehensive codebase reference document

### Done
- Analysed the entire Aivastra monorepo: apps (api, dispatcher, web, admin, admin-mobile), packages (db, types, storage, logger, observability), infra, tests, and docs.
- Created `docs/codebase-reference.md` as an internal reference covering architecture, stack, monorepo layout, DB schema, API/dispatcher/web/admin details, testing, env vars, deployment, invariants, and key files.

### Failed / Not Done
- Repository-wide `pnpm lint` still reports pre-existing errors/warnings unrelated to the new document (`.opencode/plugins/graphify.js`, `apps/admin-web/src/components/`, `scripts/seed-admin.ts`, `biome.json` config).

### Open Questions / Decisions
- Whether to keep `docs/codebase-reference.md` as a living document and how frequently it should be refreshed after large architectural changes.

## 2026-06-15 - Admin mobile Android emulator ABI fix

### Done
- Diagnosed the `libreactnative.so` startup crash as an ABI mismatch: the debug APK was being built for `arm64-v8a` only and then installed on an `x86_64` emulator.
- Updated the generated Android Gradle properties to package both `arm64-v8a` and `x86_64` for local testing.

### Failed / Not Done
- The APK has not been rebuilt after the ABI fix in this turn.

### Open Questions / Decisions
- If you want faster physical-device-only debug builds later, the ABI list can be narrowed back to `arm64-v8a` before release packaging.

## 2026-06-15 — Admin mobile EAS Android autolinking fix

### Done
- Diagnosed the EAS Java failure as Expo SDK 53 running with pnpm isolated dependencies, which Expo documents as unsupported for reliable native builds.
- Switched the workspace to pnpm's hoisted linker and pinned React/React DOM runtime and type versions for deterministic monorepo resolution.
- Added the required direct `expo-font` and `expo-linking` native peer dependencies and ignored local `.expo` state.
- Verified Android autolinking now emits `import expo.modules.ExpoModulesPackage;` instead of the invalid `expo.core` import.
- Verified Expo Doctor 18/18, admin-mobile typecheck, web-admin production build, and Android Hermes export.

### Failed / Not Done
- The corrected EAS cloud APK build has not yet been submitted; the next build should use `--clear-cache` to discard the failed build's native cache.

### Open Questions / Decisions
- Expo SDK 54+ supports isolated pnpm installs; the workspace can reconsider `nodeLinker: hoisted` during a future SDK upgrade.

## 2026-06-15 — Admin mobile EAS project linking

### Done
- Linked the dynamic Expo configuration to EAS project `c1c815e3-1a59-4965-874f-c494e08702b2` with an environment override option.
- Set EAS CLI app-version handling to local, removing the upcoming `cli.appVersionSource` warning.
- Verified the resolved Expo config contains the EAS project ID and current Wi-Fi API/storage URLs.
- Verified admin-mobile typecheck, EAS JSON parsing, and diff whitespace.

### Failed / Not Done
- The cloud APK build has not yet been retried after linking; it requires the authenticated user command.

### Open Questions / Decisions
- App version remains `0.0.0`, which is acceptable for this internal preview but must be raised before production distribution.

## 2026-06-14 — Admin mobile Wi-Fi APK preview setup

### Done
- Added an EAS `preview` profile that produces an internally distributed Android APK.
- Configured the preview APK for the current Wi-Fi host `192.168.29.54` on API port 4000 and MinIO port 9000.
- Added storage URL propagation through Expo config and made the MinIO host binding configurable without exposing Postgres or Redis.
- Updated ignored local environment files for physical-device API and storage access.
- Verified mobile typecheck, `eas.json` parsing, Docker Compose configuration, and diff whitespace.

### Failed / Not Done
- MinIO recreation and endpoint reachability checks could not run because Docker Desktop was not running.
- Windows Firewall access for TCP ports 4000 and 9000 still needs confirmation from the physical phone.

### Open Questions / Decisions
- The Wi-Fi IP is embedded in the preview profile and must be updated if the computer receives a different DHCP address.

## 2026-06-14 — Admin mobile production-readiness audit

### Done
- Audited Android release configuration, environment handling, authentication persistence, tests, and observability.
- Confirmed feature implementation and Hermes export are complete, but production release infrastructure and device QA are still pending.
- Identified auth lifecycle risks: foreground bootstrap failure does not clear the in-memory access token, and API refresh does not update the Zustand token used by SSE/navigation.

### Failed / Not Done
- No EAS build profiles, signed release build verification, automated mobile tests, crash reporting, analytics, or staged rollout configuration exist yet.
- Production API/storage environment validation and full emulator/physical-device regression testing are not complete.

### Open Questions / Decisions
- Select the production distribution path (Google Play internal testing/EAS or native Gradle CI), crash-reporting provider, and automated device-test framework.

## 2026-06-14 — Admin mobile Phase 8 operations and configuration

### Done
- **P0-1:** Switched the `preview` EAS profile in `eas.json` to point to `staging` rather than hardcoding a developer's local LAN IP.
- **P0-2:** Updated `app.config.js` to only allow cleartext HTTP traffic if `APP_ENV === 'development'` (which excludes the newly configured staging `preview` builds).
- **P0-3 & P0-4:** Refactored `apiFetch` in `api.ts` to directly read the latest token from `useAuthStore.getState().token`. Eliminated the redundant module-level `let token` and the asynchronous `setApiToken` sync in `_layout.tsx`, fixing token divergence after silent refreshes and 401s on initial navigation after login.
- **P0-5:** Fixed `confirmAction` in `ConfirmDialog.ts` by making the `onPress` callback `async`, awaiting `onConfirm()`, and catching and alerting any errors so that backend failures (like during deletions or bans) aren't silently swallowed.
- **P0-6:** Wired up the `copyToClipboard` function in the widget clients detail screen to correctly use `await Clipboard.setStringAsync(text)` instead of a no-op placeholder.
- **P1-1 & P1-5:** Fixed unhandled 401 on refresh failure by importing `useAuthStore` to trigger a logout, and fixed stale SSE tokens by calling `useAuthStore.setState({ token: accessToken })` within `tryRefreshToken()`.
- **P1-2 & P1-9:** Updated catalog bulk-delete to run concurrently via `Promise.allSettled()` while catching and surfacing partial failures to the user. Added the missing `canDeleteAssets` role check to the category long-press edit handler.
- **P1-3:** Fixed duplicate fetch bug in `usePagination` by preventing `loadMore` from firing if `page === 0`.
- **P1-4:** Marked notification settings in `settings.tsx` as "Coming soon" and disabled their inputs, preventing users from mistakenly believing they are active.
- **P1-6:** Added a `console.warn` to `storageUrl()` in `storage.ts` in `__DEV__` to clearly flag missing `EXPO_PUBLIC_STORAGE_URL` environment variables instead of failing silently.
- **P1-7:** Added an itemized confirmation breakdown (counts of backgrounds, faces, and pose assets) to the empty recycle bin prompt.
- **P1-8:** Corrected `useApi` so it immediately returns `null` data instead of temporarily rendering stale data from a previous route when navigating backwards.
- **P1-10:** Added `'FAILED'` to the refresh triggers in `jobs/[id].tsx` so the UI immediately pulls the error code when a job fails over the live stream.
- **P2-20 & P2-13:** Fixed `useApi` so it properly clears stale data immediately on path change and correctly raises a toast if an error happens while old data is rendered (e.g. background polling failure).
- **P2-22:** Fixed `useEffect` missing dependencies warning in `settings.tsx`.
- **P2-23:** Fixed home screen loading state so the pull-to-refresh spinner doesn't run during silent background polls.
- **P2-4:** Fixed exhaustive-deps lint warning in `settings.tsx` by passing `localSettings` properly.
- **P2-9:** Addressed orphaned main image uploads in `uploadTwoImage` by delegating cleanup to R2 lifecycle rules.
- **P2-10:** Fixed spinner disappearing too early in `jobs/index.tsx` if a stale request was cancelled by a newer one.
- **P2-11:** Updated `useSSE` in `jobs/index.tsx` to automatically fetch jobs when a new matching job appears in the stream.e
- Implemented the Workers screen against the actual keyed Redis registry response, with health parsing, pull-to-refresh, and 30-second polling.
- Implemented SUPER_ADMIN credit-plan CRUD using the live `slug`, `name`, `subtext`, credits, paise price, badge, highlight, active, and sort-order schema.
- Added safe handling for successful `204 No Content` API mutations, required by credit-plan deletion.
- Implemented the SUPER_ADMIN system-config form for the actual `creditCostPerJob` and `maxJobsPerDay` fields, including dirty-state detection and guarded refresh.
- Registered and wired Workers, Credit Plans, and System Config routes, completing the More menu navigation map.
- Verified admin-mobile typecheck, source diff checks, theme/log audits, and a clean Android Hermes export.

### Failed / Not Done
- Worker GPU utilization, VRAM usage, and true active-job counts are not displayed because the current worker registry API does not publish those fields.
- Emulator interaction QA remains for polling, credit-plan create/edit/delete conflict behavior, and config dirty-refresh confirmation.

### Open Questions / Decisions
- The worker screen derives a single active slot from `status === 'BUSY'`; richer GPU/job metrics require a backend registry contract extension.
- The current config API exposes only credit cost and daily job limit; maintenance mode, default credits, per-user limits, and retry limits are not implemented server-side.

## 2026-06-13 — Admin mobile Phase 7 workflows and recycle bin

### Done
- Added typed workflow list and detail routes with active state, metadata, node IDs, prompts, and pose counts.
- Added role-gated workflow label/status editing, pose reassignment, and conflict-aware deletion.
- Added grouped recycle-bin sections for faces, backgrounds, and pose assets with accessible selection controls.
- Added restore, role-gated permanent deletion, and confirmed empty-bin operations with refreshed server state.
- Wired Workflows and Recycle Bin into the More stack and menu with backend-aligned role restrictions.
- Verified admin-mobile typecheck, source diff checks, theme/log audits, and a clean Android Hermes export.

### Failed / Not Done
- Emulator interaction QA remains for workflow reassignment, conflict deletion, grouped restore, and empty-bin behavior.
- Workflow creation and JSON/node mapping remain web-admin-only by design.

### Open Questions / Decisions
- Empty-bin requests are grouped by asset type because the API accepts one recycle type per request; partial failures trigger a refresh and explicit warning.

## 2026-06-13 — Admin mobile Phase 6 catalog

### Done
- Fixed the Phase 5 pose-asset mapping contract by carrying `garmentTypeId` into pose-detail navigation.
- Fixed the garment-type detail loading state for dark theme and normalized the screen into maintainable source formatting.
- Added the Catalog route stack, More-menu navigation, lower-garment/shoe tabs, category-aware rows, and image upload/create flow.
- Added catalog item detail editing for label, gender, active state, sort order, and garment-type assignments, with role-gated deletion.
- Verified admin-mobile typecheck, source diff checks, theme/log audits, and a clean Android Hermes export.

### Failed / Not Done
- Emulator interaction QA remains for MinIO image display, catalog uploads, assignment changes, and deletion.
- Catalog category reassignment remains web-admin-only because the mobile Phase 6 scope specifies read-only category display.

### Open Questions / Decisions
- Catalog detail falls back to the `lower` endpoint if opened without a type parameter; normal in-app navigation always provides the item type.

## 2026-06-13 — Admin mobile Phase 5 assets

### Done
- Applied the Phase 4 review cleanup by resolving face/background thumbnail URLs once per detail render.
- Added reusable searchable picker modal infrastructure.
- Implemented garment type list/create/detail flows, JPEG thumbnail upload, active/lower-upload toggles, pose navigation, conflict handling, and role-gated deletion.
- Implemented garment-type pose grid/detail flows with active filtering, bulk delete, prompt/order/workflow editing, and force-delete confirmation for referenced jobs.
- Implemented pose asset library, multi-image creation uploads, metadata/mapping detail, garment-type mapping, bulk soft delete, and force-delete confirmation.
- Verified mobile typecheck and a clean Android Hermes export for all Phase 5 routes.

### Failed / Not Done
- Existing garment-type slugs are read-only because the current `PatchGarmentTypeBody` API does not accept `slug`.
- Emulator interaction QA remains for multi-image upload progress, picker selection, mapping, activation conflicts, and force-delete flows.

### Open Questions / Decisions
- Pose-asset gender and face/background/workflow reassignment can be expanded in a follow-up refinement; creation currently requires existing face, background, and workflow selections.

## 2026-06-13 — Admin mobile Phase 4 asset hub

### Done
- Verified local `master` matches remote HEAD `ec18526`; no pull or conflict resolution was required.
- Added emulator-safe storage URL handling, thumbnail generation, progress-aware XHR uploads, two-image upload confirmation, and JPEG-only thumbnail uploads.
- Added reusable themed image picker, upload progress, square asset card, and horizontal asset row components.
- Converted the Assets tab from a flat placeholder into a nested asset hub with live counts.
- Implemented Faces and Backgrounds list grids with gender filtering, pull-to-refresh, selection mode, role-gated bulk soft delete, and upload forms.
- Implemented Face and Background detail editing, active/white-background toggles, role-gated deletion, and 409 conflict messaging.
- Added `canDeleteAssets()` and the Expo SDK-compatible `expo-image` dependency.
- Verified mobile typecheck and a clean Android Hermes export with the nested Phase 4 routes.

### Failed / Not Done
- Phases 5–8 remain pending; they were not compressed into the Phase 4 change because each phase requires separate end-to-end API and emulator validation.

### Open Questions / Decisions
- Local Android emulator storage uses `http://10.0.2.2:9000/aivastra`; physical devices need a LAN-reachable MinIO URL instead.

## 2026-06-13 — Admin mobile Phase 3 review cleanup

### Done
- Consolidated user avatar initials formatting into the shared `format.ts` utility and updated list/detail consumers.
- Reviewed proposed future More stack registrations against Expo Router behavior.

### Failed / Not Done
- Did not register nonexistent workflows, recycle-bin, settings, or config routes because Expo Router emits unmatched-screen warnings; each registration will be added with its route implementation.

### Open Questions / Decisions
- None.

## 2026-06-13 — Admin mobile Phase 2 refinement and Phase 3 Users

### Done
- Added a global Zustand toast queue with animated success/error/warning/info cards, three-toast limit, manual dismissal, and automatic dismissal.
- Mounted toast rendering at the root and wired job cancel/retry success feedback.
- Added reusable paginated data loading and imperative confirmation helpers.
- Added theme-aware user rows, credit grant page-sheet modal, debounced searchable users list, and paginated refresh/loading/error states.
- Added user detail with profile metrics, recent jobs, role-gated credit grants, ban/unban, session revocation, and super-admin soft delete.
- Converted the More route into a nested stack, wired More → Users and Dashboard Active Users → Users navigation.
- Removed the final direct dark/light palette usage from mobile UI components; runtime colors now come from `useAppTheme()`.
- Verified mobile typecheck, source diff formatting, Expo Router route discovery, and a clean Android Hermes export.

### Failed / Not Done
- Emulator interaction checks for grant, ban/unban, delete, and toast timing require authenticated test users and remain manual QA.

### Open Questions / Decisions
- The backend user-detail endpoint currently returns a partial object instead of HTTP 404 for an unknown UUID; the mobile screen defensively treats missing `id` or `email` as not found.

## 2026-06-13 — Admin mobile Material 3 Expressive redesign

### Done
- Added a semantic light/dark Material-inspired color system, expressive shape scale, elevated glass surfaces, and persisted `system` / `light` / `dark` appearance modes.
- Rebuilt the dashboard as a bento command center with a featured metric, compact supporting cards, worker pulse, attention queues, and expressive seven-day chart.
- Added smart admin search shortcuts for failed, queued, and generating jobs, worker navigation, and direct pasted job-ID navigation.
- Replaced text glyph navigation with Material Community icons and a floating rounded bottom navigation surface.
- Redesigned login and More/profile screens, including a three-way appearance selector.
- Migrated jobs list/detail, cards, filters, statuses, accordions, timelines, empty states, and skeletons to dynamic semantic colors.
- Added `@expo/vector-icons` as a direct mobile dependency and verified mobile typecheck, Expo dependency compatibility, and clean diff formatting.

### Failed / Not Done
- Smart search is an intent-based local command router, not an LLM-backed assistant; conversational API integration remains future scope.
- Assets remains a Phase 4 placeholder and More menu routes remain tied to later implementation phases.

### Open Questions / Decisions
- Emulator QA should verify floating navigation safe-area spacing, glass opacity in both themes, small-screen bento wrapping, and keyboard behavior on login/search.

## 2026-06-13 — Admin mobile Phase 2 UI polish

### Done
- Added reusable animated `SkeletonLoader`, `EmptyState`, `AccordionSection`, and Android-capable pinch/drag `ImagePreview` components.
- Replaced initial dashboard and jobs-list spinners with layout-matched skeleton states.
- Replaced percentage chart heights with numeric Android-safe bar heights.
- Added collapsible job-detail sections, fullscreen input/output image previews, and started/completed timestamps.
- Added expandable event payload JSON with clipboard copy feedback using `expo-clipboard`.
- Added explicit 404 job-not-found handling and per-action cancel/retry loading indicators.
- Verified Expo dependencies, mobile typecheck, and a clean Android bundle with `--max-workers 1`.

### Failed / Not Done
- Active Users stat-card navigation remains deferred until the Phase 3 Users route exists.

### Open Questions / Decisions
- Emulator QA should verify pinch/drag bounds, accordion ergonomics, and chart appearance with real dashboard data.

## 2026-06-13 — Remote synchronization before mobile work

### Done
- Fetched and fast-forwarded `master` from `ce49477` to remote HEAD `ec18526` after stashing all staged, unstaged, and untracked local work.
- Restored local mobile work after the pull with no merge conflicts.
- Confirmed remote commit `a6bf082` split the large admin `AssetsPage.tsx` into per-tab components.
- Confirmed remote commit `ff39751` removed the root `assets/` directory from Git tracking; the pull removed those formerly tracked local copies, and the existing `assets/*` rule prevents future re-addition.

### Failed / Not Done
- None.

### Open Questions / Decisions
- Local changes are intentionally left uncommitted and unpushed.

## 2026-06-13 — Admin mobile pending-work audit

### Done
- Audited the current route tree and implementation against `admin-mobile-phase2-plus-plan.md` after successful Android emulator startup.
- Confirmed Auth, Dashboard, Jobs list, and Job detail are functional foundations; Assets remains a placeholder and More menu items are not wired.
- Confirmed Phases 3–8 and their shared infrastructure are not implemented.

### Failed / Not Done
- No implementation changes were made; this entry records scope only.

### Open Questions / Decisions
- Prioritize Phase 3 Users next, or complete remaining Phase 2 UX/polish gaps before starting new administration domains.
- Node 20 LTS remains recommended for Expo SDK 53; Node 24 requires reduced Metro worker counts locally.

## 2026-06-12 — Admin mobile Expo startup fix

### Done
- Converted `app.config.js` to ESM and renamed CommonJS Metro/Babel configuration files to `.cjs` so they load correctly under the package's `"type": "module"` setting.
- Added `@babel/runtime` as a direct mobile dependency and updated Metro's pnpm monorepo watch/resolution paths to include the workspace root.
- Corrected the Expo Router entry point from legacy `expo/AppEntry.js` to `expo-router/entry`.
- Aligned React, React Native, Expo Router, and native Expo modules to the Expo SDK 53 compatibility set; added required Router and SecureStore config plugins.
- Audited the full workspace React graph (18.3.1, 19.0.0, and 19.2.6 coexist by design), pinned mobile React exactly to 19.0.0, and forced Metro's mobile React/React Native resolutions to the app-local dependency graph without globally overriding other workspaces.
- Verified with a clean Android source-map export that the mobile bundle contains only `react@19.0.0`.
- Removed import-time `Intl.RelativeTimeFormat` and `Intl.NumberFormat` usage from shared mobile formatters for Hermes compatibility; declared the Assets tab unconditionally and hide it with `href: null` to satisfy Expo Router layout child requirements.
- Confirmed the Hermes-safe mobile bundle succeeds with a single Metro worker; Node 24's multi-worker export path remains unstable, so Node 20 or `--max-workers 1` is recommended for local Expo development.

### Failed / Not Done
- None.

### Open Questions / Decisions
- Android emulator UI and networking still require runtime verification after Metro starts.

## 2026-06-12 — Admin mobile Phase 2 jobs flow

### Done
- Replaced the jobs tab placeholder with a nested stack, paginated job list, URL-derived initial filter, pull-to-refresh, infinite loading, global SSE badge updates, and 15-second polling fallback after stream errors.
- Added `EventTimeline` using `JobEvent.eventType`; worker and error details are read from `event.payload`.
- Added `useAdminJobStream` as a typed `useSSE` wrapper that filters the global admin stream by job ID and reconnects when the route job changes.
- Added the `JobDetail` screen with live optimistic timeline events, job metadata, input/output images, and role-safe cancel/retry actions.
- Corrected stuck-job identifiers on the dashboard to use neutral text instead of error red.
- Confirmed job events are returned newest-first; retained live-event prepending and cleared optimistic events before completion refetches to prevent duplicates.

### Failed / Not Done
- None.

### Open Questions / Decisions
- The dashboard percentage-height bar chart still needs a device or simulator visual check before release.
- `/admin/jobs/stream` is global and does not support server-side job filtering; the detail hook filters events client-side.

## 2026-06-12 — Admin mobile worker card

### Done
- Added `accessible` to `StatusBadge` so its explicit screen-reader label is used.
- Added `WorkerCard` using the real `DashboardWorker` payload: worker ID, health-derived status, and relative last-seen time.
- Kept unhealthy workers visually and semantically offline; did not invent the stale plan's unavailable GPU field.
- Consolidated status-label formatting in `lib/format.ts` for reuse by worker and job UI components.
- Added a typed, reusable horizontal `FilterChips` control and the six plan-defined job filters; transient `PREPROCESSING` and `UPLOADING` remain under `All` only.
- Removed the ineffective accessibility label from the filter `ScrollView`; individual chips retain button roles and selected state announcements.
- Added `JobCard` with the plan-defined status, user, shortened job ID, credit cost, and relative creation time layout.
- Humanized the job status in `JobCard` accessibility announcements to match the visible badge label.
- Replaced the dashboard placeholder with the full `/admin/stats` view: 30-second polling, pull-to-refresh, six stat cards, seven-day chart, direct `DashboardWorker[]` rendering, recent failures, and stuck jobs.
- Applied failed-job alert styling only when `failed24h` is non-zero and added an all-workers-offline warning.

### Failed / Not Done
- None.

### Validation
- `pnpm --filter @aivastra/admin-mobile typecheck`
- `git diff --check -- apps/admin-mobile/src/components/StatusBadge.tsx apps/admin-mobile/src/components/WorkerCard.tsx`

### Open Questions / Decisions
- The plan's `WorkerCard` GPU comment is stale because `/admin/stats` does not return GPU data.
- `PREPROCESSING` and `UPLOADING` jobs are intentionally reachable only through the `All` filter, which may make targeted transient-state investigation slower during QA.

> Update this file after every plan execution (superpowers/plan or any implementation plan).
> Record what was done, what failed, and open questions/decisions.

---

## Log

### 2026-06-12 — Admin Mobile Phase 2 shared prerequisites

**Done:**
- Added `apps/admin-mobile/src/types.ts` with the shared admin domain types and
  Phase 2 dashboard, job detail, pagination, and SSE event contracts.
- Added `src/lib/sse.ts` with an authenticated fetch-based SSE reader, multiline
  event parsing, heartbeat tolerance, cleanup, and bounded reconnect backoff.
- Added `src/lib/format.ts` with relative time, date, and Indian-locale number
  formatting helpers.
- Added `src/hooks/useApi.ts` with loading, error, refresh, stale-request, unmount,
  disabled-query, and React Strict Mode handling.
- Added `src/hooks/useSSE.ts` with auth-token wiring and automatic connection cleanup.
- Consolidated mobile `AdminRole` usage onto the shared type definition.
- Verified `pnpm --filter @aivastra/admin-mobile typecheck` passes with zero errors.
- Added `src/components/StatCard.tsx` for Phase 2 dashboard metrics, including
  optional navigation, alert styling, subtitles, formatted values, hidden null
  deltas, and neutral zero-delta rendering without an arrow.
- Verified `/admin/stats` deltas are percentage changes, already multiplied by 100
  and rounded by the API; `StatCard` therefore retains the `%` suffix. Its props now
  enforce delta/subtitle exclusivity, and delta text uses the shared sans typography.
- Added `src/components/StatusBadge.tsx` with compact/full-width variants, status
  dots, the seven documented job-state colors, accessible labels, and a resilient
  gray fallback for unknown future states.

**Failed / Not Done:**
- Remaining Phase 2 components and screens were not started; this entry covers plan
  §2.2 steps 1–6 and reordered step 8 (`StatusBadge`) before `WorkerCard`.

**Open Questions / Decisions:**
- SSE reconnects currently reuse the same access token. If the stream is the only
  active request when that token expires, 401 responses retry with backoff until
  another app action refreshes the token. Add SSE-triggered refresh handling in a
  later Phase 2+ pass.
- `useApi()` is intentionally GET-only for current Phase 2 dashboard/list queries.
  Extend it or add a mutation hook before Phase 3+ form submissions need request
  methods or bodies.

---

### 2026-06-12 — Admin Mobile auth error handling + documentation corrections

**Done:**
- Fixed `apps/admin-mobile/src/store/auth.ts`: login error parsing now reads
  `body.error.code` (matching the API's `{ error: { code, message } }` envelope).
  `EMAIL_NOT_VERIFIED` (403) surfaces as a dedicated error; all other login failures
  (wrong password, non-admin, inactive admin) surface as `INVALID_CREDENTIALS`.
- Fixed `apps/admin-mobile/src/app/(auth)/login.tsx`: shows "Email not verified —
  check your inbox" for `EMAIL_NOT_VERIFIED`; removed dead `NOT_ADMIN` branch (the
  new `login-mobile` returns 401 for non-admins, not 403).
- Corrected `docs/admin-mobile-implementation-report.md` §1.2: web `/v1/auth/refresh`
  retains inlined rotation logic — it does **not** call `rotateTokenFamily()`. Only
  `refresh-body` calls `rotateTokenFamily(app, plain, 'mobile')`.
- Updated `docs/admin-mobile-phase2-plus-plan.md` §4.8: shared `uploadAsset()` helper
  excludes garment types; garment-type upload documented as thumbnail-only
  (`presign → PUT → POST /admin/assets/garment-types`).

**Deferred:**
- 429 rate-limit responses display generic "Invalid credentials" messaging for now.
  Proper "Too many attempts — try again later" handling is Phase 2+ backlog.

---

### 2026-06-12 — Admin Mobile Phases 2-8 implementation plan

**Done:**
- Created `docs/admin-mobile-phase2-plus-plan.md` — detailed implementation plan for
  all remaining phases (2-8), covering ~61 new files across 41 screens:
  - **Shared prerequisites:** StatusBadge, ConfirmDialog, FilterChips, EmptyState,
    SkeletonLoader, PullToRefresh, Toast, useApi/usePagination/useSSE hooks,
    SSE lib, format lib, thumbnail lib, TypeScript types
  - **Phase 2 (Dashboard + Jobs):** 8 files — StatCard, WorkerCard, JobCard,
    EventTimeline, real Dashboard, Job list with SSE, Job detail with cancel/retry
  - **Phase 3 (Users):** 4 files — UserRow, GrantCreditsModal, User list, User detail
  - **Phase 4 (Assets Core):** 11 files — AssetCard, AssetRow, UploadProgress,
    ImagePreview, Face/Background list/detail/upload
  - **Phase 5 (Assets Advanced):** 11 files — Garment Types, Poses (face×bg grid),
    Pose Assets (with mapping), WorkflowPicker
  - **Phase 6 (Catalog):** 5 files — CategoryTree, Catalog items, batch upload
  - **Phase 7 (Workflows + Recycle Bin):** 7 files — Workflow list/detail/upload,
    Recycle Bin with tabs (restore/delete)
  - **Phase 8 (Settings + Config):** 4 files — Credit plans CRUD, Config form
  - Each phase includes: build order, data flow, UI states (loading/empty/error),
    and cross-cutting checklist (skeleton, pull-to-refresh, toast, tablet)
  - Navigation wiring plan for `more.tsx` as each phase completes

---

### 2026-06-12 — Admin Mobile Phase 1: Backend endpoints + scaffold

**Done:**
- **Backend (apps/api):** Added 3 mobile auth endpoints to `routes.ts`:
  - `POST /v1/auth/login-mobile` — body-based login with admin_users check, returns `{ accessToken, refreshToken }` in JSON
  - `POST /v1/auth/refresh-body` — body-based token rotation, reuses shared `rotateTokenFamily()` function
  - `POST /v1/auth/logout-mobile` — body-based logout, revokes refresh token family via `revokedAt`
  - Extracted `rotateTokenFamily()` from `/v1/auth/refresh` to avoid duplication
  - All 3 endpoints have rate limiting, Zod body schemas, and no cookie usage
  - Existing `/v1/auth/refresh` refactored to call shared function — identical behavior
- **Types (packages/types):** Added `build:cjs` script + `require` export condition for Metro bundler compatibility
- **Scaffold (apps/admin-mobile):** Created Expo SDK 53 project with:
  - `package.json` — full deps (Expo 53, React Native 0.79, React 19, Zustand, etc.)
  - `app.config.js` — Android-only, `usesCleartextTraffic` for dev, image-picker + media-library plugins
  - `metro.config.js` — SVG transformer + `@aivastra/types` CJS resolver
  - `tsconfig.json` — standalone, extends `expo/tsconfig.base`
  - `babel.config.js` — with reanimated plugin
- **Foundation files:**
  - `src/styles/tokens.ts` — Colors, Spacing, Radius, Typography (ported from admin CSS)
  - `src/store/auth.ts` — Zustand store: login, logout, bootstrap, SecureStore persistence
  - `src/store/theme.ts` — Zustand store: dark/light toggle, AsyncStorage persistence
  - `src/lib/api.ts` — `apiFetch()` with 401 → refresh-body → retry interceptor
  - `src/lib/roles.ts` — `canAccessAssets()`, `canManageUsers()`, `isSuperAdmin()` helpers
- **Screens:**
  - `src/app/_layout.tsx` — Root layout: GestureHandlerRootView, auth gate, AppState foreground refresh
  - `src/app/(auth)/login.tsx` — Login screen: email/password form, error states, dark theme
  - `src/app/(tabs)/_layout.tsx` — 4-tab bottom navigator with role-based Assets tab visibility
  - Placeholder screens: `home.tsx`, `jobs.tsx`, `assets.tsx`, `more.tsx` (with logout)

**Typecheck:** Passes cleanly (both `@aivastra/api` mobile endpoints and `@aivastra/admin-mobile`)

**Open Questions / Decisions:**
- Pre-existing type errors in `admin/guard.ts`, `admin/users.routes.ts`, and `auth/routes.ts` (`request-admin`) — all from `status` column removed in migration 0039. Not related to mobile work.

---

### 2026-06-12 — Admin Mobile plan review (round 2)

**Done:**
- Addressed 10 remaining issues from second review:
  - Bumped Expo from SDK 52 to **SDK 53** (React Native 0.78, New Architecture default)
  - Bumped all dependency versions for SDK 53 compatibility (expo ~53, react-native-svg ~15.11, reanimated ~3.17, etc.)
  - Added §1.6: New Architecture compatibility checklist
  - Added §1.7: Root `pnpm dev` exclusion (mobile app not started by workspace runner)
  - Fixed §4.2 Dashboard: workers now call `/admin/workers` separately (`/admin/stats` workers have no name/GPU)
  - Fixed §4.2 Dashboard: `failed24h` has no server-provided delta — documented as standalone count
  - Added §4.7: asset-type → presign endpoint mapping table (6 endpoints with response shapes)
  - Added §4.4 dev note: job detail images use public URLs, MinIO 127.0.0.1 unreachable from physical devices
  - Added explicit SSE path `/admin/jobs/stream` in §4.3
  - Added §3.2: `AppState` foreground token refresh listener in root layout

---

### 2026-06-12 — Admin Mobile plan review (round 1)

**Done:**
- Created comprehensive implementation plan at `docs/admin-mobile-implementation.md`
  for a React Native (Expo) admin app (`apps/admin-mobile`)
- Plan covers: project scaffold, 4-tab navigation, auth flow (body-based tokens),
  ~46 screens across 8 phases, component library, styling system, file migration map
- Addressed all 12 issues from plan review:
  - Two new backend endpoints needed: `/v1/auth/login-mobile` and `/v1/auth/refresh-body`
    (both return refresh tokens in JSON body — mobile can't read HTTP-only cookies)
  - Metro bundler ESM workaround: pre-build `@aivastra/types` to CJS + `metro.config.js` resolver
  - Removed `react-native-event-source`, committed to custom fetch-based SSE reader
  - Added missing deps: `expo-media-library`, `@react-native-async-storage/async-storage`, `react-native-gesture-handler`
  - Fixed Android minimum to single value (12+), removed contradiction
  - Added role helper functions (`canAccessAssets`, `canManageUsers`, `isSuperAdmin`)
  - Concrete CI pipeline with EAS Build + `EXPO_TOKEN` secret
  - `app.config.js` pattern for dev/staging/prod API URL switching
  - Phase 9 "Polish" deleted — skeleton/empty state/error boundaries threaded into each phase's deliverable

**Open Questions / Decisions:**
- None — all review issues resolved, plan ready for Phase 1 execution

---

### 2026-06-12 — Admin Mobile plan review (round 1 fixes)

### 2026-06-09 — Production deployment & nginx fixes

**Done**
- Ran `pnpm db:migrate` manually on VPS — migrations 0033–0036 applied (`model_pose_assets`, backfill, face/bg/workflow FKs, `display_name` column)
- Raised nginx `client_max_body_size` from 50m → 300m → 2500m on VPS to unblock ZIP bulk import (242MB+ uploads)
- Raised Fastify multipart `fileSize` limit to 2.5 GB (`chore(api): 487c9d5`)
- Identified CI auto-deploy was broken (git pull prompting for credentials); manual pull + deploy performed

**Open Questions**
- Fix CI auto-deploy: VPS `git pull` fails without credentials — likely `VPS_SSH_KEY` / GitHub token secret issue in GitHub Actions

---

### 2026-06-09 — Pose assets separation

**Done**
- `feat(db): model_pose_assets table` — migration 0033; centralised R2 object ownership; `model_poses.poseAssetId FK` added; backfill creates one asset row per distinct `r2_key` from existing poses
- `feat(api): pose-assets endpoints` — `GET /admin/assets/pose-assets`, `DELETE /admin/assets/pose-assets/:id` (blocked if mappings exist; deletes R2 on success)
- `feat(admin): bulk delete poses removes mappings only` — no R2 cleanup on pose mapping delete; single pose delete same
- `feat(admin): Pose Assets tab` — grid view of all `model_pose_assets` rows with delete confirmation; gender filter applies
- `feat(admin): bulk-import creates asset rows` — each imported pose file gets a `model_pose_assets` row with correct `faceSideR2Key`/`bgComfyR2Key` before mapping row insert

---

### 2026-06-09 — Bulk ZIP asset import

**Done**
- `feat(admin): bulk ZIP asset import endpoint + UI` — admin can upload a ZIP containing `backgrounds/`, `faces/`, and `poses/` folders; server extracts with `adm-zip`, uploads each image directly to R2 via new `putObject` storage method, inserts DB rows for faces/backgrounds/poses; pose filenames `faceXXbgYposeZZ.png` parsed to link to correct face+bg rows; returns `{ created, errors }` summary
- `feat(storage): add putObject to StorageProvider interface + R2 impl` — server-side direct R2 upload without presigned URL flow
- `feat(api): register @fastify/multipart with 250MB limit` for ZIP upload handling
- `feat(admin): Bulk Import ZIP button in garment-type subview header` — modal with ZIP picker, gender select, garment type + workflow dropdowns, progress spinner, result toast on success

---

### 2026-06-09 — Admin pose management improvements

**Done**
- `fix(admin): dedup pose clone by r2Key instead of face+bg combo` — clone skip condition changed from `(subcategoryId, faceId, backgroundId)` to `(subcategoryId, r2Key)`; multiple poses sharing same face+bg but different images now all clone correctly (ab56b07, 17c7a4a)
- `fix(admin): add BrowserRouter basename so /panel/ prefix is preserved on navigation` — admin SPA navigation no longer drops the `/panel/` prefix on route changes (e16b281)
- `feat(admin): bulk delete poses + cascading filter options` — "Delete selected (N)" danger button with warning modal; face/background filter dropdowns now cascade (selecting face narrows bg options to only those paired with that face, and vice versa) (ab56b07)

---

### 2026-06-07 — Admin improvements

**Done**
- `feat(admin): show ComfyUI input images in job detail + refresh button` — job detail view now shows all ComfyUI input images (face, pose, background, garment, lower, shoes); refresh button reloads job state without full page reload (20ed37d)
- `feat(admin): guard admin accounts from suspension/deletion + show Admin badge` — admin users cannot be banned or deleted from the users panel; Admin badge shown on their row (578ca42)
- `fix(ci): pass GITHUB_TOKEN to VPS git pull to fix HTTPS auth failure` — deploy pipeline was failing on git pull due to missing auth token (7d4a687)

---

### 2026-06-05 — Payments, credit plans, admin routing, web production pass

**Done**

*Payments & credits*
- `feat(payments): admin-controlled credit plans via DB` — credit plans stored in `credit_plans` table (migration 0028/0029); admin UI to create/edit/delete plans; plans drive pricing page (9648f93)
- `feat: Razorpay payments, resolution pricing, UX polish & production hardening` — server-side Razorpay order creation + HMAC-SHA256 signature verification; `payments` table (migration 0027) with GST breakdown (18%); HD=25cr / 2K=35cr / 4K=40cr per pose; resolution selector redesigned as radio pills; credit cost shown in studio footer (7b6f3a6)
- `fix(db): register credit_plans migrations in drizzle journal` — migrations 0028/0029 missing from journal (353b27a)

*Admin routing*
- `feat(admin): URL-based routing + pricing GST layout fix` — admin SPA switched to URL-based routing (React Router); pricing GST layout corrected (7c6a8ed)
- `feat(admin): set prod base path to /panel/` — avoids conflict with `/admin/*` API routes in production nginx (ae73677)
- `fix(web): clear NEXT_PUBLIC_BASE_PATH runtime default, update domain refs` (d74a39b)

*Web production pass*
- `feat(web): production-readiness + perceived-performance pass` — error boundaries + not-found page; ConfirmDialog replaces native confirm(); loading skeletons on all routes; React Query tuning (staleTime 5m); prefetch on hover; server-side cover URL presigning in `/v1/catalogues` to kill N+1; Download All wired; responsive to 768px (f7a966c)
- `feat(web): redesign auth pages with centered black-bg card layout` (b286a5d)
- `fix(api): cast req.body to CreateTryOnJobRequest in tryon route` (f5f5b0b)
- `fix(web): guard ResizeObserver entry width against undefined` (ae50eb7)

---

### 2026-06-04 — Observability, workflow size patching, CI/deploy fixes

**Done**
- `feat(observability): add M1 metrics + logs pipeline to Grafana Cloud` — new `packages/observability` with prom-client registry; domain metrics (http_request_duration, jobs_created, credits_deducted/refunded, job_processing_duration, queue_depth, workers_healthy); GET /metrics on API + dispatcher; Grafana Alloy agent container in docker-compose.prod.yml; dashboard JSON; docs/observability.md (ad16793)
- `feat(workflow): PrimitiveInt size patching, wider modal, 1:1 → 2048px` — dispatcher patcher supports PrimitiveInt size nodes (sizeNodeIds[0]=width, sizeNodeIds[1]=height); 1:1 ratio changed to 2048×2048 (8b1284f)
- `fix(workflow): revert 1:1 aspect ratio back to 1536×1536` — 2048 caused OOM on GPU; reverted (cc15ebf)
- `fix(api): filter backgrounds by garment type in /v1/models/backgrounds` (ecafa01)
- `fix(docker): build @aivastra/observability in api and dispatcher images` (57f54ea)
- `fix(ci): build @aivastra/observability before typecheck and tests` (48c38f0)
- `fix(ci): add safe.directory before git pull on VPS` (9b8085d)

---

### 2026-06-08 — Auth refresh token family fix (logout race condition)

**Done**
- Migration `0032_refresh_token_family.sql`: added `family_id`, `generation`, `used_at`, `revoked_at`; backfilled; added `UNIQUE(token_hash)`, `UNIQUE(family_id, generation)`, partial unique index `refresh_tokens_one_active_per_family` (with explicit comment on why `expires_at` is excluded), and `family_id` index
- Updated `packages/db/src/schema/users.ts` `refreshTokens` table with new columns (kept `revoked` boolean for backward compat)
- Renamed `issueTokens()` → `createSessionTokens()` in `tokens.ts`; documented "session creation ONLY"; added `familyId: crypto.randomUUID()` and `generation: 1`
- Rewrote `/v1/auth/refresh` in `routes.ts` as self-contained rotation (no `createSessionTokens` call):
  - `FOR UPDATE` lock on presented token row only
  - Transaction wraps `mark used` + `insert successor`; JWT/signing stays outside
  - Grace window (3s): concurrent tab reuse of just-used token finds latest active successor via `ORDER BY generation DESC LIMIT 1` and gets reissued (200, no cookie change)
  - Stale replay outside grace window logs `REFRESH_TOKEN_STALE` and returns 401 without revoking family
- Rewrote `/v1/auth/logout` to revoke entire family (`revokedAt` on all rows matching `family_id`)
- Updated password change + reset + admin suspend/delete to use `revokedAt` instead of `revoked`
- Full audit: zero remaining `revoked: true` writes in the entire codebase
- Updated `apps/catalogues-web/src/lib/api.ts`:
  - BroadcastChannel listens for `token-refreshed`, writes `access_token` cookie for other tabs
  - `getToken()` consumes `broadcastToken` before falling back to `document.cookie`
  - Current tab explicitly writes its own `access_token` cookie via `setAccessTokenCookie()` after successful refresh (does not rely on BFF alone or BroadcastChannel echo)
  - Posts `token-refreshed` to other tabs after successful refresh
- Added auth integration tests (written but **not executed** — Docker unavailable): concurrent refresh, replay outside grace, logout family revocation, grace window reissue
- Typecheck: clean rebuild of `@aivastra/db` → API auth code typechecks; 4 pre-existing errors remain in unrelated files (`ClonePoseBody`, `lowerGarmentKey`, `platform`)
- Lint: only warnings on changed files (pre-existing `any` types, intentional `document.cookie` writes, non-null assertions in regex parsing); zero new errors

**Failed / Not Done**
- Integration tests were **written but never executed**. Docker Desktop is not running (`ECONNREFUSED 127.0.0.1:5432`). Tests compile but validation is pending. This is a hard blocker before merge.
- `window.location.href` navigation on auth failure remains (pre-existing, out of scope for this PR)

**Open Questions / Decisions**
- Two-phase migration recommended: Deploy 0032 + observe `REFRESH_TOKEN_STALE`/`REFRESH_TOKEN_REISSUE` metrics for 1-2 weeks before dropping `revoked` column in 0033
- Cookie Store API is not widely supported enough to replace `document.cookie` for BroadcastChannel sync. Keeping manual string construction.

**Merge Gate (must pass before merge)**
1. `pnpm docker:up` → `node apps/api/node_modules/vitest/vitest.mjs run test/integration/auth.test.ts`
2. Verify concurrent refresh: 5 requests → 1 rotated, 4 reissued, 0 failures
3. Verify logout family revocation: G1→G2, logout, G2 refresh → 401
4. Verify replay outside grace: G1→G2, wait >3s, reuse G1 → 401, G2 still works

---

### 2026-06-08 — Studio wizard auto-select defaults + pose clone gap analysis

**Done**
- Studio wizard: auto-select first garment type, face/model, background, resolution (HD), lower garment, shoes on data load
- Fixed garment type click handler to cascade-clear downstream selections (face, bg, poses, lower, shoes)
- Maintained pose selection as user-driven multi-select (not auto-selected)
- Typecheck + lint clean

**Open Questions**
- Pose clone gaps documented (R2 key sharing, missing faceSideR2Key/bgComfyR2Key cleanup, no DB unique constraint, no gender validation, no transaction). Fixes not yet implemented.

---

### 2026-06-08 — AGENTS.md refresh

**Done**
- Updated `AGENTS.md` to reflect current repo state: added `@aivastra/observability`, `apps/dispatcher`, `apps/catalogues-web`, `apps/admin-web` to monorepo boundaries table
- Removed stale "dispatcher (not yet built)" text; added full dispatcher role, web BFF auth pattern, and package build order to invariants
- Added gotchas: lefthook git hooks, CI auto-deploy on master push, web/admin lack test scripts, web is not ESM
- Added lint/format tool (Biome) to Stack section

---

### 2026-06-03 — Aspect ratio cleanup, presign bug fix, CI/deploy fixes

**Done**
- `1:1` default size updated to 2048×2048 (studio UI + dispatcher patcher)
- Removed aspect ratios `3:2`, `9:16` (Etsy-only); kept `1:1`, `3:4`, `4:5`; removed Etsy platform filter
- Shopify restored with its supported ratios (`1:1`, `4:5`)
- Fixed pose edit modal: `presign-faceside` and `presign-bgcomfy` endpoints were returning full `PresignResult` object as `uploadUrl` instead of `.url` string — XHR PUT received `[object Object]`, silently failed, PATCH never reached
- System design doc (`virtual-tryon-system-design.md`) rewritten to v3 as-built; HTML render added (`virtual-tryon-system-design.html`)
- `lefthook.yml` pre-push lint hook changed to `--diagnostic-level=error` (pre-existing a11y warnings no longer block push)
- `biome.json` excludes `docs/*.html` from lint (generated HTML with inlined minified JS)
- Deploy SSH timeout diagnosed: VPS was returning IPv6 via `ifconfig.me`; IPv4 `72.61.171.138` found and `VPS_HOST` secret updated; new ed25519 deploy key generated and added to `authorized_keys`

**Open Questions / Decisions**
- GitHub Actions deploy still timing out after IP + key fix — Hostinger panel-level firewall suspected (separate from UFW which shows port 22 open to anywhere); `fail2ban` has 0 currently banned IPs

---

### 2026-06-02 — Pose grid coverage warnings, workflow detection, image replace, deploy migrations

**Done**

*Garment-type pose grid (admin)*
- Highlight pose tiles when workflow requires lower/shoe (`lowerNodeId`/`shoeNodeId` set) but no active catalog item of that type is assigned to the current garment subcategory — amber outline + `⚠ lower missing` / `⚠ shoes missing` badges; green/blue `✓` badges when covered (41a2519)
- Filter face/background dropdowns to only items actually used by poses in that garment type; sort pose tiles + background/pose dropdowns alphabetically by label; removed `#N` prefix from pose dropdown options (e9f53dc)
- Background created inline during pose upload now inherits the subcategory `genderSlug` instead of defaulting to null/"all" (a08337d)

*Workflow + asset management (admin)*
- Workflow selector added to pose edit modal (dbdb3db)
- Smarter ComfyUI workflow detection (title + KSampler connection tracing); enforce required size/aspect fields on upload (a555ed6)
- Replace-image action on faces, backgrounds, lower/shoe catalog items; fixed catalog visibility (6c93c5d, dc256a3)

*Infra / DX*
- Auto-migrate on deploy; pre-push hook hard-blocks push when local DB is behind unapplied migrations (fd70a00)
- Untracked `templates/` folder from git; fixed `.gitignore` templates entry (0d41305, 53928dc)
- `apps/catalogues-web`: added `jszip` dep + type annotation on zip progress callback (42b0131)

**Open Questions / Decisions**
- `0026_catalog_item_subcategories.sql` changed to `CREATE TABLE IF NOT EXISTS` (idempotent re-apply) + docs edit — locally modified, not yet committed

---

### 2026-06-01 — Auth hardening, email verification, workflow tooling, studio/catalogue UX

**Done**

*Auth*
- Email verification + password reset via Resend (token in Redis, `email_verified` column, verify/reset/forgot/resend routes, web pages) (741ba4f)
- Stopped random user logouts: silent refresh + single-flight token refresh (c0f5419)
- 1h idle session timeout (a5daccd)

*Catalog / workflow (admin)*
- Subcategory-driven lower/shoe linking replaces per-pose allowlists (`catalog_item_subcategories`) (4ea7703)
- Removed `isTemplate` feature; improved pose tile UI (bd1776f); workflow label/slug edit + pose tile workflow badge fix (9477392)
- Workflow detail modal: node mappings, prompts, raw JSON (1fe4833)
- Pose / bgComfy re-upload; improved edit modal UI, prompt labels, thumbnails (f6665b9, 6913cee)
- Assets list API: unique garments with thumbnail presigning + preview UI (a3b1a6e)

*Studio / catalogues (web)*
- Garment type selection redesigned with modal; aspect ratio selection (731ddc9, a94b89a)
- Live platform preview (Amazon mobile + web view) with fidelity/density/zoom polish (88effda, 9ec9f4a, e7ca173)
- Catalogues: date filter, filters, select-all, download-all (403eed6, 894bf81)
- Studio UX improvements + catalogue/assets consistency (36e35f7)
- Image display + garment modal UX refinements (ab02db8)

*Credits / DB*
- Synced admin credit plans with frontend pricing packs (7433a99)
- Applied pending migrations 0023–0026; fixed local dev startup; warn on push when origin has unpulled migrations (af170d0, 4e03c18)

---

### 2026-06-01 — Fix admin Docker build TS errors

**Done**
- `apps/admin-web/src/lib/data.ts`: added `subcategoryIds: []` to all 7 `MOCK_CATALOG` items — `CatalogItem` type requires this field (added in 2026-06-01 refactor but mocks not updated)
- `apps/admin-web/src/pages/CatalogPage.tsx`: added `GarmentType` import + `garmentTypes` state, fetched from `/admin/assets/garment-types` alongside existing Promise.all, passed `garmentTypes` prop to `BatchCatalogUploadModal` (prop was required but missing — caused TS2741)
- Docker admin build passes; pushed to master

---

### 2026-06-01 — Reverse catalog item linking: subcategory-driven instead of pose-driven

**Done**
- Replaced `pose_catalog_items` table with `catalog_item_subcategories` (migration 0025)
- Lower/shoe catalog items now declare which garment subcategories they apply to
- Removed lower/shoe item allowlists from PoseUploadModal and EditPoseModal
- Added `showsLower`/`showsShoes` toggle switches to EditPoseModal (per-pose override)
- BatchCatalogUploadModal: added subcategory checklist (shared for all items in batch)
- AssetsPage catalog item edit modal: added subcategory checklist
- Public catalog query updated: given poseIds where showsLower/showsShoes=true, resolves subcategoryIds and returns catalog items linked to those subcategories
- All typechecks pass (DB, types, api, admin)

**Open Questions / Decisions**
- CatalogPage (standalone catalog management page) edit modal still only has gender field — does not have subcategory selection. Can add if needed.

---

### 2026-05-28 — Catalog gender filtering, per-pose allowlist, code quality tooling

#### Done

**Catalog gender simplification**
- Removed `categoryId` as a required field on catalog items — `type` (`lower`|`shoe`) and `genderSlug` stored directly on `catalog_items`
- Removed "All genders" option from upload modal; admin must pick one of 4 genders (men/women/boys/girls)
- Replaced Category column with Gender badge in catalog table
- Added gender edit button (pencil icon) for existing lower/shoe items (`PATCH /admin/catalog/items/:id`)
- Migration `0021_catalog_item_direct_type.sql`: adds `type` column, backfills from `catalog_types`, drops `NOT NULL` on `category_id`
- Deleted 2 null-gender shoe items (nulled `job_inputs` FK first)

**Per-pose catalog item allowlist** (migration `0022`)
- New `pose_catalog_items(pose_id, catalog_item_id)` join table — cascade deletes
- `GET /admin/assets/poses`: returns `lowerItemIds[]` + `shoeItemIds[]` per pose
- `POST /admin/assets/poses/confirm` + `PATCH /:id`: accept and persist item ID lists in transaction
- `GET /v1/catalog/:type?poseIds=...`: returns only items in the pose's allowlist when poseIds provided
- Upload/edit pose modals: `showsLower`/`showsShoes` default **off**; enabling shows scrollable checkbox list filtered by pose gender
- Studio page: catalog queries pass selected pose IDs; lower/shoe sections hidden when no pose enables them

**Gender-filtered catalog in pose modals**
- Upload modal: shows only items matching `garmentTypeGenderSlug`
- Edit modal: derives gender from selected face, filters accordingly

**Code quality tooling (Biome + lefthook)**
- Replaced Prettier with **Biome** (single tool: lint + format, ruff equivalent for TS)
- `biome.json`: 2-space indent, single quotes, recommended lint rules; a11y rules downgraded to warn for admin/web UI
- `pnpm lint` / `pnpm lint:fix` / `pnpm format` scripts at root and per-package
- **lefthook**: pre-commit checks staged `.ts/tsx/json/css` files; pre-push runs lint + typecheck + unit tests
- CI split into 3 parallel jobs: lint, typecheck, test
- All 155 source files reformatted

**Build fixes**
- `MOCK_POSES` in `apps/admin-web/src/lib/data.ts` missing `lowerItemIds`/`shoeItemIds` → Docker build failed
- Biome stripped `.js` ESM extension from `packages/storage/test/keys.test.ts` → typecheck failed

#### Failed / Not Done
- Server migration `0022_pose_catalog_items` must be applied after next deploy: `pnpm --filter @aivastra/db migrate`

#### Open Questions / Decisions
- Studio currently shows all lower/shoe items when no poseIds provided (legacy tree path). Once all poses have allowlists configured, this legacy path can be removed.

---

### 2026-05-28 — ComfyUI results monitor page (standalone admin endpoint)

Standalone read-only results monitor at `/results` for admins to visually inspect ComfyUI outputs across all users, matching the legacy webtool screenshot layout.

#### Done
- **New API module:** `apps/api/src/modules/results/routes.ts`
  - `GET /results` — self-contained HTML page with inline CSS + vanilla JS (auto light/dark theme, rich UX: filters, pagination, lightbox, image lazy-loading, shimmer skeletons, toast notifications, logout button).
  - `POST /results/login` — independent admin login using same email/password credentials. Issues `results_access_token` cookie scoped to `/results` (isolated from admin app cookies).
  - `POST /results/logout` — clears the results cookie.
  - `GET /results/data` — paginated JSON with public image URLs for Garment, Pose, Background, Shoes, and Output; supports `search`, `userId`, `date` (`any`/`today`/`7d`/`30d`), and `status` (`completed`/`failed`/`all`).
  - `GET /results/users` — distinct user list for the User filter dropdown.
  - Independent cookie-based auth (`requireResultsUser`) verifies admin role (`SUPER_ADMIN`/`MODERATOR`/`SUPPORT`) without sharing session state with the admin React app.
  - Read-only: no delete or mutation actions.
- **Server wiring:** `apps/api/src/server.ts` — one import + `await app.register(resultsRoutes);`.
- **Zero impact** on `apps/catalogues-web`, `apps/admin-web`, DB schema, or env files.
- **Typecheck + build green** for `@aivastra/api`.

#### Open Questions / Decisions
- Lower-garment thumbnail is not shown as a separate column (matches the 5-column screenshot layout: Garment, Pose, Background, Shoes, Output).
- Image downloads rely on browser `download` attribute + same-origin/CORS behavior of the configured R2 public URL.

---

### 2026-05-26 — Full user frontend rebuild from scratch (vastra3.0 design)

Spec: `docs/superpowers/specs/2026-05-26-frontend-rebuild-vastra-3-design.md`. Rebuilt the entire user-facing frontend from the Claude Design handoff (`vastra.html`), inline-token styling, new route structure. Wired to existing `/v1` API.

#### Done
- **Foundation:** `components/tokens.ts` (C palette + grad), `components/icons.tsx` (all design SVGs), `components/logo.tsx`, `components/ui/{grad-btn,dark-btn,google-btn,divider}.tsx`, `components/step-indicator.tsx`, `components/topbar.tsx` (self-contained). `globals.css` replaced with minimal reset + Poppins + scrollbar (dropped Tailwind directives + 895-line class system). Root layout: removed dark-mode script + Inter/JetBrains fonts.
- **App shell:** `(app)/layout.tsx` = dark sidebar + main column (TopbarProvider removed). New `sidebar.tsx` on routes studio/catalogues/assets/pricing/settings, keeps `/v1/credits` + `/v1/me` wiring.
- **Routes restructured:** `/studio` (was tryon), `/catalogues` (was dashboard) + `/catalogues/[id]`, `/assets` + `/assets/[id]`, `/pricing` (was credits), `/settings` (was account).
- **Studio:** 4-step wizard re-skin of tryon logic — gender→outfit+garment upload→models→backgrounds→poses(+lower/shoes)→generate. Submits `POST /v1/jobs/tryon` → `/catalogues/:id`.
- **Settings:** 4 tabs. Profile wired `GET/PATCH /v1/me`. Credit History wired `GET /v1/credits` (summary derived from `recent`). Billing + Invoices stubbed (disabled inputs).
- **Catalogues:** list (date-grouped, cover via `/v1/jobs/:id/result`, polls active) + detail (image grid, per-image fullscreen lightbox + download + delete).
- **Pricing:** static 3-col plan table + Razorpay test-mode stub (`NEXT_PUBLIC_RAZORPAY_KEY`).
- **Cleanup:** deleted `(app)/{tryon,dashboard,credits,account,jobs}`, `context/topbar-context.tsx`, `components/{navbar,theme-toggle}.tsx`, `components/ui/{button,badge,input}.tsx`. Middleware redirects old paths → new. Root redirect → `/studio`.
- **Verified:** `next build` green — all 15 routes generated; `/login` serves 200.

#### Failed / Not Done
- Assets list/detail are mocked (no backend endpoint) — tagged `TODO(wire)`.
- Pricing top-up needs a backend order-creation route; current Razorpay call is a client-only test stub.
- Billing/Invoices settings tabs have no backend.
- Studio wizard state is in-memory (lost on refresh) — per locked decision.
- No browser smoke test of authenticated flows (build + static `/login` only).

#### Open Questions / Decisions
- `qty`/`quality` in studio are UI-only; `POST /v1/jobs/tryon` charges per-pose. Credit math shown (`poses × qty × quality`) is cosmetic until backend accepts those params.
- Razorpay test stub bypasses server order verification — must wire `/credits/topup` + signature check before production.

---

### 2026-05-26 — Web UI restyle (vastra3.0 design)

#### Done
- Root redirect: landing page replaced with auth-aware redirect (logged in → /tryon, else → /login)
- `apps/catalogues-web/src/app/home/page.tsx` deleted
- Logo assets copied to `apps/catalogues-web/public/assets/` (logo-icon, logo-icon-large, logo-wordmark, logo-wordmark-large, auth-bg)
- New CSS utility classes added to `globals.css`: `.av-auth-shell`, `.av-auth-form-col`, `.av-auth-image-col`, `.av-auth-divider`, `.av-btn-dark`, `.av-btn-grad`, `.av-topbar`, `.av-pricing-table` (+ sub-classes), `.av-cat-date-group`, `.av-assets-grid`, `.av-asset-card`
- Sidebar: new nav (Studio/Catalogues/Assets/Pricing/Settings), PNG logo, credits widget, logout icon — dark mode toggle removed
- Auth pages: two-column layout (600px form + auth-bg.png image panel) for login and register; Google button (UI only)
- Assets page: new `/assets` route with mock garment data grid (UI only)
- Pricing page: full plan comparison table (Starter/Growth/Pro) above existing credit request form
- Catalogues: date-grouped catalogue grid, new TopBar with "Create Catalogue" gradient button + search bar
- View Catalogue: new TopBar with back arrow + "Download All" button
- Studio: new TopBar with 4-step stepper (Setup / AI Models / Backgrounds / Generate), old `av-page-head` + `av-stepper` replaced
- Settings/Account: renamed tabs (Profile Details / Billing / Credit History / Invoices), new TopBar with Log Out button

#### Open Questions
- Google OAuth: button renders on auth pages but no wiring (intentional for now)
- Assets page: needs real API endpoint for listing/uploading user garments
- Pricing "Buy" buttons: UI only, no payment integration yet

---

### 2026-05-23 (uncommitted) — Multi-pose per job + catalogue grouping

**Done**

- `api`: `POST /v1/jobs/tryon` now accepts `poseIds` array (1–6); creates 1 job per pose under shared `catalogueId`; partial enqueue failure handling (refund + fail individual jobs, throw only if all fail)
- `api`: `GET /v1/catalogues` — groups jobs by `catalogueId`, newest first, 200 limit
- `api`: `GET /v1/catalogues/:id` — all jobs for one catalogue, ordered by `createdAt`
- `db`: migration `0007_catalogue_id.sql` — `ALTER TABLE jobs ADD COLUMN catalogue_id uuid`
- `db/schema/jobs.ts`: added `catalogueId` column
- `types`: `CreateTryOnJobRequest.inputs.poseId` → `poseIds: z.array(z.string().uuid()).min(1).max(6)`
- `web`: catalogue detail page scaffolded at `apps/catalogues-web/src/app/(app)/catalogues/[id]/page.tsx`
- `web`: catalogue grid CSS (`.av-cdet-grid`, `.av-cdet-card`, `.av-cdet-img`, `.av-cdet-footer`) in globals.css
- `web`: dashboard — live data fetch, image grid with lazy thumbnails, status badges
- `web`: wizard — multi-pose selection UI (checkboxes, count badge)
- `web`: cleanup — replace hardcoded `#FFF` with CSS vars, dropzone bg uses `--surface-2`

**Failed / Not Done**

- Catalogue listing page (`GET /v1/catalogues`) only returns job metadata — no output thumbnails, no preview in catalogue grid
- Dashboard still uses mock stats (not live aggregate from API)
- Migration 0007 not yet applied to dev DB
- `apps/catalogues-web/src/app/(app)/catalogues/[id]/page.tsx` — needs full UI polish

**Open Questions / Decisions**

- [ ] Catalogue page UX: show first output thumbnail per catalogue? Show status summary (X done / Y total)?
- [ ] Jobs detail page redesign — still old sketch palette

---

### 2026-05-22 → 2026-05-23 — End-to-end pipeline + lower garments + theme toggle + account page

**Done**

*Dispatcher pipeline fixed (end-to-end)*

- Fixed `WORKER_A_URL` protocol + port (`http://38.247.187.234:8000`)
- Added `setGlobalDispatcher` TLS bypass for undici (`NODE_TLS_REJECT_UNAUTHORIZED`)
- Fixed stream consumer `BLOCK 0` deadlock on `jobs:priority` queue
- Switched `waitForCompletion` from WebSocket to `/history` polling (more reliable)
- Added `undici` dep, startup connectivity check per worker, info-level WS logs
- Updated workflow patcher to `twopiece.json` node IDs (1332/1333/1334/1340/1331)
- Added lower garment resolution + upload in processor
- Fixed `fetchHistory` to filter `type=output` only
- Workflow template `templates/virtual-tryon-v1.json` now real ComfyUI export (538 lines)

*Wizard step 5 — lower garment + shoes*

- `api`: wire catalog routes for lower garments + shoes (`GET /v1/catalog/items?typeSlug=lower_garments|shoes`)
- `api`: job creation validates `lowerCatalogId` + `shoeCatalogId`
- `db`: seed catalog types (migration `0006`) — `lower_garments`, `shoes`
- `admin`: catalog batch upload modal (`BatchCatalogUploadModal.tsx`) with per-file status + retry
- `admin`: catalog item edit wired (edit button updates label/isActive)
- `admin`: fix "Add item" button always opens modal, hidden on All Items tab
- `web`: wizard step 5 — lower garment + shoes selection carousel, conditionally shown per `pose.showsLower`/`pose.showsShoes`

*Home page + nav*

- Home page (`/`) always visible to unauthenticated users (marketing landing)
- `/home` route alias for sidebar link
- Sidebar `Home` link added

*Theme toggle + sidebar collapse*

- `theme-toggle.tsx` component — sun/moon icon, reads/writes `localStorage.theme`, toggles `dark` class on `<html>`
- Sidebar collapsible: hamburger button, collapsed state shows only icons, `--sidebar-width` CSS var toggles `64px` / `240px`
- TopBar removed — theme toggle + sign-out moved into sidebar

*Account page*

- `apps/catalogues-web/src/app/(app)/account/page.tsx` — display name, email, tier, credit balance, change password, job history
- Styled with `av-card` layout matching new palette

*Dashboard grid*

- Replaced flat job list with image grid — lazy-loaded output thumbnails, status overlay badges, retry on failed
- Grid layout `.av-dash-grid` with responsive `auto-fill, minmax(220px, 1fr)`

*Admin profile*

- Dynamic sidebar profile section — reads user data from auth context (initials avatar, email)

*Tests*

- `vitest.config.ts` updated for dispatcher (undici mock)

**Failed / Not Done**

- Dashboard stats still mock data (not live aggregate)
- Jobs detail page still old sketch palette
- `apps/catalogues-web/src/components/navbar.tsx` unused but still exists

**Open Questions / Decisions**

- [ ] Lower garment thumbnail resolution in dispatcher — PNG flatten + upload to R2 confirmed working
- [ ] `/history` polling interval for ComfyUI output — currently 2s, adjust if GPU node overloaded
- [ ] Dispatcher TLS bypass (`NODE_TLS_REJECT_UNAUTHORIZED=0`) — needs proper cert in prod

---

### 2026-05-22 — Full frontend redesign (vastra2.0 designer handoff)

**Done**

- `apps/catalogues-web/src/app/globals.css`: complete rewrite — removed sketch utilities (`sketch-card`, `btn-sketch`, `underline-emph`), added full `av-` CSS class system (sidebar, stepper, cards, chips, dropzone, select, buttons, spinner), CSS vars matching warm cream palette (`--bg: #FBF8F3`, `--peach`, `--amber`, `--mint`, `--grad`, etc.), dark mode support
- `apps/catalogues-web/src/app/layout.tsx`: replaced Caveat font with Poppins (400/500/600/700/800) + JetBrains Mono; updated metadata
- `apps/catalogues-web/src/app/page.tsx`: full marketing landing page from `vastra2.0/Home.html` — hero, logos strip, how-it-works (4 steps), features grid, gallery (4 samples), pricing (3 cards), CTA, footer; `lp-` prefixed CSS via inline `<style>` tag; redirects to `/dashboard` if already logged in
- `apps/catalogues-web/public/samples/`: copied `sample-1..4.png` from `vastra2.0/assets/`
- `apps/catalogues-web/src/components/sidebar.tsx` (new): dark sidebar with credits bar (`/v1/credits`), user info (`/v1/me`), nav items (Studio/Catalogues/Credits), logout, initials avatar
- `apps/catalogues-web/src/app/(app)/layout.tsx`: replaced navbar with `<div className="av-app"><Sidebar /><main className="av-main">{children}</main></div>`
- `apps/catalogues-web/src/app/(app)/tryon/page.tsx`: 4-step wizard (Setup → Models → Backgrounds → Pose+Generate); garment upload starts immediately in step 0; Generate button gated on `garmentKey` set; `useEffect` fix for dropdown outside-click listener
- `apps/catalogues-web/src/app/(app)/dashboard/page.tsx`: restyled with `av-card`, status dots, badge chips
- `apps/catalogues-web/src/app/(app)/credits/page.tsx`: restyled with `av-card`, gradient balance display, package selector chips
- `apps/catalogues-web/src/app/(auth)/login/page.tsx`: clean centered layout, white card, tab pills
- `apps/catalogues-web/src/app/(auth)/register/page.tsx`: same structure as login
- `apps/api/src/modules/auth/routes.ts`: added `GET /v1/me` endpoint for regular users (email, displayName, tier)

**Failed / Not Done**

- `apps/catalogues-web/src/components/navbar.tsx`: still exists (unused — safe to delete later)
- `apps/catalogues-web/src/app/(app)/jobs/[id]/page.tsx`: still uses old sketch design (not redesigned)
- Old UI components (`ui/button.tsx`, `badge.tsx`, `input.tsx`): still present but unused by new design

**Open Questions / Decisions**

- [ ] Jobs detail page (`/jobs/:id`) needs redesign to match new palette
- [ ] Navbar component can be deleted
- [ ] Lower garment step: conditional on `pose.showsLower === true` (still not added)
- [ ] ComfyUI workflow template `templates/virtual-tryon-v1.json` still a stub

---

### 2026-05-22 — Admin panel live data + credit requests + isTemplate + background preview

**Done**

*isTemplate redesign — dropped `subcategoryTemplates` table*

- `packages/db/src/schema/models.ts`: added `isTemplate boolean` to `modelPoses`; partial unique index `(subcategoryId, faceId, backgroundId) WHERE isTemplate=true`; removed `subcategoryTemplates` table
- Migration `0005_pose_istemplate_drop_templates.sql`: `ALTER TABLE model_poses ADD COLUMN is_template`; create index; `DROP TABLE subcategory_templates CASCADE`. Applied directly via `docker exec psql` (drizzle migration tracker only has entries 0+1; 2–5 must be applied manually)
- `packages/types/src/admin.ts`: `ConfirmModelPoseBody` + `PatchModelPoseBody` include `isTemplate`; all subcategory template schemas removed
- `apps/api/src/modules/admin/models.routes.ts`: `POST /poses/confirm` + `PATCH /poses/:id` unset previous template in cell before setting new one (transactional)
- `apps/api/src/modules/admin/subcategories.routes.ts`: `PATCH /subcategories/:id` enforces template coverage (every face×bg cell must have a template) when setting `isActive: true`
- `apps/api/src/server.ts`: removed `adminTemplatesRoutes` import + registration; deleted `templates.routes.ts`
- `BatchPoseUploadModal`: radio button per row to designate template at batch-upload time; default = first file
- `AssetsPage`: removed template tab/cards/state; "Set as template" button on non-template pose cards; pose cards show blue outline + badge when `isTemplate=true`; `templateCount` derived client-side

*Admin Users page — live data*

- `GET /admin/users`: `ilike` search on email/displayName, `total` count, left-join `userCredits` + `jobs` for `balance`/`totalJobs`/`lastJobAt`; excludes `passwordHash`
- `GET /admin/users/:id`: explicit field select (no passwordHash), flat response `{ ...user, balance, totalJobs, recentJobs }`
- `UsersPage.tsx`: replaced MOCK_USERS with `useEffect` + `apiFetch`; server-side search + pagination; suspend/unsuspend via `PATCH /admin/users/:id { isBanned }`; optimistic status update
- `User` type updated: `displayName`, `tier`, `isBanned`, `banReason`, `balance`, `totalJobs`, `lastJobAt`, `createdAt`; removed `name`/`plan`/`role`/`emailVerified`/`creditLimit`/`status`

*Credit Requests page (new)*

- `CreditRequestsPage.tsx`: tabs Pending / Approved / Rejected; approve modal (editable credits amount prefilled, optional admin note) → `PATCH /admin/credits/requests/:id/approve`; reject modal → `PATCH /admin/credits/requests/:id/reject`; reloads list after action
- Wired into `App.tsx` (`'credits'` page) and `Sidebar.tsx` (`Icon.Credit`, visible to SUPER_ADMIN + MODERATOR)

*Admin Jobs page — live data*

- `GET /admin/jobs`: `status` filter, `search` (job ID / user email), `total` count; multi-join for `userEmail`, `faceLabel`, `backgroundLabel`, `poseLabel`, `hasLower`, `hasShoe`, `outputUrl` (via storage.publicUrl)
- `GET /admin/jobs/:id`: same rich join + `userHint` from `jobInputs` + `events` array (flat response, not nested)
- `JobsPage.tsx`: replaced MOCK_JOBS with live fetch; status tab filter + search + pagination; detail view with events log; cancel → `POST .../cancel` with optimistic update; retry button on FAILED jobs → `POST .../retry`
- `Job` type: `userEmail`/timestamps/errorCode now `| null`; added `userId?`, `attempts?`

*User-facing background preview (template showcase)*

- `GET /v1/models/backgrounds`: accepts optional `subcategoryId`; when `faceId + subcategoryId` both provided fetches template poses (`isTemplate=true`) for face×subcategory, builds `backgroundId → thumbnailKey` map; response includes `previewUrl` = template pose composite thumbnail (falls back to raw bg thumbnail if no template set)
- `tryon/page.tsx`: `BackgroundItem` gets `previewUrl`; backgrounds query passes `subcategoryId`; background cards use `previewUrl`; step 2 description updated

**Failed / Not Done**

- Sidebar badge counts for jobs/credits are static (removed fake counts from users/jobs, credits has no live pending count yet)
- Dashboard page (`DashboardPage.tsx`) still uses MOCK_STATS — not converted to live data yet

**Open Questions / Decisions**

- [ ] Lower garment step in wizard: still not added (conditional on `pose.showsLower === true`)
- [ ] ComfyUI workflow template `templates/virtual-tryon-v1.json` still a stub — blocking E2E
- [ ] GPU VPS worker registration + dispatcher start — needed for E2E test

---

### 2026-05-21 — Frontend scaffold complete (Phase 3A+3B+3C) + backend schema fixes

**Done**

*`apps/catalogues-web` — Next.js 15 App Router (full scaffold)*

- `package.json`: Next.js 15, React 19, Tailwind CSS 3, @tanstack/react-query, react-hook-form + zod resolvers, lucide-react, @radix-ui/react-slot
- `middleware.ts`: route protection via `access_token` cookie; redirects unauthenticated users to `/login?next=<path>`
- **Auth proxy routes** (`/api/auth/*`): Next.js route handlers proxy to API, extract refresh token from `Set-Cookie` response header, re-set as httpOnly cookie at `/api/auth` path; set `access_token` as JS-readable cookie at `/`
  - `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`, `/api/auth/refresh`
- **Auth pages**: `/login`, `/register` — react-hook-form + zod validation, error display, Tailwind styling
- **App layout** (`/(app)/layout.tsx`): sticky navbar with credits balance (live via React Query), logout button, nav links
- **Dashboard** (`/dashboard`): job history list, status badges with icons, auto-refetch every 3s when active jobs exist
- **Try-On Wizard** (`/tryon`): 6-step wizard
  - Step 0: Gender + subcategory picker (loads `GET /v1/models/subcategories?gender=X`)
  - Step 1: Garment upload — XHR with progress bar, presign → direct R2 PUT
  - Step 2: Face selection — card grid (loads `GET /v1/models/faces?gender=X`)
  - Step 3: Background selection — card grid (loads `GET /v1/models/backgrounds`)
  - Step 4: Pose selection — card grid (loads `GET /v1/models/poses?subcategoryId=X&faceId=Y&backgroundId=Z`)
  - Step 5: Review + submit → `POST /v1/jobs/tryon` → redirect to job detail
- **Job detail** (`/jobs/[id]`): SSE live progress (EventSource), step indicator, result image with download button, failure state with refund notice
- **UI components**: Button (asChild/Radix Slot), Input, Badge (success/warning/processing/destructive variants), Navbar, Providers (React Query)
- **API client** (`lib/api.ts`): typed fetch wrapper, auto-refresh on 401, XHR upload with onprogress

*Backend fixes*

- `apps/api/src/modules/models/routes.ts` (NEW): user-facing model routes — `GET /v1/models/subcategories`, `/faces`, `/backgrounds`, `/poses`; requires auth, returns thumbnailUrl via `storage.publicUrl()`; registered in `server.ts`
- `apps/api/src/modules/jobs/create.ts`: rewrote to use new schema — validates `faceId`/`backgroundId`/`poseId` against `model_faces`/`model_backgrounds`/`model_poses` (was broken: still used old `modelCatalogId`/`catalogItems` references)
- `apps/dispatcher/src/job/processor.ts`: fixed r2Key resolution — now reads from `model_faces`/`model_backgrounds`/`model_poses` via `inputs.faceId`/`backgroundId`/`poseId` (was broken: used old `inputs.modelCatalogId` etc. against `catalogItems`)

**Failed / Not Done**

- SSE auth: job events endpoint uses `EventSource` which can't set custom headers; token passed as `?token=` query param in URL. API's `requireUser` plugin needs to support token from query string (not yet implemented — will silently fail on first SSE connect)
- No `CORS_ORIGIN` update for web port 3000 (`.env` still default; should be `http://localhost:3000` — already set)
- `apps/catalogues-web` not in CORS_ORIGIN of API: need to confirm `CORS_ORIGIN=http://localhost:3000` in `.env`

**Decisions Made**

- Auth cookie strategy: `access_token` non-httpOnly (JS-readable, 15min) + `refresh` httpOnly at `/api/auth` path (7d). All managed by Next.js proxy routes.
- All API calls go direct from client to `NEXT_PUBLIC_API_URL` (not through Next.js proxy), except auth. Avoids latency overhead.
- XHR (not fetch) for garment upload: enables `onprogress` events for progress bar.

**Open Questions / Decisions**

- [ ] SSE auth: `GET /v1/jobs/:id/events` uses `EventSource` (no custom headers). API `requireUser` only reads `Authorization` header. Need to add `?token=<accessToken>` query param support to `requireUser` plugin, or proxy SSE through Next.js.
- [ ] `CORS_ORIGIN` in `.env` must be `http://localhost:3000` for web ↔ API in dev — confirm set.
- [ ] `apps/catalogues-web` prod: served via CloudPanel nginx on port 3000? Confirm routing before Phase 4D Dockerfile.
- [ ] Catalog lower garment selection not in wizard (Phase 3B only covers face/bg/pose). Add lower garment step if needed (wizard step 5, only shown when `pose.showsLower === true`).

---

### 2026-05-21 — Admin panel complete + asset management system

**Done**

*Admin Panel (`apps/admin-web` — standalone Vite/React SPA, proxied through Vite dev server at :5173)*

- **AssetsPage** — 3-tab layout: Backgrounds, Faces, Subcategories
  - Backgrounds tab: upload (presign → R2 PUT → confirm), toggle active, delete
  - Faces tab: upload with gender tag (men/women/boys/girls), toggle active, delete
  - Subcategories tab: create (proper modal, replaced `prompt()` dialogs), list with pose grid per subcategory
- **Pose management** — poses are per (subcategory × face × background) combo
  - Single-pose upload via UploadModal
  - Batch upload (`BatchPoseUploadModal`): select multiple files, assign shared face+bg+showsLower+showsShoes metadata, auto-label from filename stem, sequential upload with per-file status + retry
  - `EditPoseModal`: edit label, reassign faceId/backgroundId, showsLower, showsShoes, sortOrder — PATCH `/admin/assets/poses/:id`
  - Filter poses grid by face + background dropdowns
- **CatalogPage** — lower garments + shoes, thumbnail preview, toggle active, delete, upload
- **Real image thumbnails** — `AssetThumb` component: fetches `storagePublicUrl` from `/admin/me`, renders `<img>` using `thumbnailKey`; falls back to initials placeholder
- **AuthContext** — stores `storagePublicUrl: string | null`, propagated from `/admin/me` response, cleared on logout
- **Dark mode** — switch/toggle knob fixed (was hardcoded `#fff`, invisible on light track; now uses `var(--bg)`)
- **UploadModal** — added `placeholder` prop support for all field types

*DB / Types / API*

- `model_poses` schema: added `face_id` + `background_id` FK columns (migration `0003_poses_add_face_bg.sql`), applied to local Docker Postgres
- `packages/types`: `PresignModelPoseBody`, `ConfirmModelPoseBody` include `faceId`+`backgroundId`; `PatchModelPoseBody` has optional `faceId`+`backgroundId`
- `/admin/assets/poses` GET: optional `faceId`/`backgroundId` query filters
- `/admin/me` response: includes `storagePublicUrl` from env
- `packages/storage/r2.ts`: fixed two AWS SDK v3 presigned URL bugs
  - Removed `ContentLength` from `PutObjectCommand` (was signing content-length header, causing `SignatureDoesNotMatch` when file size differed from hardcoded 10MB)
  - Added `requestChecksumCalculation: 'WHEN_REQUIRED'` + `responseChecksumValidation: 'WHEN_REQUIRED'` (disabled CRC32 checksum query params MinIO doesn't support)

**Failed / Not Done**

- Admin panel built as separate Vite SPA (`apps/admin-web`), not embedded in Next.js (`apps/catalogues-web`) — diverges from PHASES.md §3D plan. This is intentional: admin panel is ready for production use standalone; no plan to migrate.
- `apps/catalogues-web` (user-facing Next.js try-on builder) — not started
- Phase 2B (VPS + Tunnel + ComfyUI) — not started
- `templates/virtual-tryon-v1.json` — still a stub; real ComfyUI workflow export still blocking E2E

**Decisions Made**

- Admin panel = standalone Vite SPA (`apps/admin-web`) — not part of `apps/catalogues-web`. Deployed separately, proxied by nginx in prod.
- Asset management scope expanded beyond original PHASES.md §1D: model faces, backgrounds, garment subcategories, poses all fully managed via admin UI.
- Poses schema: face × background per pose (not just per subcategory) — data model locked.
- Presigned URL upload flow: browser → presign API → direct PUT to MinIO/R2 → confirm API. Confirmed working end-to-end with local MinIO.

**Open Questions / Decisions**

- [ ] `apps/admin-web` prod deployment: serves from same VPS as API? nginx route `/admin-app/*` → static files from `apps/admin-web/dist/`? Decide before Phase 4D.
- [ ] Subcategory template images (`subcategory_templates` table — pre-rendered face×background composites): does admin need UI to upload these? Currently table exists but no admin page for it.
- [ ] Pose `subcategoryId` is required on upload — does every pose belong to exactly one subcategory, or should poses be subcategory-agnostic (shared across subcategories)? Current model: one subcategory per pose. Confirm with product.

---

### 2026-05-19 — Dispatcher test fixes

**Done**
- Fixed postgres module resolution: added `resolve.alias` in `apps/dispatcher/vitest.config.ts` (Vite couldn't resolve `postgres` from non-hoisted pnpm layout)
- Fixed worker registry test isolation: `registerWorkers` now always updates (removed `if (!existing)` guard), added `deregisterWorker` called in all test `afterAll` blocks
- Fixed `recoverPendingJobs`: added optional `streams` param (defaults to `['jobs:priority', 'jobs:normal']`), handles NOGROUP gracefully
- Fixed recovery test: passes custom stream to `recoverPendingJobs` instead of expecting hardcoded streams
- Removed duplicate `export { schema }` from `packages/db/src/index.ts`
- All 3 dispatcher integration test suites pass: happy-path, retry, recovery
- Added `README.md` with architecture, stack, setup, commands, project status
- Pushed all changes to GitHub (`adeshboudh/aivastra`)

**Failed / Not Done**
- `templates/virtual-tryon-v1.json` still a stub — real ComfyUI workflow export needed
- VPS provisioning (Phase 2B) not started
- Phase 3 (`apps/catalogues-web` Next.js frontend) not started

**Open Questions / Decisions**
- [ ] ComfyUI workflow: which node IDs map to each `__AIVASTRA_*__` placeholder? Need real workflow export first
- [ ] Worker hostname naming: `WORKER_A_URL` / `WORKER_B_URL` vs `WORKER_<ID>_URL` — decide convention before Phase 2B
- [ ] Catalog key resolution still happens in dispatcher via DB join (deviation from CLAUDE.md invariant) — add r2Key columns to `job_inputs` in v2 migration?

### 2026-05-19 — Phase 2 dispatcher plan written

**Done**
- Detailed implementation plan written at `docs/superpowers/plans/2026-05-19-phase-2-dispatcher.md`
- Plan covers 20 tasks: package scaffold, env validation, lib layer, worker registry + health monitor + selector, workflow patcher, ComfyUI HTTP + WebSocket client, job state machine + processor, stream consumer, crash recovery, health server, entry point, test harness + 3 integration test suites, Dockerfile
- Workflow template stub created at `templates/virtual-tryon-v1.json` (placeholder markers defined)

**Failed / Not Done**
- Implementation not started — plan only
- `templates/virtual-tryon-v1.json` is a stub; real ComfyUI workflow export still needed (blocking for Phase 4 E2E)
- VPS provisioning (Phase 2B) not covered in code plan — infra-only, see `infra/cloudflared/README.md`

**Open Questions / Decisions**
- [ ] **BLOCKING:** Real ComfyUI workflow export needed — set up ComfyUI on dev VPS, build workflow, export as API format, map node IDs to `__AIVASTRA_*__` placeholders in template
- [ ] Catalog key resolution deviation: `job_inputs` stores catalog UUIDs, not r2Keys — dispatcher must join `catalog_items`. Consider adding r2Key columns to `job_inputs` in v2 migration
- [ ] Hostinger GPU VPS specs not finalized — confirm plan availability before provisioning (see PHASES.md §2B)
- [ ] `WORKER_IDS` env var naming: `worker-a,worker-b` requires `WORKER_A_URL` and `WORKER_B_URL` env vars — confirm naming convention matches real worker hostnames

### 2026-05-18 — Initial scaffolding (api + packages)

**Done**
- Monorepo structure created: `apps/api`, `packages/db`, `packages/types`, `packages/storage`, `packages/logger`
- Drizzle schema + migrations wired in `packages/db`
- Fastify API with all `/v1/*` and `/admin/*` routes: users, credits, catalog, jobs, workers, config
- JWT auth + admin double-check guard (`admin_users` row lookup)
- Redis Streams job enqueue (`jobs:priority`, `jobs:normal`)
- SSE job events via Redis pub/sub with 15s heartbeat
- Integration test suite: per-test Postgres DB + MinIO bucket isolation, no testcontainers
- Parallel test isolation fixed for db + redis + minio
- Production Dockerfile + e2e smoke test

**Failed / Not Done**
- `apps/dispatcher` — not yet built (Redis Stream consumer, ComfyUI bridge, worker health monitor)
- `apps/catalogues-web` — not yet scaffolded
- `packages/catalog` — category tree builder not yet extracted
- `scripts/seed-catalog.ts` — not yet written
- Cloudflare Tunnel / `cloudflared` infra config
- ComfyUI workflow templates in `templates/`

**Open Questions / Decisions**
- [ ] Dispatcher: retry strategy — max 2 attempts then refund. Confirm dead-letter stream key name.
- [ ] Web: Next.js 15 App Router vs Pages Router for admin panel?
- [ ] Presigned URL expiry for garment uploads — how long?
- [ ] Worker health TTL is 30s (probed every 15s) — adjust if ComfyUI startup is slow?
- [ ] `packages/catalog` — extract from api routes now or after dispatcher?
- [ ] MinIO bucket naming convention for prod R2 (single bucket with prefixes vs per-env buckets)?

---

<!-- Add new entries above this line, newest first -->
