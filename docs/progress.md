# Project Progress

> Update this file after every plan execution (superpowers/plan or any implementation plan).
> Record what was done, what failed, and open questions/decisions.

---

## Log

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
- Updated `apps/web/src/lib/api.ts`:
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
- Updated `AGENTS.md` to reflect current repo state: added `@aivastra/observability`, `apps/dispatcher`, `apps/web`, `apps/admin` to monorepo boundaries table
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
- `apps/web`: added `jszip` dep + type annotation on zip progress callback (42b0131)

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
- `apps/admin/src/lib/data.ts`: added `subcategoryIds: []` to all 7 `MOCK_CATALOG` items — `CatalogItem` type requires this field (added in 2026-06-01 refactor but mocks not updated)
- `apps/admin/src/pages/CatalogPage.tsx`: added `GarmentType` import + `garmentTypes` state, fetched from `/admin/assets/garment-types` alongside existing Promise.all, passed `garmentTypes` prop to `BatchCatalogUploadModal` (prop was required but missing — caused TS2741)
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
- `MOCK_POSES` in `apps/admin/src/lib/data.ts` missing `lowerItemIds`/`shoeItemIds` → Docker build failed
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
- **Zero impact** on `apps/web`, `apps/admin`, DB schema, or env files.
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
- `apps/web/src/app/home/page.tsx` deleted
- Logo assets copied to `apps/web/public/assets/` (logo-icon, logo-icon-large, logo-wordmark, logo-wordmark-large, auth-bg)
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
- `web`: catalogue detail page scaffolded at `apps/web/src/app/(app)/catalogues/[id]/page.tsx`
- `web`: catalogue grid CSS (`.av-cdet-grid`, `.av-cdet-card`, `.av-cdet-img`, `.av-cdet-footer`) in globals.css
- `web`: dashboard — live data fetch, image grid with lazy thumbnails, status badges
- `web`: wizard — multi-pose selection UI (checkboxes, count badge)
- `web`: cleanup — replace hardcoded `#FFF` with CSS vars, dropzone bg uses `--surface-2`

**Failed / Not Done**

- Catalogue listing page (`GET /v1/catalogues`) only returns job metadata — no output thumbnails, no preview in catalogue grid
- Dashboard still uses mock stats (not live aggregate from API)
- Migration 0007 not yet applied to dev DB
- `apps/web/src/app/(app)/catalogues/[id]/page.tsx` — needs full UI polish

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

- `apps/web/src/app/(app)/account/page.tsx` — display name, email, tier, credit balance, change password, job history
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
- `apps/web/src/components/navbar.tsx` unused but still exists

**Open Questions / Decisions**

- [ ] Lower garment thumbnail resolution in dispatcher — PNG flatten + upload to R2 confirmed working
- [ ] `/history` polling interval for ComfyUI output — currently 2s, adjust if GPU node overloaded
- [ ] Dispatcher TLS bypass (`NODE_TLS_REJECT_UNAUTHORIZED=0`) — needs proper cert in prod

---

### 2026-05-22 — Full frontend redesign (vastra2.0 designer handoff)

**Done**

- `apps/web/src/app/globals.css`: complete rewrite — removed sketch utilities (`sketch-card`, `btn-sketch`, `underline-emph`), added full `av-` CSS class system (sidebar, stepper, cards, chips, dropzone, select, buttons, spinner), CSS vars matching warm cream palette (`--bg: #FBF8F3`, `--peach`, `--amber`, `--mint`, `--grad`, etc.), dark mode support
- `apps/web/src/app/layout.tsx`: replaced Caveat font with Poppins (400/500/600/700/800) + JetBrains Mono; updated metadata
- `apps/web/src/app/page.tsx`: full marketing landing page from `vastra2.0/Home.html` — hero, logos strip, how-it-works (4 steps), features grid, gallery (4 samples), pricing (3 cards), CTA, footer; `lp-` prefixed CSS via inline `<style>` tag; redirects to `/dashboard` if already logged in
- `apps/web/public/samples/`: copied `sample-1..4.png` from `vastra2.0/assets/`
- `apps/web/src/components/sidebar.tsx` (new): dark sidebar with credits bar (`/v1/credits`), user info (`/v1/me`), nav items (Studio/Catalogues/Credits), logout, initials avatar
- `apps/web/src/app/(app)/layout.tsx`: replaced navbar with `<div className="av-app"><Sidebar /><main className="av-main">{children}</main></div>`
- `apps/web/src/app/(app)/tryon/page.tsx`: 4-step wizard (Setup → Models → Backgrounds → Pose+Generate); garment upload starts immediately in step 0; Generate button gated on `garmentKey` set; `useEffect` fix for dropdown outside-click listener
- `apps/web/src/app/(app)/dashboard/page.tsx`: restyled with `av-card`, status dots, badge chips
- `apps/web/src/app/(app)/credits/page.tsx`: restyled with `av-card`, gradient balance display, package selector chips
- `apps/web/src/app/(auth)/login/page.tsx`: clean centered layout, white card, tab pills
- `apps/web/src/app/(auth)/register/page.tsx`: same structure as login
- `apps/api/src/modules/auth/routes.ts`: added `GET /v1/me` endpoint for regular users (email, displayName, tier)

