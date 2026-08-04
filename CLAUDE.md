# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

- [x] Phase 0 — Foundations (monorepo, DB schema, docker infra)
- [x] Phase 1 — Backend API (auth, credits, catalog, admin, jobs)
- [x] Phase 2 — Dispatcher (Redis consumer, worker routing, ComfyUI pipeline)
- [ ] Phase 3 — Next.js frontend (`apps/catalogues-web` — partially scaffolded)
- [ ] Phase 4 — E2E integration + real ComfyUI workflow template

Read `docs/virtual-tryon-system-design.md` before changing architecture. See `docs/PHASES.md` for phase detail.

## Stack & Tooling

- **Package manager:** pnpm workspaces. Never introduce npm/yarn lockfiles.
- **Runtime:** Node 20+, TypeScript 5.6, ESM only (`"type": "module"` everywhere).
- **API:** Fastify 5 + `fastify-type-provider-zod`. All routes wired in `apps/api/src/server.ts`.
- **DB:** PostgreSQL 16 via Drizzle ORM. Schema in `packages/db/src/schema/`. Migrations in `packages/db/src/migrations/`.
- **Cache/Queue:** Redis 7 Streams (`jobs:priority`, `jobs:normal`, `jobs:low`, `jobs:video`). Consumer group: `dispatcher-cg`. The three GPU streams are capped by the worker-registry size; `jobs:video` is a separate lane capped by `VIDEO_CONCURRENCY` (PixVerse jobs need no GPU).
- **Storage:** S3-compatible (Cloudflare R2 in prod, MinIO locally). `StorageProvider` interface in `packages/storage`.
- **Logger:** pino via `@aivastra/logger` (`createLogger(service)`). No `console.log` in committed code. Use child loggers with `jobId`/`userId` bindings.
- **Tests:** Vitest. No testcontainers — see Testing section below.

## Monorepo Layout

```
apps/api           Fastify 5 REST API — auth, credits, catalog, jobs, admin
apps/dispatcher    Redis Stream consumer — routes jobs to GPU workers
apps/chatbot       Fastify + WS support chatbot — LangGraph bot, HITL, pgvector RAG
apps/catalogues-web           Next.js 15 — user-facing UI (auth, studio, catalogues, pricing)
apps/admin-web         Vite + React SPA — internal admin panel (separate from apps/catalogues-web)
packages/db        Drizzle schema + migrations + createDb() factory
packages/types     Zod schemas only — single source of truth for request/response shapes
packages/storage   StorageProvider interface + R2/MinIO impl + R2 key builders
packages/logger    pino wrapper — createLogger(service)
packages/observability  Prometheus metrics registry (shared by api + dispatcher)
infra/             docker-compose.yml, cloudflared configs, Grafana Alloy config
scripts/           Ops scripts (backfill-thumbnails, bootstrap-admin)
docs/              Design doc, phase plans, progress log, open findings
```

### Shared Package Details

| Package | Key exports |
|---------|-------------|
| `@aivastra/db` | `createDb(url)`, `schema` namespace, drizzle operators (`and`, `eq`, `inArray`, `or`, `sql`) |
| `@aivastra/types` | Pure Zod schemas - `auth.ts`, `catalog.ts`, `jobs.ts`, `admin.ts`, `widget.ts`. |
| `@aivastra/storage` | `StorageProvider` interface (`presignPut`, `presignGet`, `deleteObject`, `putObject`, `getObject`, `headObject`, `publicUrl`); `createR2Provider(cfg)`; `keys` key-builders |
| `@aivastra/logger` | `createLogger(service, extra?)` — pino with redaction of passwords, tokens, secrets, auth headers, cookies, R2 keys |
| `@aivastra/observability` | Single Prometheus registry; counters for jobs, credits, comfy duration, queue depth, worker health |

## Commands

```bash
# First-time setup
cp .env.example .env          # fill in secrets
pnpm install
pnpm docker:up                # postgres + redis + minio on 127.0.0.1
pnpm db:generate              # generate Drizzle migration SQL
pnpm db:migrate               # apply migrations to DATABASE_URL
```

