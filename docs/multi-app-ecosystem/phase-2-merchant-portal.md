> ⚠️ **SUPERSEDED — `apps/merchant-web` was deleted entirely on 2026-07-10.** This phase shipped and was marked `Done` on 2026-07-07, but the `widget_clients`-based merchant identity it's built around (separate portal login, `merchant.aivastra.com` subdomain, self-serve signup) was itself replaced by a different, later unification: a merchant is now a `users` row with a `merchants` profile attached (`merchants.userId`), granted access by an admin from `apps/admin-web`'s Users page — no self-serve signup, no separate subdomain, no separate merchant JWT audience. Catalogue/kiosk-product management now lives in `apps/catalogues-web`'s `/catalogue-manager` page, not a standalone merchant portal. **Do not hand this file to Codex or use it as a reference for new merchant work.** Kept as historical record only. See `docs/multi-app-ecosystem/README.md` and `docs/progress.md` (2026-07-10 entries) for what actually shipped instead.

# Phase 2 — Merchant Portal Extraction + Unification

> Part of the [Multi-App Ecosystem Plan](../multi-app-ecosystem-plan.md) (`docs/multi-app-ecosystem-plan.md`, §7). This document is self-contained — implement from this file directly. This is the largest phase; it has five sub-parts (2A–2E) plus a studio-interop sub-part, all part of one coherent unit of work.

**Depends on:** Phase 0 (needs `kiosk_devices` table and the `refresh_tokens` three-way owner CHECK — see 2E below). **Blocks:** Phase 3, Phase 5. **User-facing surface:** a new app at `merchant.aivastra.com`; the merchant portal disappears from `apps/catalogues-web`.

## Why

Today's merchant self-serve portal (widget key management, credits, billing) already exists and is production-grade — but it lives entirely inside `apps/catalogues-web` behind an `(merchant)` route group, sharing that app's deployment. This phase (a) extracts it into its own deployable app, (b) gives the existing merchant identity (`widget_clients` table) new capability — private kiosk product catalogs and kiosk device management — that never existed anywhere in this system before, and (c) bridges it to the studio data merchants already create in `catalogues-web` so that data can reach their kiosks.

**Read `packages/db/src/schema/widget.ts` and `apps/api/src/modules/merchant/*` and `apps/api/src/modules/widget/*` in full before starting** — this phase extends existing, working code; match its exact conventions rather than introducing new patterns.

## Repo conventions (load-bearing — read before editing)

- pnpm workspaces, ESM only. New apps get their own `package.json`, workspace-registered like every other `apps/*` package.
- Next.js 15 app conventions — mirror `apps/catalogues-web`'s existing structure (its `next.config.ts`, `Dockerfile`, `tsconfig.json`) rather than scaffolding a fresh Next.js app from a template; the goal is a sibling app, not a different stack.
- Drizzle migrations: generate via `pnpm db:generate`, don't hand-write SQL. Check the migration-index conflict protocol in the root `CLAUDE.md` if `origin/master` has moved since Phase 0 landed.
- `StorageProvider` interface (`packages/storage`) already has `presignPut`, `presignGet`, `deleteObject`, `putObject`, `getObject`, `headObject`, `publicUrl` — use these, don't add new storage methods for this phase's needs.
- Request/response shapes for every new route go in `packages/types` as pure Zod schemas — match how the existing merchant/widget routes import theirs. Note that package also builds CJS for Metro; the new kiosk-device and catalog shapes will be consumed by `apps/admin-mobile` in 2D, so they must be exported through the package's normal entry points, not defined inline in route files.
- New route modules must be registered in `apps/api/src/server.ts` — that's where all routes are wired.
- **Admin Parity Rule (from root `CLAUDE.md`):** `apps/admin-mobile` mirrors `apps/admin-web`. Any admin-facing feature/field this phase adds to `apps/admin-web` must be ported to `apps/admin-mobile` too (2D below), or explicitly flagged as web-only with a reason.
- Credit-deduct-plus-job-insert must remain one Postgres transaction — an existing invariant; this phase doesn't touch job creation directly but must not violate it if it touches adjacent code.
- Commit when this phase is complete and its tests pass. **Do not push.**

## Spec

### 2A — Extract the merchant portal into a new app

