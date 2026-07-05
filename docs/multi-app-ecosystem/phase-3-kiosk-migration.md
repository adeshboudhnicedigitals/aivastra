# Phase 3 — Kiosk Android Migration

> Part of the [Multi-App Ecosystem Plan](../multi-app-ecosystem-plan.md) (`docs/multi-app-ecosystem-plan.md`, §8). This document is self-contained — implement from this file directly.

**Depends on:** Phase 0 (kiosk auth), Phase 2 (a private catalog to pick garments from). **Blocks:** nothing. **User-facing surface:** the Android kiosk app's login screen changes shape; every other screen is visually identical to before.

## Why

`apps/virtual-tryon-mobile&kiosk` is a native Android (Kotlin) kiosk-tablet app currently wired to a completely different, legacy PHP backend. This phase rewrites only its networking layer to talk to this monorepo's `apps/api`, while explicitly preserving every screen and interaction the app already has, with one unavoidable exception (login → pairing, since the old username/password flow can't satisfy the new server-validated device-pairing model).

**Read `apps/api/src/modules/widget/routes.ts`, `apps/api/src/modules/widget/ledger.ts`, and `apps/dispatcher/src/job/processor.ts` in full before starting.** This phase's central design decision — reusing the existing widget job pipeline rather than building a parallel one — depends on you confirming the same thing already confirmed during planning: read `apps/dispatcher/src/job/processor.ts` and locate the branch that routes a job to `processWidgetJob`. If it is a simple `if (job.widgetClientId)` check on the database row (not a queue-message type tag), the plan below holds and **no dispatcher code changes are needed**. If you find it's changed since this plan was written and is no longer a simple column check, stop and flag it in your report before proceeding — the entire "zero dispatcher changes" premise of this phase rests on that fact.

## Repo conventions (load-bearing — read before editing)

- Kotlin/Android app under `apps/virtual-tryon-mobile&kiosk/app/src/main/java/aivastra/nice/interactive/`. Existing package naming still contains a legacy `com.example.facewixlatest` reference in some files (a leftover from an earlier product name) — this is expected, and this phase's rewrite is a reasonable place to rename it as a side effect of touching those files, not a task to skip.
- API side: same conventions as Phases 0/2 — Fastify routes wired in `apps/api/src/server.ts`, Drizzle migrations via `pnpm db:generate`, `createLogger` not `console.log`, credit-deduct-plus-insert stays one transaction.
- Tests: same harness pattern as prior phases (`apps/api/test/helpers/containers.ts`, fresh DB + MinIO bucket per test file, `pnpm docker:up` must be running).
- Commit when this phase is complete and its tests pass. **Do not push.**

## Spec

### The one big simplification

Kiosk try-on jobs are widget jobs with a different auth front door (a paired device instead of a widget key) and a garment resolved from the merchant's private catalog instead of fetched from an external URL. Because dispatcher routing is a plain column check, this means: **zero dispatcher changes.** A consequence worth internalizing before writing routes: kiosk try-on produces a single garment-overlay result, matching the shape of the existing widget workflow template (no lower/shoe compositing nodes exist on that template type). Lower/shoe compositing at a kiosk is out of scope for this phase — it would require a new workflow template type, which is a separate, larger piece of work.

Factor the transaction currently inline in the existing `POST /v1/widget/jobs` handler (`apps/api/src/modules/widget/routes.ts`) into a shared function, e.g. `createWidgetStyleJob(app, {widgetClientId, kioskDeviceId?, upperGarmentKey, customerPhotoKey, cost})`, placed in a new `apps/api/src/modules/widget/create-job.ts`. Both the existing widget route and the new kiosk route call it. The goal is one credit-deduct-plus-insert transaction implementation, not two that can silently drift apart over time.