| Command | What |
|---------|------|
| `pnpm dev` | Run all services in parallel (turbo) |
| `pnpm --filter @aivastra/api dev` | API only |
| `pnpm --filter @aivastra/dispatcher dev` | Dispatcher only |
| `pnpm --filter @aivastra/chatbot dev` | Chatbot service only |
| `pnpm --filter @aivastra/web dev` | Next.js web only |
| `pnpm --filter @aivastra/admin dev` | Admin SPA only |
| `pnpm build` | Typecheck + build all |
| `pnpm typecheck` | Type-check all |
| `pnpm lint` | Lint all |
| `pnpm --filter @aivastra/api test` | Full API integration suite |
| `pnpm --filter @aivastra/api test -- <pattern>` | Single test by name (Vitest `-t`) |
| `pnpm --filter @aivastra/<pkg> test` | Single package tests |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop infra |
| `pnpm docker:reset` | Compose down + delete volumes |
| `pnpm db:generate` | `drizzle-kit generate` (needs `DATABASE_URL`) |
| `pnpm db:migrate` | Run `packages/db/src/migrate.ts` |
| `pnpm seed:catalog` | Run `scripts/seed-catalog.ts` |

Makefile shortcuts mirror these (e.g. `make test-api`, `make docker-up`).

## Architecture — Big Picture

Three-service split with a hard boundary at the Redis Stream:

1. **api** — auth, credits, catalog reads, job creation. Validates catalog IDs → atomic credit deduct (`UPDATE WHERE balance > 0`) → writes `jobs` row → `XADD` to Redis stream. Never talks to ComfyUI.
2. **dispatcher** — only process that talks to GPU workers. Consumes stream via `XREADGROUP`, selects healthy IDLE worker, clones + patches the versioned workflow template with R2 input keys, posts to ComfyUI `/prompt` over Cloudflare Tunnel, listens on ComfyUI websocket for progress, uploads result to R2, updates Postgres + publishes SSE, `XACK`s. Refunds credits in the same Postgres transaction on terminal failure (max 2 attempts).
3. **web** — uploads garments **direct to R2 via presigned URL** (bypasses api), then POSTs job metadata. Opens SSE for live progress. Auth via httpOnly cookie (`access_token`). Token refresh handled automatically in `apps/catalogues-web/src/lib/api.ts`.
4. **admin** — separate Vite+React SPA (`apps/admin-web`). Talks directly to `apps/api` `/admin/*` routes.

Worker connectivity: each ComfyUI VPS runs `cloudflared`; no inbound ports. Health monitor probes `/system_stats` every 15s and sets `worker:health:{id}` with 30s TTL — expired = unhealthy = no routing.

### Adding a GPU worker

Workers are managed via the admin panel → stored in `schema.workers` (Postgres) → loaded into Redis registry at dispatcher startup. No env var changes needed.

1. In the admin panel go to **Workers** → **Add worker** — set the Cloudflare tunnel URL, API key, allowed job types, mark active.
2. Restart the dispatcher (`pm2 restart dispatcher` or equivalent). It re-reads `schema.workers` on boot, registers all active workers, and the health monitor begins probing the new worker immediately.
3. Consumer concurrency auto-refreshes from the registry within 5 s — no further action needed.

To remove a worker: mark it inactive in the admin panel, then restart the dispatcher.

Input model: 1 user-uploaded garment + `faceId` + `backgroundId` + `poseId` (all admin-curated) + optional `lowerCatalogId` / `shoeCatalogId`. All IDs must resolve to active catalog/asset rows before credits deduct.

### Shopify theme extension

`apps/shopify-extension/extensions/tryon-theme-extension` ships one **app
block** (`blocks/tryon-button.liquid`, `target: "section"`), which the merchant
drags into their product template. It is not an app embed — an earlier version
was, and it had to relocate itself via guessed CSS selectors, which broke on
every theme switch. App blocks require an Online Store 2.0 (JSON) template;
vintage themes are unsupported.

Modal copy, accent color, and result-step actions come from the
`aivastra.widget_config` shop metafield, written by
`PATCH /v1/shopify/widget-config` and edited on the app's Widget Design page.
Postgres (`shopify_stores.settings.widget`) is authoritative; the metafield is a
cache, and a failed mirror surfaces as `synced: false`.

## Web App Architecture (apps/catalogues-web)

### Auth Flow

Next.js API routes in `apps/catalogues-web/src/app/api/auth/` act as a **BFF (Backend For Frontend)** proxy. They receive auth requests from the browser, call the Fastify API, then set httpOnly cookies via `apps/catalogues-web/src/lib/auth-cookies.ts`. This means:
- Browser never directly calls the Fastify API for auth.
- The `access_token` cookie is set by the Next.js server, not by the client.
- `apps/catalogues-web/src/lib/api.ts` holds the access token in a module-level in-memory variable (never a JS-readable cookie — see SEC-H2 in `docs/progress.md`), seeded via `initToken()` at login, and auto-refreshes on 401 through the httpOnly refresh cookie.