**Failed / Not Done**

- `apps/web/src/components/navbar.tsx`: still exists (unused — safe to delete later)
- `apps/web/src/app/(app)/jobs/[id]/page.tsx`: still uses old sketch design (not redesigned)
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

*`apps/web` — Next.js 15 App Router (full scaffold)*

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
- `apps/web` not in CORS_ORIGIN of API: need to confirm `CORS_ORIGIN=http://localhost:3000` in `.env`

**Decisions Made**

- Auth cookie strategy: `access_token` non-httpOnly (JS-readable, 15min) + `refresh` httpOnly at `/api/auth` path (7d). All managed by Next.js proxy routes.
- All API calls go direct from client to `NEXT_PUBLIC_API_URL` (not through Next.js proxy), except auth. Avoids latency overhead.
- XHR (not fetch) for garment upload: enables `onprogress` events for progress bar.

**Open Questions / Decisions**

- [ ] SSE auth: `GET /v1/jobs/:id/events` uses `EventSource` (no custom headers). API `requireUser` only reads `Authorization` header. Need to add `?token=<accessToken>` query param support to `requireUser` plugin, or proxy SSE through Next.js.
- [ ] `CORS_ORIGIN` in `.env` must be `http://localhost:3000` for web ↔ API in dev — confirm set.
- [ ] `apps/web` prod: served via CloudPanel nginx on port 3000? Confirm routing before Phase 4D Dockerfile.
- [ ] Catalog lower garment selection not in wizard (Phase 3B only covers face/bg/pose). Add lower garment step if needed (wizard step 5, only shown when `pose.showsLower === true`).

---

### 2026-05-21 — Admin panel complete + asset management system

**Done**

*Admin Panel (`apps/admin` — standalone Vite/React SPA, proxied through Vite dev server at :5173)*

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

- Admin panel built as separate Vite SPA (`apps/admin`), not embedded in Next.js (`apps/web`) — diverges from PHASES.md §3D plan. This is intentional: admin panel is ready for production use standalone; no plan to migrate.
- `apps/web` (user-facing Next.js try-on builder) — not started
- Phase 2B (VPS + Tunnel + ComfyUI) — not started
- `templates/virtual-tryon-v1.json` — still a stub; real ComfyUI workflow export still blocking E2E

**Decisions Made**

- Admin panel = standalone Vite SPA (`apps/admin`) — not part of `apps/web`. Deployed separately, proxied by nginx in prod.
- Asset management scope expanded beyond original PHASES.md §1D: model faces, backgrounds, garment subcategories, poses all fully managed via admin UI.
- Poses schema: face × background per pose (not just per subcategory) — data model locked.
- Presigned URL upload flow: browser → presign API → direct PUT to MinIO/R2 → confirm API. Confirmed working end-to-end with local MinIO.

**Open Questions / Decisions**

- [ ] `apps/admin` prod deployment: serves from same VPS as API? nginx route `/admin-app/*` → static files from `apps/admin/dist/`? Decide before Phase 4D.
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
- Phase 3 (`apps/web` Next.js frontend) not started

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
- `apps/web` — not yet scaffolded
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