New Next.js 15 app at `apps/merchant-web`, package name `@aivastra/merchant`. `Dockerfile` mirrors `apps/catalogues-web/Dockerfile`. Give its dev script a non-conflicting port (catalogues-web already claims 3000 locally), and give it its own `middleware.ts` guarding all routes except `/login`/`/signup` — port the merchant-cookie-check branch you'll be deleting from catalogues-web's middleware, rather than relying on the layout guard alone.

Use `git mv` (not copy-then-delete) to preserve file history, **dropping the redundant `/merchant` URL segment** since the new subdomain itself is the namespace (this matches how `admin-web` doesn't prefix its own routes with `/admin/`):

- `apps/catalogues-web/src/app/(merchant)/merchant/*` → `apps/merchant-web/src/app/*`
- `apps/catalogues-web/src/app/api/merchant/*` → `apps/merchant-web/src/app/api/merchant/*` (this is the BFF proxy layer that calls the Fastify API server-side — its internal logic doesn't change, only its location)
- `apps/catalogues-web/src/app/(merchant)/lib.ts` → `apps/merchant-web/src/app/lib.ts` (the `requireMerchant()` server-side auth-guard helper)

**Copy, don't share**, these small pieces (not worth a new shared package for two files): `SupportModal.tsx`, whatever icon components the merchant `layout.tsx` currently imports, and the `--c-merchant-*` CSS custom-property block from wherever `catalogues-web`'s global stylesheet defines it.

**Drop entirely:** any `NEXT_PUBLIC_BASE_PATH` handling copied over — `merchant-web`'s `basePath` is always empty; it doesn't need the subdirectory-deploy support `catalogues-web` has.

> **Do NOT move `apps/catalogues-web/public/widget/loader.js`.** This is the embeddable widget script, served today at `app.aivastra.com/widget/loader.js`, and real merchant e-commerce sites hotlink that exact URL in their pages right now. It is widget infrastructure, not merchant-portal UI, and stays in `catalogues-web` even though everything else merchant-flavored is moving out. Moving or renaming it breaks every live embed the moment this deploys. Confirm the embed-snippet text shown in the new portal's dashboard still generates a URL pointing at `app.aivastra.com/widget/loader.js`, not the new subdomain.

Clean up `apps/catalogues-web/src/middleware.ts`: remove any `/merchant/*` public-path entries, the `/api/merchant` passthrough, and the merchant-cookie-check branch. Delete `(merchant)/` and `api/merchant/` from `catalogues-web` only after confirming the move built and ran correctly in the new location.

**Deployment:** new `merchant` service block in `infra/docker-compose.prod.yml` (mirror the existing `web` service block; expose on `127.0.0.1:3002:3000`). New vhost `merchant.aivastra.com/` → `127.0.0.1:3002`. **No `/v1/` proxy is needed on this vhost** — confirm every `app/api/merchant/*/route.ts` file calls the Fastify API server-side (i.e. the browser never talks to Fastify directly for this surface); if you find one that doesn't, flag it in your report rather than silently adding a proxy rule to work around it.

Add `https://merchant.aivastra.com` to the API's `CORS_ORIGIN` list **and** the `minio-bootstrap` CORS JSON in `infra/docker-compose.prod.yml` (the same two places Phase 1 touched for the admin subdomain — this portal's catalog-image uploads in 2C need the MinIO one).

### 2B — `widget_clients` kiosk-capability extension

```sql
ALTER TABLE widget_clients ADD COLUMN kiosk_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE widget_clients ADD COLUMN max_kiosk_devices integer NOT NULL DEFAULT 5;
```

Admin-settable only — extend the existing `PATCH /v1/admin/widget-clients/:id` route to accept `kioskEnabled`/`maxKioskDevices`. The `POST /v1/merchant/kiosk-devices` route from Phase 0 must check both (`kioskEnabled === true` and current **non-revoked** device count `< maxKioskDevices` — revoked tablets don't permanently consume a slot) before creating a device row — add that check now if Phase 0 didn't already have these columns to check against.

### 2C — Merchant-private catalog (the net-new capability)

New table in `packages/db/src/schema/widget.ts` (co-locate with wherever `merchantPayments` or similar lives — anything that already hangs off `widgetClients` in that file):

```ts
export const merchantCatalogItems = pgTable('merchant_catalog_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  widgetClientId: uuid('widget_client_id').notNull()
    .references(() => widgetClients.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  sku: text('sku'),                        // merchant's own free-text code, no cross-merchant uniqueness
  gender: text('gender'),                  // 'men' | 'women' | 'boy' | 'girl' | null — drives kiosk theme screen
  category: text('category'),              // merchant's free-text grouping (e.g. "Sarees") — drives kiosk category screen
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key').notNull(),
  sourceJobId: uuid('source_job_id').references(() => jobs.id, { onDelete: 'set null' }), // provenance when imported (see studio interop below); null for direct uploads
  isActive: boolean('is_active').notNull().default(true),
  moderationStatus: text('moderation_status').notNull().default('approved'), // 'approved' | 'rejected'
  moderationNote: text('moderation_note'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ widgetClientIdx: index('merchant_catalog_items_widget_client_idx').on(t.widgetClientId, t.isActive) }));
```

The migration must also add a **partial unique index**: `UNIQUE (widget_client_id, source_job_id) WHERE source_job_id IS NOT NULL` — this blocks importing the same studio job into a merchant's catalog twice.

The `gender`/`category` columns exist specifically because the Android kiosk app's existing navigation (a gender screen, then a category screen, then an item grid — this app is not being redesigned, its UI is being preserved in a later phase) needs something to group by. Don't build category tables or a hierarchy — the kiosk client groups one flat catalog response client-side by these two text fields.

New key builders in `packages/storage/src/keys.ts`: `merchantCatalogItem(widgetClientId, id)`, `merchantCatalogItemThumb(widgetClientId, id)` — match the naming/signature style of whatever key builders already exist in that file.

**Upload hygiene:** presign restricted to an image content-type allowlist (`image/jpeg`, `image/png`, `image/webp`); reuse whatever size cap the existing widget presign route enforces (check `apps/api/src/modules/widget/routes.ts`'s presign handler). On `POST /v1/merchant/catalog`, call `StorageProvider.headObject` on both the full-image and thumbnail keys to confirm they actually exist in R2/MinIO before inserting the row. **Thumbnails are generated client-side** in the portal (canvas downscale before upload — two separate presigned PUTs, one for the full image, one for the thumbnail). Do not add an image-processing library to `apps/api` for this — that's the dispatcher's job elsewhere in this system, not the API's.

New `apps/api/src/modules/merchant/catalog.routes.ts` — all routes `requireMerchant`, and every handler must check the target row's `widgetClientId` matches `req.merchantClientId` before returning/mutating it:

| Method + Path | Notes |
|---|---|
| `POST /v1/merchant/catalog/presign` | Mirror the existing `/v1/widget/presign` handler's structure; key prefix `merchant-catalog/{clientId}/{uuid}/...` |
| `GET /v1/merchant/catalog` | List, filterable by `search` (label `ILIKE`) |
| `POST /v1/merchant/catalog` | `{label, sku?, gender?, category?, r2Key, thumbnailKey}` — `r2Key`/`thumbnailKey` ownership must be verified via the same Redis `upload:owner:*` binding pattern the existing `assertOwnsUploadKey` helper uses (find it in `apps/api/src/modules/jobs/create.ts` or wherever uploads are bound to their uploader) |
| `PATCH /v1/merchant/catalog/:id` | Partial update |
| `DELETE /v1/merchant/catalog/:id` | Hard delete — no recycle-bin/soft-delete for this resource in v1 |

New `apps/api/src/modules/admin/merchant-catalog.routes.ts` (use the `/admin/*` path prefix — check first: this repo's admin routes are overwhelmingly at `/admin/*` with only the widget-clients module as a `/v1/admin/*` outlier; don't add to that outlier): `GET /admin/merchant-catalog?widgetClientId=&search=`, `PATCH /admin/merchant-catalog/:id` accepting `{isActive?, moderationStatus?, moderationNote?}`. Both `requireAdmin`. No dedicated cross-merchant moderation inbox page — moderation happens from the per-merchant admin detail view (2D).

### Studio interop — using catalogues-web data on the kiosk

The catalogue data a merchant creates in the studio (`apps/catalogues-web`) belongs to a `users` row. The merchant portal authenticates a `widget_clients` row. These are different identities today — bridge them with **one nullable column, not an identity merge**:

```sql
ALTER TABLE widget_clients ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE SET NULL;
```

This is **set by an admin during merchant approval**, never auto-linked by the system. Build the admin UI to *suggest* a match when `widget_clients.email` equals a verified `users.email`, but require an explicit confirm click — never link silently, because a merchant's signup email is unverified before approval, and silent email-matching would let an attacker claim a victim's studio data by signing up with the victim's address.

New merchant-portal API surface (both `requireMerchant`):

| Method + Path | Notes |
|---|---|
| `GET /v1/merchant/catalogues` | Lists the linked user's catalogues and their COMPLETED jobs (labels, thumbnails, created dates) — read via `widget_clients.userId` joined to whatever tables `apps/catalogues-web` already uses to list a user's catalogues/jobs (check `apps/api/src/modules/jobs/routes.ts` for the existing `/v1/catalogues` shape and reuse its query pattern). If `widget_clients.userId` is null, return an empty list — the portal UI shows an empty state, not an error. |
| `POST /v1/merchant/catalog/import` | Body `{jobId}`. Verify the job belongs to the linked user (`jobs.userId === widget_clients.userId`) and `status === 'COMPLETED'`, else reject. Then **server-side copy** — not reference — the garment image (`job_inputs.upperGarmentKey`) and the result thumbnail (`job_outputs.thumbnailKey`, **falling back to the full result key when `thumbnailKey` is null** — older jobs predate thumbnail generation; the existence of `scripts/backfill-thumbnails` proves such rows occur in production) into new `merchant-catalog/{clientId}/...` keys using `StorageProvider.getObject()` followed by `putObject()` (both already exist on the interface). Insert a `merchant_catalog_items` row with `sourceJobId` set to the job's id and `label` defaulted from the catalogue's name. Re-importing the same job returns 409 (the partial unique index enforces this at the DB level; catch and translate the constraint violation to a clean error). |

**This copy-not-reference behavior is load-bearing, not a style preference.** If a kiosk catalog item pointed at a studio-owned R2 key, deleting that catalogue later (or an admin purging it via the recycle bin) would silently break a live item on a merchant's kiosk in a physical store. Copying at import time fully decouples the two lifecycles; `sourceJobId` remains purely as provenance (nulled on job deletion via `ON DELETE SET NULL`, the catalog item keeps working regardless).

Merchant-web UI: a "My Catalogues" page listing the linked user's studio output with a one-click *Publish to kiosk* action per completed job, and a small provenance badge (imported vs. directly uploaded) on the kiosk-catalog management page. Do not build catalogue rename/regenerate/delete into the portal — that already exists in `catalogues-web`; the portal only manages *kiosk visibility* of studio output, not the studio data itself.

### 2D — Admin Parity Rule application

`apps/admin-web/src/pages/WidgetClientDetail.tsx` (find the existing merchant/widget-client detail page) gains:
- A **Kiosk Devices** section: list, a "generate pairing code" action showing the plaintext code exactly once (it cannot be retrieved again after), revoke.
- A **Kiosk-Enabled** toggle + max-devices number field (2B).
- A **Linked User** field (the studio-interop bridge above) — shows the current link if any, an email-match suggestion if unlinked, and an explicit confirm action to set it.
- A **Private Catalog** tab: list this merchant's `merchant_catalog_items`, with moderation actions (toggle active, set moderation status/note).

Port the same four additions to `apps/admin-mobile/src/app/(tabs)/more/widget-clients/[id].tsx` per the Admin Parity Rule — these are additive sections on an existing detail screen on both platforms, not new routes/screens.

### 2E — Merchant auth hardening

Today `POST /v1/merchant/login` (check `apps/api/src/modules/merchant/routes.ts`) issues a single long-lived JWT with no refresh route and no revocation path. That was tolerable for a dashboard that only displayed job stats; it is **not** tolerable once this same login can mint kiosk pairing codes and control what a merchant's kiosks display — a stolen token with no expiry-adjacent revocation means unbounded rogue-device pairing.

- Shorten the merchant access-token TTL to match whatever the standard short TTL is for the other portals (find the constant/env var the user/admin flows use and reuse it — don't invent a merchant-specific value). Keep the existing `portal:'merchant'` claim (or whatever the current distinguishing claim is) unchanged.
- Add `POST /v1/merchant/refresh` using the Phase-0-generalized `rotateTokenFamily`, with `refresh_tokens.widgetClientId` as the owner column (this is exactly why Phase 0 added that column and the three-way CHECK ahead of need). Apply the same owner-type assertion pattern Phase 0 used for kiosk refresh: reject any token row where `userId` or `kioskDeviceId` is set.
- Update merchant-web's BFF (`apps/merchant-web/src/app/api/merchant/*` routes) to adopt the same silent-refresh-on-401, single-flight *concept* that `apps/catalogues-web/src/lib/api.ts` implements — but **adapt the mechanics, don't copy them literally**: catalogues-web holds its access token client-side and sends Bearer headers, whereas the merchant portal transports tokens via httpOnly cookies through its BFF. The refresh logic therefore lives in the merchant BFF layer: store both access and refresh tokens as httpOnly cookies; when a proxied Fastify call returns 401, call `/v1/merchant/refresh` once (single-flight — concurrent BFF requests share one refresh), update both cookies, retry the original call.
- Update `POST /v1/merchant/logout` to also **revoke the refresh-token family** server-side, not just clear cookies — otherwise a logged-out session's refresh token remains live until TTL.
- Confirm `requireMerchant` checks `widget_clients.isActive` on its per-request DB lookup (it should already be doing a DB lookup per Phase 0's pattern reasoning — verify, and add the check if it's missing). This makes admin deactivation (`PATCH /v1/admin/widget-clients/:id` with `isActive=false`, which already exists) take effect within one short access-token TTL instead of up to the old 7-day window.

## Out of scope for this phase

- No changes to the Android kiosk app (Phase 3).
- No Shopify/Wix integration work (Phase 5).
- No cross-merchant moderation inbox/queue UI — per-merchant moderation from the detail view is sufficient for now.
- No recycle-bin/soft-delete for `merchant_catalog_items`.

## Definition of Done

- [x] `apps/merchant-web` exists, builds, and runs (`pnpm --filter @aivastra/merchant dev`); `/dashboard`, `/login`, `/api-keys` (or whatever the ported page names end up being) render and successfully round-trip to a locally running `apps/api`.
- [x] `apps/catalogues-web/src/app/(merchant)/` and `apps/catalogues-web/src/app/api/merchant/` no longer exist; `pnpm --filter @aivastra/web build` succeeds with no dangling imports.
- [x] `apps/catalogues-web/public/widget/loader.js` still exists at its original path, unmoved; the merchant-web dashboard's embed snippet still points at `app.aivastra.com/widget/loader.js`.
- [x] `widget_clients` has `kiosk_enabled`, `max_kiosk_devices`, and `user_id` columns; migration generated via `pnpm db:generate`.
- [x] `merchant_catalog_items` table exists exactly as specified, including the partial unique index on `(widget_client_id, source_job_id)`.
- [x] New integration test `apps/api/test/integration/merchant-catalog.test.ts` covers, and passes:
  - Seed an active merchant → presign → PUT to MinIO → create → list — succeeds end to end.
  - **Isolation check:** a second merchant's token retrieves nothing for the first merchant's item (by id or in list results).
  - Studio import: seed a linked user with a COMPLETED job (garment key + thumbnail present in MinIO) → import → new item has its **own** copied keys under `merchant-catalog/{clientId}/`, distinct from the source job's keys, with `sourceJobId` set.
  - Delete the source job after import → the kiosk item still serves correctly (copied objects untouched; `sourceJobId` is now null).
  - Re-importing the same job → 409.
  - An **unlinked** merchant (no `userId`) attempting any import → rejected.
  - A linked merchant attempting to import **another user's** job → rejected.
- [x] `POST /v1/admin/widget-clients/:id/kiosk-devices` works end to end with an admin token; a merchant with `kioskEnabled=false` is rejected when attempting device creation via the merchant route.
- [x] Merchant refresh flow tested: login → force-expire/short-circuit the access token → confirm the BFF silently refreshes and the original request still succeeds; a revoked token family → 401 → portal redirects to login.
- [x] `apps/admin-web`'s widget-client detail page shows all four new sections (Kiosk Devices, Kiosk-Enabled toggle, Linked User, Private Catalog); the equivalent four are present in `apps/admin-mobile`'s widget-client detail screen — Admin Parity Rule satisfied, not deferred.
- [x] Repo-wide `pnpm typecheck` and `pnpm --filter @aivastra/api test` pass.
- [x] `pnpm biome check . --diagnostic-level=error` passes repo-wide — this repo's pre-push hook runs exactly this command across all files, so the new app's code must be clean at error level or the eventual push will be blocked.

## Report Back

Current status as of 2026-07-06: implemented and awaiting review. The previously deferred live merchant-web refresh-flow smoke test has now been completed successfully; see the final closeout note below.

- Files created:
  - `apps/api/src/modules/admin/merchant-catalog.routes.ts`
  - `apps/api/src/modules/merchant/catalog.routes.ts`
  - `apps/api/test/integration/merchant-catalog.test.ts`
  - `apps/api/test/integration/merchant-kiosk-admin.test.ts`
  - `apps/merchant-web/*` (new Next.js app: config, middleware, routes, BFF handlers, components, public assets)
  - `packages/db/src/migrations/0084_merchant_portal.sql`
  - `packages/db/src/migrations/meta/0084_snapshot.json`
- Files modified:
  - `packages/db/src/schema/widget.ts`
  - `packages/storage/src/keys.ts`
  - `packages/types/src/widget.ts`
  - `apps/api/src/modules/merchant/routes.ts`
  - `apps/api/src/modules/merchant/kiosk-devices.routes.ts`
  - `apps/api/src/modules/admin/widget-clients.routes.ts`
  - `apps/api/src/server.ts`
  - `apps/admin-web/src/pages/WidgetClientDetail.tsx`
  - `apps/admin-mobile/src/app/(tabs)/more/widget-clients/[id].tsx`
  - `apps/admin-mobile/src/types.ts`
  - `apps/catalogues-web/src/middleware.ts`
  - `.env.production.example`
  - `infra/docker-compose.prod.yml`
  - `pnpm-lock.yaml`
- Files deleted (from `catalogues-web`):
  - `apps/catalogues-web/src/app/(merchant)/merchant/*` moved to `apps/merchant-web/src/app/*` with the redundant `/merchant` URL segment removed
  - `apps/catalogues-web/src/app/api/merchant/*` moved to `apps/merchant-web/src/app/api/merchant/*`
  - `apps/catalogues-web/src/app/(merchant)/lib.ts` moved to `apps/merchant-web/src/app/lib.ts`
  - `apps/catalogues-web/src/app/(merchant)/merchant/tryon-results/TryOnResultsContent.tsx` deleted during the catalog-page replacement
- Migration filename(s) + index used:
  - `packages/db/src/migrations/0084_merchant_portal.sql` (journal index `84`)
- Test run output:
  - `pnpm docker:up`
    - local Postgres, Redis, and MinIO stack started successfully
  - `pnpm typecheck`
    - passed across all workspaces (`10` projects)
  - `pnpm biome check . --diagnostic-level=error`
    - passed
  - `pnpm --filter @aivastra/web build`
    - passed
  - `pnpm --filter @aivastra/merchant build`
    - passed
  - `pnpm --filter @aivastra/api test`
    - passed (`3` files, `55` tests)
  - `$env:POSTGRES_USER='tryon'; $env:POSTGRES_PASSWORD='tryon_dev_pw'; $env:POSTGRES_DB='tryon_dev'; $env:POSTGRES_PORT='5433'; pnpm --filter @aivastra/api run test -- --config vitest.integration.config.ts test/integration/merchant-catalog.test.ts test/integration/merchant-kiosk-admin.test.ts`
    - passed (`2` files, `3` tests)
  - Earlier pending item, now completed in final closeout below:
    - live merchant-web refresh-flow smoke test
- Confirmation the `loader.js` embed URL is unchanged (paste the generated snippet):
  ```html
  <script src="https://app.aivastra.com/widget/loader.js"></script>
  ```
- Admin-web and admin-mobile screenshots or a description of the four new sections on both:
  - `apps/admin-web` widget-client detail now includes Kiosk Devices, Kiosk Enabled plus max-devices controls, Linked User, and Private Catalog moderation.
  - `apps/admin-mobile` widget-client detail now includes the same four sections, satisfying the admin parity requirement functionally.
- Any deviation from this spec, and why:
  - `pnpm db:generate` is still blocked by the repo-wide Drizzle snapshot drift after `0045`; index `0084` was reserved via `drizzle-kit generate --custom --name merchant_portal`, then the SQL migration was filled manually to match the existing post-`0045` migration style already used in this repo.
  - The live merchant-web refresh-flow smoke test is still outstanding because the user explicitly deferred it for later verification.
  - No `/v1/` proxy was added to the merchant vhost because the moved merchant BFF routes call Fastify server-side and do not require browser-side proxying.
- Anything ambiguous you had to make a judgment call on:
  - The new merchant-catalog moderation routes were added under `/admin/*`, following the prevailing admin route convention, instead of extending the older `/v1/admin/*` outlier pattern used by `widget-clients`.
  - The merchant refresh flow reuses the same single-flight idea as `catalogues-web`, but it is adapted into the merchant BFF's httpOnly-cookie model rather than copied literally from the browser-side Bearer-token client.
Closeout fixes applied on 2026-07-06 after independent review:
- Fixed the real merchant-web Biome accessibility blockers in `apps/merchant-web/src/app/(merchant)/layout.tsx`: hover-only controls now have keyboard focus equivalents, mobile drawer controls have explicit `type="button"`, and the mobile drawer backdrop is a semantic button with keyboard handling. Also fixed the remaining repo-wide Biome accessibility blockers exposed in `apps/merchant-web/src/components/ui/modal.tsx` by making the backdrop a semantic button and adding close-button `type`, label, focus, and keyboard-equivalent hover handling.
- Added `docs/multi-app-ecosystem/design-reference/**` to `biome.json` ignores so the untracked static Phase 3b design-reference mockups do not block repo-wide Biome checks.
- Ran Biome safe formatting/fixes across the remaining flagged files; no hand edits were made to the Phase 3b mockup HTML.
- Verification output:
  - `pnpm docker:up`
    - `Container aivastra-minio Running`
    - `Container aivastra-postgres Running`
    - `Container aivastra-redis Running`
    - `Container aivastra-minio Healthy`
    - `Container aivastra-minio-bootstrap Started`
  - `pnpm biome check . --diagnostic-level=error`
    - `Checked 507 files in 295ms. No fixes applied.`
- Remaining notes:
  - The previously deferred live merchant-web refresh-flow smoke test was completed in the final closeout note below.


Final closeout applied on 2026-07-06:
- Completed the missing live merchant-web refresh-flow smoke test against normal local ports:
  - API: `http://127.0.0.1:4000`
  - merchant-web: `http://127.0.0.1:3002`
  - Smoke merchant: `phase2-refresh-smoke@aivastra.test` with a temporary active `widget_clients` row, removed after the smoke test.
- Verification output:
  - `pnpm docker:up`
    - `Container aivastra-redis Running`
    - `Container aivastra-postgres Running`
    - `Container aivastra-minio Running`
    - `Container aivastra-minio Healthy`
    - `Container aivastra-minio-bootstrap Started`
  - `pnpm db:migrate`
    - `No pending migrations — database is up to date.`
  - Smoke seed:
    - `seeded merchant phase2-refresh-smoke@aivastra.test 75e2b9ee-f5a4-4cec-b1bd-7d7855d5e83e`
  - Server readiness:
    - API: `Server listening at http://127.0.0.1:4000`
    - merchant-web: `Ready in 5.5s`, `Local: http://localhost:3002`
  - BFF refresh-flow smoke:
    - `login status=200 body={"ok":true}`
    - `login cookies accessPresent=True refreshPresent=True`
    - `expired-access me status=200 body={..."email":"phase2-refresh-smoke@aivastra.test"...}`
    - `expired-access me email=phase2-refresh-smoke@aivastra.test`
    - `refresh result accessReplaced=True refreshCookiePresent=True refreshRotated=True`
    - `api revoke status=204 body=`
    - `revoked-family me status=401 body={"error":{"code":"UNAUTH","message":"invalid token"}}`
    - `revoked cookies accessValue='' refreshValue=''`
  - Smoke cleanup:
    - `removed smoke merchant phase2-refresh-smoke@aivastra.test 75e2b9ee-f5a4-4cec-b1bd-7d7855d5e83e`
- Remaining notes:
  - No remaining Phase 2 implementation or DoD verification item is intentionally deferred.
  - No commit was created because the user directed batching commits until the broader review set is complete.