### Route Groups

- `(auth)` — login, register, forgot/reset password, verify email (unauthenticated)
- `(app)` — studio, catalogues, pricing, settings, assets (protected)

The middleware (`apps/catalogues-web/src/middleware.ts`) guards all non-public routes by checking the `access_token` cookie. It also handles redirects for old route names (`/tryon` → `/studio`, `/dashboard` → `/catalogues`, `/jobs` → `/catalogues`).

### Studio Wizard (4-step flow)

`apps/catalogues-web/src/app/(app)/studio/page.tsx` — the core user flow:
- **Step 0** — gender, garment type (from `/v1/models/garment-types?gender=`), publishing platform + aspect ratio, garment upload (direct to R2 via presigned URL from `/v1/uploads/presign`)
- **Step 1** — model/face selection from `/v1/models/faces?gender=&garmentTypeId=`
- **Step 2** — background selection from `/v1/models/backgrounds?faceId=`
- **Step 3** — pose selection from `/v1/models/poses?garmentTypeId=&faceId=&backgroundId=`; lower garment and shoes optional, shown only when selected poses have `hasLower`/`hasShoes` flags

Submit POSTs to `/v1/jobs/tryon`, redirects to `/catalogues/{catalogueId}`.

### Design Tokens

All components use `C` from `apps/catalogues-web/src/components/tokens.ts` — a typed map of CSS variables (e.g. `C.pink`, `C.text`, `C.border`). The gradient is `grad` (pink → amber). Never use raw hex or hardcoded colors; always use tokens.

### `NEXT_PUBLIC_BASE_PATH`

Supports subdirectory deployment (e.g. `/app`). All internal asset references and redirects must account for this. The middleware strips it before route matching.

## Database Schema

### Auth & Users

| Table | Purpose |
|-------|---------|
| `users` | Email/password or Google OAuth users; `tier` (FREE/PRO), ban status, email verification |
| `refresh_tokens` | Family rotation — `familyId`, `generation`, `usedAt`, `revokedAt`. Partial unique index: one active token per family |
| `oauth_accounts` | Google OAuth linkage to `users` rows; `passwordHash` nullable for OAuth-only users |
| `admin_users` | User → admin role mapping (`SUPER_ADMIN`, `MODERATOR`, `SUPPORT`, `ADMIN`) |
| `api_keys` | Developer API keys per merchant — sha256 `keyHash`, display-only `keyPrefix`, revocable |

### Credits & Payments

| Table | Purpose |
|-------|---------|
| `user_credits` | Single-row credit balance per user |
| `credit_ledger` | Immutable credit delta history |
| `credit_requests` | User credit top-up requests |
| `credit_plans` | Admin-defined purchasable credit plans |
| `payments` | Razorpay order/payment records |

### Jobs

| Table | Purpose |
|-------|---------|
| `jobs` | Status, worker, priority, credits charged, attempts, `catalogueId` |
| `job_inputs` | Per-job inputs: garment keys, face/bg/pose IDs, lower/shoe catalogs, `params` JSONB (aspectRatio, resolution, platform) |
| `job_outputs` | Result image key + thumbnail key |
| `job_events` | Debug/audit events (COMFY_DISPATCH, status transitions) |

### Models (Admin-curated assets)

| Table | Purpose |
|-------|---------|
| `model_faces` | Face images — gender, `r2Key`, `thumbnailKey`, `faceSideR2Key` |
| `model_backgrounds` | Backgrounds — `r2Key`, `bgComfyR2Key`, tags, `specialTag`, `genderSlug` |
| `model_poses` | Pose metadata — FK to `workflow_templates`, `hasLower`/`hasShoes` flags |
| `model_pose_assets` | Centralized pose image assets with workflow + prompt bindings |
| `pose_garment_configs` | Per-(pose, garment-type) workflow/prompt overrides |
| `garment_subcategories` | Garment taxonomy (e.g. "Full Sleeve Shirt") with default lower/shoe catalog IDs |
| `workflow_templates` | ComfyUI workflow JSON + node-ID mappings; `workflowType` (`regular`, `widget`, `saree`, `tryon`) |

### Catalog (User-selectable items)