Kiosk jobs cost the same as widget jobs — find the existing `WIDGET_JOB_COST` constant in `apps/api/src/modules/widget/routes.ts` and reuse it verbatim (same cost, same refund amount on cancel/failure). On insufficient credit balance, reuse the widget flow's existing error code/response shape so the kiosk app can show store staff an actionable message ("top up in the merchant portal") rather than a generic failure. Apply the same rate limit the widget job-creation route already has, keyed per kiosk device instead of per widget client.

### DB

Add to `packages/db/src/schema/kiosk.ts` (the file Phase 0 created, alongside `kioskDevices`):

```ts
export const kioskResultLikes = pgTable('kiosk_result_likes', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  widgetClientId: uuid('widget_client_id').notNull().references(() => widgetClients.id, { onDelete: 'cascade' }),
  kioskDeviceId: uuid('kiosk_device_id').references(() => kioskDevices.id, { onDelete: 'set null' }), // audit only
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: unique('kiosk_result_likes_job_widget_unique').on(t.jobId, t.widgetClientId) }));

export const kioskResultCartItems = pgTable('kiosk_result_cart_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  widgetClientId: uuid('widget_client_id').notNull().references(() => widgetClients.id, { onDelete: 'cascade' }),
  kioskDeviceId: uuid('kiosk_device_id').references(() => kioskDevices.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: unique('kiosk_result_cart_items_job_widget_unique').on(t.jobId, t.widgetClientId) }));
```

These are deliberately scoped by `(jobId, widgetClientId)` rather than per-device — the kiosk authenticates a store operator/device, not an individual shopper account, so a "like" is store-level curation, and dedup at the merchant level is correct. `kioskDeviceId` is a nullable, audit-only column (`onDelete: 'set null'`) so revoking a device never deletes like/cart history.

Also add a nullable `kioskDeviceId` column to the existing **`jobs`** table (`onDelete: 'set null'`), populated by `createWidgetStyleJob` only when called from the kiosk route (null for regular widget jobs). This is audit/ops only — dispatcher routing is untouched — but without it, a merchant running several kiosks has no way to answer "which tablet produced this job" in support or billing queries.

### API

New `apps/api/src/modules/kiosk/catalog.routes.ts`: `GET /v1/kiosk/catalog` (`requireKioskDevice`) — returns the paired merchant's active + approved `merchant_catalog_items` as a flat list; the Android client groups it by `gender`/`category` on-device.

New `apps/api/src/modules/kiosk/jobs.routes.ts` (all `requireKioskDevice`):