| Table | Purpose |
|-------|---------|
| `catalog_types` | Static types: `lower`, `shoe` |
| `catalog_categories` | Hierarchical categories per type |
| `catalog_items` | Lower garments and shoes — type, `genderSlug`, `r2Key`, `thumbnailKey` |
| `catalog_item_subcategories` | Many-to-many: catalog items → garment subcategories |

### Widget / Merchant

| Table | Purpose |
|-------|---------|
| `merchants` | Merchant profile attached to a `users` row (company, kiosk config, catalogue settings, webhook). One per user; login lives on `users`. No credit balance of its own — merchant spend draws from `user_credits` |
| `merchant_payments` | Merchant-portal Razorpay orders, priced by `MERCHANT_PLAN_BILLING`. Credits land in `user_credits` |
| `kiosk_devices` | Per-merchant kiosk device registrations |
| `shopify_widget_events` | Append-only storefront interaction log (clicks, uploads, result views, add-to-carts, shares, and server-written refusals). Advisory only — never read by a credit, limit, or authorization decision. Swept at a fixed 400 days |

## API Route Modules (`apps/api/src/modules/`)

| Module | Key routes |
|--------|-----------|
| `auth/` | `/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/verify-email`, `/forgot-password`, `/reset-password`, `/request-admin`; mobile variants (`login-mobile`, `refresh-body`, `logout-mobile`) |
| `credits/` | `/v1/credits` balance + ledger; helpers: `atomicDeduct`, `refund`, `adminGrant` |
| `jobs/` | `/v1/jobs/tryon`, `/v1/jobs/*`, `/v1/catalogues`, `/v1/assets`, SSE streams |
| `catalog/` | `/v1/catalog/:type` category tree + items |
| `models/` | `/v1/models/faces`, `/backgrounds`, `/poses`, `/garment-types` |
| `uploads/` | `/v1/uploads/presign` — records `upload:owner:{key}` in Redis (24h TTL) for H2 ownership binding |
| `results/` | `/v1/results/:id` public result access |
| `payments/` | Razorpay order creation + webhook |
| `merchant/` | Merchant self-serve (API key regen, webhook config, credits) |
| `widget/` | Widget job creation, cancellation, ledger |
| `dev/` | `/v1/dev/tryon`, `/v1/dev/jobs/:id`, `/v1/dev/categories`, `/v1/dev/me` — public developer API, API-key authed |
| `shopify/` | OAuth install/callback, merchant `/me` + `/settings` + `/shoppers`, catalog generate/publish, widget-config + republish, onboarding, product sync, customer-facing job creation (`/customer/presign`, `/customer/jobs`), GDPR webhooks; `POST /v1/shopify/customer/event` (public ingest), `GET /v1/shopify/analytics` |
| `admin/` | Full CRUD under `/admin/*` — users, credits, catalog, assets, jobs, workers, config, workflows, widget clients, saree settings |

## Dispatcher Modules (`apps/dispatcher/src/`)

| Module | Files | Purpose |
|--------|-------|---------|
| `stream/` | `loop.ts`, `consumer.ts`, `video-consumer.ts`, `recovery.ts`, `sweeper.ts` | `runStreamLoop` (shared read→dispatch loop); GPU consumer over `jobs:priority\|normal\|low` capped by worker-registry size; video consumer over `jobs:video` capped by `VIDEO_CONCURRENCY`; startup `XPENDING` recovery; stuck-job sweeper |
| `job/` | `processor.ts`, `state.ts` | Main job processor; status transitions; `processTryonJob`, `processSareeJob`, `processWidgetJob` |
| `workflow/` | `patcher.ts`, `resize-to-max.ts` | Clone + patch workflow templates; aspect-ratio sizing; dual-size group support |
| `comfyui/` | `client.ts`, `progress.ts` | ComfyUI HTTP client, WebSocket progress, `/history` polling |
| `worker/` | `registry.ts`, `selector.ts`, `health-monitor.ts` | Redis worker registry, IDLE selection, 15s health probes with 30s TTL |
| `health/` | `server.ts` | HTTP health endpoint on `DISPATCHER_HEALTH_PORT` |

## Models Module vs Catalog Module

These are two distinct concepts — do not conflate:

| Module | What it is | DB tables |
|--------|-----------|-----------|
| **models** (`/v1/models/*`) | Admin-curated face/pose/background assets used as inputs to ComfyUI | `model_faces`, `model_backgrounds`, `model_poses`, `garment_subcategories`, `workflow_templates` |
| **catalog** (`/v1/catalog/*`) | User-selectable lower garments and shoes from R2 catalog | `catalog_types`, `catalog_categories`, `catalog_items` |

### Pose ↔ Workflow Template Relationship

Each `model_pose` row has an optional `workflowTemplateId` FK into `workflow_templates`. The template row stores ComfyUI node IDs (`lowerNodeId`, `shoeNodeId`, `sizeNodeId`, etc.) that the dispatcher patches at runtime. Poses expose `hasLower` / `hasShoes` flags to the frontend based on whether these node IDs are non-null.

When adding a new pose in admin, it must be linked to a workflow template. The template determines what inputs that pose supports.

## Testing Architecture (Critical)

**No testcontainers.** Integration tests reuse the docker-compose Postgres/Redis/MinIO running on localhost. `pnpm docker:up` must be running before any `pnpm test`.

Each test file (harness in `apps/api/test/helpers/containers.ts`):
1. Creates a **fresh Postgres database** via `CREATE DATABASE` with a random name
2. Runs Drizzle migrations against it
3. Creates a **fresh MinIO bucket** with a random name
4. Drops both in `afterAll`

API test harness (`apps/api/test/helpers/api.ts`): `buildTestApp()` calls `app.listen({ port: 0 })` → ephemeral port from `app.server.address()`. Use raw `node:http` for SSE tests — Fastify `inject()` hangs on streaming responses.

**Gotchas:**
- `testcontainers` package is installed but unused (abandoned due to MinIO startup issues on Windows). Do not reintroduce it.
- Catalog integration tests seed `catalog_types` with `slug: 'models'` — use unique slugs if tests share the same Postgres process.

## Admin Mobile Paused

Admin mobile development is paused until the product is finalised. Treat `apps/admin-mobile` as out of active scope: do not update it, test it, typecheck it, parity-check it against `apps/admin-web`, or factor it into task completion criteria unless a task explicitly reactivates admin-mobile work.

## Invariants (do not break)

- Credit deduct + job insert must be one Postgres transaction. Refund on terminal failure is also transactional.
- Catalog ID → R2 key resolution happens in api before enqueue. Dispatcher trusts the resolved keys on the `job_inputs` row.
- ComfyUI workflow templates are stored in `workflow_templates.jsonContent` (Postgres); never inline-mutate, always `structuredClone` + patch.
- Postgres and Redis bind to `127.0.0.1` only.
- All `/admin/*` routes double-check admin role: JWT claim AND `admin_users` row lookup.
- User hint field (300 char max) goes through sanitization before reaching the workflow prompt.
- `@aivastra/db` exports `* as schema` from `packages/db/src/index.ts` — do not add a duplicate `schema` re-export.
- Never run schema/migration work (`pnpm db:generate`, manual `drizzle-kit` snapshot surgery, one-off `psql`/`ts-node` data fixes) directly against the production VPS or `tryon_prod`. Do it against a local/staging DB and ship it through the normal push → CI/CD → `db:migrate:prod` path. An incident on 2026-07-27 wiped `garment_subcategories.default_lower_catalog_id`/`default_shoe_catalog_id` for ~89 of 90 rows during exactly this kind of ad-hoc live-production session; the trigger was never conclusively identified because there was no audit trail. `PATCH /admin/assets/garment-types/:id` now logs `adminUserId`/`garmentTypeId`/changed field keys (`apps/api/src/modules/admin/subcategories.routes.ts`) so a repeat is traceable via Grafana/Loki — that only covers requests through the API, not direct DB access.

## Environment Variables

Key vars (see `.env.production.example` for full list):

| Var | Used by |
|-----|---------|
| `DATABASE_URL` | api, dispatcher, db package |
| `REDIS_URL` | api, dispatcher |
| `JWT_SECRET` / `COOKIE_SECRET` | api |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | api, dispatcher |
| `R2_PUBLIC_PRESIGN_BASE` | api (browser-side presigned URL base) |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | api (seeds first admin) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | api (optional OAuth) |
| `RESEND_API_KEY` / `EMAIL_FROM` | api (transactional email) |
| `WORKER_API_KEY` | dispatcher |
| `PIXVERSE_API_KEY`, `PIXVERSE_API_BASE_URL`, `PIXVERSE_POLL_INTERVAL_MS`, `PIXVERSE_POLL_TIMEOUT_MS` | dispatcher (catalog video) |
| `VIDEO_CONCURRENCY` | dispatcher — in-flight cap for `jobs:video`, independent of GPU worker count; match the PixVerse plan limit (default 5) |
| `NEXT_PUBLIC_API_URL` | web (Fastify API base URL, default `http://localhost:4000`) |
| `NEXT_PUBLIC_BASE_PATH` | web (subdirectory prefix, e.g. `/app`; empty in root deploy) |

In dev, `R2_*` vars point to MinIO at `http://127.0.0.1:9000`.

## Migration Index Conflicts (diverged branches)

When pulling from `origin/master` onto a feature branch that added migrations, index collisions can occur if both sides independently picked the same next index.

**Detection:** Before merging, run:
```bash
git diff --name-only HEAD..origin/master -- packages/db/src/migrations/
```
If `origin/master` has a `0063_*.sql` and so does your branch, you have a collision.

**Resolution order:**
1. Check the highest index on `origin/master`: `git show origin/master:packages/db/src/migrations/meta/_journal.json | python3 -m json.tool | grep '"idx"' | tail -3`
2. Rename your local migration files to start after that: `git mv 0063_foo.sql 0064_foo.sql`
3. Do the merge: `git merge origin/master`
4. In `_journal.json`, resolve the conflict so server entries come first, then yours at the bumped indices
5. `git add` renamed files + journal, then `git merge --continue`
6. Run `pnpm db:migrate` — NOTICE "already exists" is safe; it means local DB already has the table
7. **If `pnpm db:migrate` silently skips a migration** (Drizzle gap problem): happens when earlier-index hash is missing but later-index hashes are already recorded. Apply it manually:
   ```ts
   // packages/db/apply-one.ts (delete after use)
   import postgres from 'postgres';
   import { createHash } from 'crypto';
   import { readFileSync } from 'fs';
   const sql = postgres(process.env.DATABASE_URL!);
   const migSql = readFileSync('/abs/path/to/NNNN_migration.sql', 'utf8');
   const hash = createHash('sha256').update(migSql).digest('hex');
   await sql.begin(async tx => {
     await tx.unsafe(migSql);
     await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${Date.now()})`;
   });
   await sql.end();
   ```
   Then run it: `node_modules/.bin/tsx --env-file=.env packages/db/apply-one.ts`

**Rule:** Server's migration index is canonical. Your branch always yields and renumbers upward.

## Git Commit & Push Policy

**Only commit and push when a meaningful unit of work is complete.**

Commit when: a full feature works end-to-end, a bug is fixed and verified, a migration + its API/UI changes are done together, or a multi-file refactor is complete.

Do NOT commit for: single CSS changes, label/copy tweaks, one-liners that are part of a larger in-progress task.

## Progress Tracking

After every plan execution, update `docs/progress.md`:
- **Done** — completed work
- **Failed / Not Done** — skipped, blocked, or broken
- **Open Questions / Decisions** — unresolved choices affecting next steps

Add a new dated entry at the top of the log.

## Key Files — Read Before Touching

| Area | File |
|------|------|
| API wiring | `apps/api/src/server.ts` |
| API env validation | `apps/api/src/env.ts` |
| Job creation (credit + enqueue) | `apps/api/src/modules/jobs/create.ts` |
| Auth routes | `apps/api/src/modules/auth/routes.ts` |
| Auth service (JWT, argon2) | `apps/api/src/modules/auth/service.ts` |
| Auth preHandler plugin | `apps/api/src/plugins/auth.ts` |
| DB factory + schema re-export | `packages/db/src/index.ts` |
| DB schema (by domain) | `packages/db/src/schema/*.ts` |
| Shared Zod types | `packages/types/src/*.ts` |
| Storage provider + key builders | `packages/storage/src/r2.ts`, `packages/storage/src/keys.ts` |
| Dispatcher entry | `apps/dispatcher/src/index.ts` |
| Job processor | `apps/dispatcher/src/job/processor.ts` |
| Stream consumer | `apps/dispatcher/src/stream/consumer.ts` |
| Workflow patcher | `apps/dispatcher/src/workflow/patcher.ts` |
| Web middleware (auth guard) | `apps/catalogues-web/src/middleware.ts` |
| Web API client (token refresh) | `apps/catalogues-web/src/lib/api.ts` |
| Admin app root | `apps/admin-web/src/App.tsx` |
| Design doc | `docs/virtual-tryon-system-design.md` |
| Open findings backlog | `docs/audits/open-findings.md` |

## Reference

Design doc sections worth re-reading before related work: §2 Tunnel, §3 Catalog model, §4 Dispatcher routing, §5 Admin surface, §6 DB schema, §11 Security layers.