| Method + Path | Notes |
|---|---|
| `POST /v1/kiosk/presign` | Mirror `/v1/widget/presign`'s structure; key prefix `kiosk-inputs/{deviceId}/{uuid}/photo.{ext}`. **Record key ownership at presign time** the same way the widget presign does (the Redis `upload:owner:*` binding pattern), with the kiosk device id as owner. |
| `POST /v1/kiosk/jobs` | `{merchantCatalogItemId, customerPhotoKey}` — look up the catalog item, reject if it doesn't belong to `req.merchantClientId`; **verify `customerPhotoKey` was presigned by this device** (the ownership binding above — a key presigned by device A must be rejected when submitted by device B); resolve the item's `r2Key`, call `createWidgetStyleJob`. Do **not** add an `aspectRatio` field unless you first confirm the widget workflow template actually has a size node to patch (check the template's node-mapping columns) — accepting a field the pipeline silently ignores is worse than not having it. |
| `GET /v1/kiosk/jobs/:id` | Include `liked`/`inCart` booleans via a left-join against the two new tables on `widgetClientId`, so the app doesn't need a separate call to know current state. When the job is COMPLETED, also include a `shareUrl`: a presigned GET for the result image (~24 hour TTL, via `StorageProvider.presignGet`). **Do not build a new public/unauthenticated result endpoint for this** — check the existing `apps/api/src/modules/results/*` module first; if (as expected) it's a password-gated internal gallery unrelated to this use case, a plain presigned URL needs no new auth surface at all and is the simpler, correct choice. |
| `DELETE /v1/kiosk/jobs/:id` | Mirror the existing widget job cancel + refund logic |
| `GET /v1/kiosk/jobs/:id/events` | Reuse the exact same `sse:events:widget:{clientId}` Redis channel the dispatcher already publishes progress to — no dispatcher change needed here either |

New `apps/api/src/modules/kiosk/results.routes.ts` (all `requireKioskDevice`): `PUT` and `DELETE /v1/kiosk/results/:jobId/like`, `PUT` and `DELETE /v1/kiosk/results/:jobId/cart`.

**Owner identity (`widgetClientId`) must always come from `req.merchantClientId`** (the value `requireKioskDevice` set server-side from its DB lookup) — **never from any request body field.** Do not add a `userId` or `widgetClientId` field to these route schemas at all; there being no such field is the actual security property, not an enforcement check you have to remember to write.

### Results gallery & deletion — a product decision, made deliberately

The legacy app had server-side result listing and a delete-results endpoint, and the existing UI has gallery-flavored affordances (download-all / delete-all buttons). **Do not rebuild those as server endpoints.** A kiosk is a shared public tablet — a persistent server-side gallery of past shoppers' try-on photos, browsable by whoever walks up next, is a privacy anti-feature, and job rows can't be hard-deleted anyway (they're referenced by the credit ledger). In v1: the results gallery is **client-local session state** on the tablet — "delete"/"delete all" clears the local gallery only, the QR/share flow is covered per-job by `shareUrl`, and the server keeps job rows untouched for billing audit. If during implementation you find a screen that genuinely cannot function without server-side listing, the bounded escape hatch is a device-scoped `GET /v1/kiosk/jobs?limit=50` (this device's recent jobs only) — add that and nothing more, and flag it in your Report Back.

### Android app changes (`apps/virtual-tryon-mobile&kiosk`)

Read each of the following files fully before editing — they're existing, working code, and this is a targeted networking-layer rewrite, not a rebuild:

| File | Change |
|---|---|
| `ApiUtils/APIConstant.kt` | Point the base URL at the new API host; update endpoint path constants to the new `/v1/kiosk/*` routes; **delete the hardcoded shared-secret constant** used in the current auth headers — it has no replacement, because HTTPS + short-TTL pairing codes + per-device JWTs are the entire trust boundary now |
| `ApiUtils/APICaller.kt` | Change header injection to `Authorization: Bearer <accessToken>`; add a 401 → refresh → retry interceptor, mirroring whatever pattern `apps/admin-mobile`'s token-refresh client already uses (read it first) |
| `ApiUtils/APIInterface.kt` | Expect this to need no change — it's already a generic Retrofit interface; if it turns out to need endpoint-specific changes, note why in your report |
| `utils/PrefsManager.kt` | Move refresh-token storage off plaintext `SharedPreferences` onto `androidx.security.crypto.EncryptedSharedPreferences` (an already-available AndroidX artifact — do not add a new third-party dependency for this) |
| `viewmodel/category/SareecategoryDataViewModel.kt` | The like/add-to-cart calls currently send a client-side user id in the request — remove that entirely and call the new `PUT`/`DELETE` endpoints, which derive identity from the auth token server-side |
| `viewmodel/category/SareeCategoryDataRepository.kt` | Repoint the login call to `/v1/kiosk/auth/claim` with `{pairingCode}`; change the customer-photo upload from a legacy multipart POST to the presign → raw PUT of bytes → pass the returned key to job creation flow (the same two-step upload pattern every other client of this backend uses — check `apps/catalogues-web`'s upload flow for reference if useful) |
| `activity/auth/LoginActivity.kt` | **The one unavoidable UX change.** Replace the username/password fields with a single pairing-code entry field. This is not optional or deferrable — server-validated device pairing cannot be expressed as a username+password flow by construction. |
| `activity/launch/SplashScreenActivity.kt` | Change the session check from whatever it currently does to: read a stored kiosk refresh token → attempt a silent refresh → success routes to the home screen, failure routes to the (new) login/pairing screen. Mirror `apps/admin-mobile`'s app-boot session-restore logic. |
| `activity/vastra/VastraTryOnResultActivity.kt` | **Do not change the UI.** The icon-tint toggle and toast-message feedback for like/add-to-cart must remain pixel-identical — only the ViewModel calls underneath this screen change. |

## Cutover & rollout (operational — read this, but it's not a code task)

There is **no data migration** — the legacy backend's schema shares essentially nothing with the new model, and its product catalog was global rather than per-merchant, so there's nothing meaningful to port. Existing store operators are onboarded fresh: an admin creates (or a merchant self-signs-up for) a `widget_clients` row per store, sets `kioskEnabled`, the merchant populates their catalog, and generates pairing codes for their physical devices. Roll out store-by-store while the legacy PHP backend stays live and untouched — old installed APKs keep working against it until each tablet is individually updated to the new build and paired. This makes the legacy backend the rollback path for the duration of the rollout; don't touch or decommission it as part of this phase.

**Shopper-photo retention (privacy):** photos uploaded at a kiosk are in-store shoppers' personal data and must not accumulate indefinitely. Add an object-lifecycle/expiry rule for the `kiosk-inputs/` prefix (R2/MinIO lifecycle rule, e.g. 30 days — or a scheduled cleanup if lifecycle rules aren't available on the current MinIO setup). Note in your report which mechanism was used; if it's a server-side lifecycle config applied manually on the VPS, document the exact rule for the operator.

## Out of scope for this phase

- No changes to `apps/dispatcher` (confirm this stays true — see the "Why" section above).
- No lower/shoe compositing support for kiosk jobs.
- No offline/queue mode — the app should surface network errors as it presumably already does.

## Definition of Done

- [ ] New integration test `apps/api/test/integration/kiosk-jobs.test.ts` covers, and passes:
  - Claim a device → presign → PUT a photo to MinIO → seed a catalog item for that merchant → create a job → assert `jobs.widgetClientId` **and** `jobs.kioskDeviceId` are both set correctly, and `widget_client_credits.balance` is decremented atomically with the job insert (this is the existing credit-deduct-plus-insert invariant, now exercised for kiosk jobs specifically — write this as an explicit atomicity assertion, not just "the balance ended up lower").
  - Confirm the created job is picked up by the **existing, unmodified** `processWidgetJob` path (run against the dispatcher in the test environment, or at minimum confirm via the DB row that dispatcher routing logic requires no kiosk-specific branch).
  - A completed job's response includes a `shareUrl` that successfully GETs the result image bytes from MinIO with no `Authorization` header.
  - `PUT`/`DELETE /v1/kiosk/results/:jobId/like` and `.../cart`: a second merchant's device gets nothing for a job it doesn't own. Additionally, inspect the route's Zod schema and confirm there is no field anywhere that could accept a `widgetClientId` or `userId` from the request — this is the actual security property, verify it structurally, not just behaviorally.
  - A `customerPhotoKey` presigned by device A, submitted in a job by device B → rejected (the presign ownership binding).
- [ ] Android manual smoke test, performed and described in your report: pair a real (or emulator) device using a code generated through the Phase-2 merchant portal; kill and relaunch the app to confirm silent token refresh restores the session without re-pairing; perform one full try-on; confirm the like/cart icon-tint-and-toast UX and the gender→category→item navigation are visually unchanged from the pre-migration build (screenshots or a short screen recording in your report, not just a text claim).
- [ ] The hardcoded shared-secret constant is confirmed deleted from the Android source (grep the old value to confirm zero remaining references), with no equivalent replacement constant added.
- [ ] `apps/api` typecheck and full test suite pass.

## Report Back

_Codex: fill this in when the phase is complete._

- Files created:
- Files modified (API):
- Files modified (Android):
- Migration filename + index used:
- Confirmation dispatcher required zero changes (or: what you found and how you adapted if the routing logic had changed):
- Test run output:
- Android smoke-test evidence (screenshots/recording description):
- Any deviation from this spec, and why:
- Anything ambiguous you had to make a judgment call on:
