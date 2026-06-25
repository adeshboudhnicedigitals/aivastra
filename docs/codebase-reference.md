# Aivastra Codebase Reference

> Internal reference document describing the structure, architecture, and conventions of the Aivastra monorepo. Generated from direct source analysis on 2026-06-24.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Technology Stack](#technology-stack)
4. [Monorepo Layout](#monorepo-layout)
5. [Shared Packages](#shared-packages)
6. [Database Schema](#database-schema)
7. [API Service (`apps/api`)](#api-service-appsapi)
8. [Dispatcher Service (`apps/dispatcher`)](#dispatcher-service-appsdispatcher)
9. [Web Frontend (`apps/web`)](#web-frontend-appsweb)
10. [Admin SPA (`apps/admin`)](#admin-spa-appsadmin)
11. [Admin Mobile (`apps/admin-mobile`)](#admin-mobile-appsadmin-mobile)
12. [Testing Architecture](#testing-architecture)
13. [Environment Variables](#environment-variables)
14. [Infrastructure & Deployment](#infrastructure--deployment)
15. [Development Workflow](#development-workflow)
16. [Security & Invariants](#security--invariants)
17. [Current State & Phases](#current-state--phases)
18. [Appendix: Key Files](#appendix-key-files)

---

## Project Overview

Aivastra is an AI-powered virtual try-on platform for fashion brands. Users upload garment images, select curated model assets (face, pose, background) and optional lower garments / shoes, and receive AI-generated model catalogue images produced by ComfyUI running on GPU workers.

The codebase is a **pnpm workspace monorepo** with a hard service boundary at the Redis Stream: the API never talks to ComfyUI; only the dispatcher does.

### High-Level Flow

```
User → Next.js web → Fastify API → PostgreSQL (validate + deduct credits)
                                          ↓
                                   Redis Stream (jobs:priority / jobs:normal)
                                          ↓
                              Dispatcher → ComfyUI Worker (GPU VPS)
                                          ↓
                                   R2/MinIO (outputs) + PostgreSQL (status)
                                          ↓
                              SSE → Web / Admin UI
```

---

## Architecture at a Glance

| Service | Path | Responsibility |
|---------|------|----------------|
| **Web** | `apps/web` | Next.js 15 user-facing frontend (auth, studio, catalogues, pricing, settings) |
| **Admin** | `apps/admin` | Vite + React internal admin panel (assets, users, jobs, workflows, config) |
| **Admin Mobile** | `apps/admin-mobile` | Expo SDK 53 React Native app for admins on Android |
| **API** | `apps/api` | Fastify 5 REST API — auth, credits, catalog, jobs, admin, merchant, widget |
| **Dispatcher** | `apps/dispatcher` | Redis Stream consumer — routes jobs to GPU workers and handles ComfyUI lifecycle |
| **DB** | `packages/db` | Drizzle ORM schema + migrations + `createDb()` factory |
| **Types** | `packages/types` | Shared Zod schemas (single source of truth for request/response shapes) |
| **Storage** | `packages/storage` | `StorageProvider` interface + R2/MinIO implementation + key builders |
| **Logger** | `packages/logger` | pino wrapper with redaction rules |
| **Observability** | `packages/observability` | Prometheus metrics registry shared by API and dispatcher |

---

## Technology Stack

- **Runtime:** Node.js 20+, TypeScript 5.6, ESM only (`"type": "module"` everywhere)
- **Package Manager:** pnpm 9+ workspaces, hoisted linker (`nodeLinker: hoisted`)
- **API:** Fastify 5 + `fastify-type-provider-zod` + ioredis + Drizzle ORM
- **Frontend Web:** Next.js 15 App Router, React 19, Tailwind CSS 3, TanStack React Query
- **Admin SPA:** Vite 6, React 18, React Router DOM 6
- **Admin Mobile:** Expo SDK 53, React Native 0.79, React 19, Expo Router 5
- **Database:** PostgreSQL 16
- **Queue/Cache:** Redis 7 Streams + Pub/Sub
- **Storage:** S3-compatible — Cloudflare R2 in production, MinIO locally
- **GPU Workers:** ComfyUI on Hostinger VPS A100 via Cloudflare Tunnel
- **Lint/Format:** Biome 2.4
- **Tests:** Vitest
- **Email:** Resend
- **Payments:** Razorpay
- **Monitoring:** Prometheus metrics + Grafana Alloy (optional) + Sentry

---

## Monorepo Layout

```
webtool/
├── apps/
│   ├── api/                 # Fastify 5 REST API
│   ├── dispatcher/          # Redis Stream consumer for ComfyUI workers
│   ├── web/                 # Next.js 15 user frontend
│   ├── admin/               # Vite + React admin SPA
│   └── admin-mobile/        # Expo React Native admin app
├── packages/
│   ├── db/                  # Drizzle schema + migrations
│   ├── types/               # Shared Zod schemas
│   ├── storage/             # R2/MinIO provider
│   ├── logger/              # pino wrapper
│   └── observability/       # Prometheus metrics
├── infra/
│   ├── docker-compose.yml   # Postgres + Redis + MinIO (+ optional apps/alloy)
│   ├── cloudflared/         # Tunnel config templates
│   └── observability/       # Alloy config + dashboard JSON
├── scripts/                 # Ops scripts (seed-catalog, backfill-thumbnails)
├── templates/               # ComfyUI workflow JSON (untracked in git)
├── docs/                    # Design docs, phase plans, progress log
├── package.json             # Root workspace scripts
├── pnpm-workspace.yaml      # Workspace globs + overrides
├── tsconfig.base.json       # Shared TS config
├── biome.json               # Lint/format rules
└── .env.example             # Full env template
```

### Root Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Run all services in parallel |
| `pnpm build` | Typecheck + build all packages/apps |
| `pnpm typecheck` | Type-check all |
| `pnpm lint` / `pnpm lint:fix` | Biome check/fix |
| `pnpm test` | Run all tests |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop local infra |
| `pnpm docker:reset` | Tear down + delete volumes |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Apply migrations |
| `pnpm seed:catalog` | Seed catalog data |

---

## Shared Packages

### `@aivastra/db`

- **Entry:** `packages/db/src/index.ts`
- **Exports:** `createDb(url)`, `schema` namespace, `and`, `eq`, `inArray`, `or`, `sql`
- **Schema:** `packages/db/src/schema/` split by domain (`admin.ts`, `catalog.ts`, `credits.ts`, `jobs.ts`, `models.ts`, `users.ts`, `widget.ts`)
- **Migrations:** `packages/db/src/migrations/` — 59 numbered SQL files (0000–0058) plus Drizzle journal
- **Migration runner:** `packages/db/src/migrate.ts` uses `drizzle-orm/postgres-js/migrator`

Important invariant: `@aivastra/db` exports `* as schema` — do not add a duplicate `schema` re-export anywhere.

### `@aivastra/types`

- **Entry:** `packages/types/src/index.ts`
- Pure Zod schemas, no runtime deps except `zod`
- Files: `auth.ts`, `catalog.ts`, `common.ts`, `credits.ts`, `jobs.ts`, `admin.ts`, `widget.ts`
- Also builds a CJS version (`build:cjs`) for Metro bundler compatibility in admin-mobile

### `@aivastra/storage`

- **Entry:** `packages/storage/src/index.ts`
- `StorageProvider` interface: `presignPut`, `presignGet`, `deleteObject`, `putObject`, `getObject`, `headObject`, `publicUrl`
- `createR2Provider(cfg)` — AWS SDK S3 client with presigned URL generation
- `keys` — R2 key builders (`inputs/{jobId}/garment.jpg`, `outputs/{jobId}/result.png`, `catalog/...`, `models/...`)
- Supports `presignBaseUrl` to rewrite internal MinIO endpoint to public HTTPS domain

### `@aivastra/logger`

- **Entry:** `packages/logger/src/index.ts`
- `createLogger(service, extra?)` returns pino logger
- Redacts passwords, tokens, secrets, authorization headers, cookies, R2 keys, JWT secret
- Pretty transport in development, JSON in production

### `@aivastra/observability`

- **Entry:** `packages/observability/src/index.ts`
- Single Prometheus registry shared across API and dispatcher
- Metrics: `http_request_duration_seconds`, `jobs_created_total`, `credits_deducted_total`, `credits_refunded_total`, `jobs_processed_total`, `job_processing_duration_seconds`, `job_attempts_total`, `comfy_request_duration_seconds`, `queue_depth`, `workers_healthy`

---

## Database Schema

### Core Tables

| Table | Domain | Purpose |
|-------|--------|---------|
| `users` | Auth | Email/password or Google OAuth users, tier, ban status, email verification |
| `refresh_tokens` | Auth | Token family rotation (`familyId`, `generation`, `usedAt`, `revokedAt`) |
| `oauth_accounts` | Auth | Google OAuth linkage |
| `admin_users` | Admin | User → admin role mapping (`SUPER_ADMIN`, `MODERATOR`, `SUPPORT`, `ADMIN`) |
| `user_credits` | Credits | Single-row credit balance per user |
| `credit_ledger` | Credits | Immutable credit delta history |
| `credit_requests` | Credits | User credit top-up requests |
| `credit_plans` | Credits/Payments | Admin-defined purchasable credit plans |
| `payments` | Payments | Razorpay order/payment records |
| `jobs` | Jobs | Job status, worker, priority, credits charged, attempts, widget linkage |
| `job_inputs` | Jobs | Per-job inputs: garment keys, face/bg/pose IDs, lower/shoe catalogs, params |
| `job_outputs` | Jobs | Result image key + thumbnail key |
| `job_events` | Jobs | Debug/audit events (COMFY_DISPATCH, status transitions, etc.) |
| `model_faces` | Models | Curated face images (gender, r2Key, thumbnailKey, faceSideR2Key) |
| `model_backgrounds` | Models | Curated backgrounds (r2Key, bgComfyR2Key, tags, specialTag, genderSlug) |
| `model_pose_assets` | Models | Centralized pose image assets with workflow + prompt bindings |
| `pose_garment_configs` | Models | Per-(pose, garment-type) workflow/prompt overrides |
| `garment_subcategories` | Models | Garment taxonomy (e.g. "Full Sleeve Shirt") with default lower/shoe catalog IDs |
| `workflow_templates` | Models | ComfyUI workflow JSON + node-ID mappings for patching |
| `catalog_types` | Catalog | Static types: lower, shoe |
| `catalog_categories` | Catalog | Hierarchical categories per type |
| `catalog_items` | Catalog | Lower garments and shoes (type, genderSlug, r2Key, thumbnailKey) |
| `catalog_item_subcategories` | Catalog | Many-to-many: catalog items → garment subcategories |
| `widget_clients` | Widget | Merchant signup records, widget key, allowed origins |
| `widget_client_credits` | Widget | Per-merchant credit balance |
| `widget_credit_ledger` | Widget | Merchant credit delta history |

### Key Schema Details

- **Users:** `passwordHash` is nullable (Google-only users). `tier` is `FREE` or `PRO`. `PRO` users enqueue to `jobs:priority`.
- **Refresh tokens:** Family rotation with `usedAt`/`revokedAt`. Partial unique index ensures one active token per family.
- **Jobs:** `catalogueId` groups multiple pose jobs under one catalogue. `widgetClientId` routes to the widget processor.
- **Job inputs:** `params` JSONB stores `aspectRatio`, `resolution`, `platform`, optional seeds/steps/dimensions.
- **Workflow templates:** Store ComfyUI JSON plus node IDs for face, pose, bg, upper, lower, shoe, size, result, and prompt nodes. Supports both regular and widget workflow types.
- **Pose assets:** `model_pose_assets` is the single source of truth for pose images. `pose_garment_configs` allows per-garment-type overrides.

---

## API Service (`apps/api`)

### Entry Points

- **Main:** `apps/api/src/main.ts` — loads env, builds server, bootstraps first admin from `ADMIN_BOOTSTRAP_EMAIL/PASSWORD`
- **Server builder:** `apps/api/src/server.ts` — registers plugins, routes, error handler, health check
- **Env:** `apps/api/src/env.ts` — Zod-validated environment

### Plugins (`apps/api/src/plugins/`)

| Plugin | Purpose |
|--------|---------|
| `auth.ts` | `requireUser` / `requireAdminUser` decorators; JWT verify; email verification check |
| `widget-auth.ts` | `requireWidgetClient` (X-Widget-Key) / `requireMerchant` decorators |
| `db.ts` | Adds `app.db` via `createDb()` |
| `redis.ts` | Adds `app.redis` (main) + `app.redisSub` (pub/sub) |
| `storage.ts` | Adds `app.storage` R2 provider |
| `metrics.ts` | Records HTTP duration; exposes `/metrics` |
| `sentry.ts` | Sentry error tracking init |

### Route Modules (`apps/api/src/modules/`)

| Module | Key Routes / Responsibilities |
|--------|------------------------------|
| `auth/` | `/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/verify-email`, `/forgot-password`, `/reset-password`, `/request-admin`, mobile auth endpoints (`login-mobile`, `refresh-body`, `logout-mobile`) |
| `credits/` | `/v1/credits` balance + ledger; `atomicDeduct`, `refund`, `adminGrant` helpers |
| `jobs/` | `/v1/jobs/tryon`, `/v1/jobs/*`, `/v1/catalogues`, `/v1/assets`, SSE streams |
| `catalog/` | `/v1/catalog/:type` category tree + items |
| `models/` | `/v1/models/faces`, `/backgrounds`, `/poses`, `/garment-types` |
| `uploads/` | `/v1/uploads/presign` for direct-to-R2 garment uploads |
| `results/` | `/v1/results/:id` public result access |
| `payments/` | Razorpay order creation + webhook |
| `merchant/` | Merchant/widget client routes |
| `widget/` | Widget job creation + ledger |
| `admin/` | Full admin CRUD under `/admin/*` (users, credits, catalog, assets, jobs, workers, config, workflows, widget clients) |

### Job Creation Flow (`apps/api/src/modules/jobs/create.ts`)

1. Validate caller owns the garment upload key (`upload:owner:{key}` in Redis + HEAD size check).
2. Validate face/background/pose IDs are active.
3. For Amazon platform, override background with configured white background.
4. Resolve per-pose workflow requirements (lower/shoe nodes) and enforce inputs.
5. In a single Postgres transaction per pose:
   - Insert `jobs` row
   - Atomically deduct credits (`UPDATE user_credits SET balance = balance - cost WHERE balance >= cost`)
   - Insert `job_inputs` row with only workflow-relevant fields
6. Enqueue each job to `jobs:priority` (PRO) or `jobs:normal` via `XADD`.
7. Refund any jobs that fail to enqueue and mark them `FAILED`.

Credit costs per resolution: HD=25, 2K=35, 4K=40.

### Authentication Details

- Access tokens are JWT HS256, 15-minute expiry, passed in `Authorization: Bearer` header only.
- Admin tokens have audience `admin`; user routes reject admin-portal tokens.
- Refresh tokens are SHA256-hashed, rotated on use, stored in httpOnly cookie for web.
- Mobile auth returns access + refresh tokens in JSON body (`login-mobile`, `refresh-body`).
- Password hashing: Argon2id (memoryCost 19456, timeCost 2, parallelism 1).

---

## Dispatcher Service (`apps/dispatcher`)

### Entry Point

- **Main:** `apps/dispatcher/src/index.ts` — loads env, connects DB/Redis/S3, registers workers, runs health checks, starts consumer and health server
- **Env:** `apps/dispatcher/src/env.ts` — worker IDs, URLs, API keys, Redis, DB, R2, optional widget ComfyUI URL

### Modules

| Module | Files | Purpose |
|--------|-------|---------|
| `stream/` | `consumer.ts`, `recovery.ts` | Redis Stream `XREADGROUP` consumer group `dispatcher-cg`; startup `XPENDING` recovery |
| `job/` | `processor.ts`, `state.ts` | Main job processor; job status transitions |
| `workflow/` | `patcher.ts`, `patcher.test.ts`, `resize-to-max.ts` | Clone + patch workflow templates; aspect-ratio sizing |
| `comfyui/` | `client.ts`, `progress.ts` | ComfyUI HTTP client, WebSocket progress, history polling |
| `worker/` | `registry.ts`, `selector.ts`, `health-monitor.ts` | Worker registry, IDLE worker selection, health probes |
| `health/` | `server.ts` | HTTP health server on `DISPATCHER_HEALTH_PORT` |
| `lib/` | `db.ts`, `redis.ts`, `storage.ts` | Factories for DB, Redis, storage |

### Consumer Behavior

- Two streams: `jobs:priority` (drained first, non-blocking) and `jobs:normal` (blocking 2s read).
- Consumer group: `dispatcher-cg`, consumer name = hostname.
- Concurrency defaults to worker count; caps in-flight jobs.
- `XACK` only after terminal state (`COMPLETED` or `FAILED` after max retries).

### Job Processing Flow

1. Load `jobs` + `job_inputs`.
2. If `widgetClientId` set → route to dedicated widget ComfyUI processor.
3. Resolve IDs to R2 keys (face side, bg comfy, pose, lower/shoe catalog).
4. Select healthy IDLE worker from Redis registry; mark BUSY.
5. Download images from R2, upload to ComfyUI `/upload/image`.
6. Clone workflow template, patch node inputs, submit `/prompt`.
7. Wait for completion via WebSocket (regular) or `/history` polling (widget).
8. Download output, upload to R2 (`outputs/{jobId}/result.png`), generate 512px JPEG thumbnail.
9. Mark `COMPLETED`, publish SSE event, `XACK`, mark worker IDLE.
10. On failure: increment attempts; retry once by re-enqueuing; refund credits on terminal failure.

### Worker Health

- Health monitor probes each worker's `/system_stats` every 15s.
- Stores `worker:health:{id}` with 30s TTL.
- Registry stored in Redis hash `worker:registry` with status (`IDLE`, `BUSY`, `DRAINING`, `OFFLINE`).

---

## Web Frontend (`apps/web`)

### Stack

- Next.js 15 App Router, React 19, Tailwind CSS 3, TanStack React Query, React Hook Form + Zod
- `NEXT_PUBLIC_API_URL` points to Fastify API
- `NEXT_PUBLIC_BASE_PATH` supports subdirectory deployment

### Route Groups (`apps/web/src/app/`)

| Group | Routes |
|-------|--------|
| `(auth)` | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` |
| `(app)` | `/studio`, `/catalogues`, `/pricing`, `/settings`, `/assets` |
| `(merchant)` | `/merchant/signup`, `/merchant/login`, `/merchant/*` |
| `(widget)` | `/widget/*` |
| `api/auth/*` | BFF proxy for auth cookies |
| `api/merchant/*` | BFF proxy for merchant auth |

### Auth Pattern

- Next.js API routes act as BFF: receive browser requests, call Fastify API, set httpOnly `access_token` and `refresh` cookies via `apps/web/src/lib/auth-cookies.ts`.
- Client-side `lib/api.ts` reads `access_token` from `document.cookie`, auto-refreshes on 401 using single-flight dedup, and uses `BroadcastChannel` to sync across tabs.
- `middleware.ts` protects routes, handles redirects (`/tryon` → `/studio`, `/dashboard` → `/catalogues`, etc.), and performs silent refresh server-side.

### Studio Wizard (`apps/web/src/app/(app)/studio/`)

Four-step flow:

1. **Step 0** — Gender, garment type, platform + aspect ratio, garment upload (direct to R2 via presigned URL)
2. **Step 1** — Model/face selection
3. **Step 2** — Background selection
4. **Step 3** — Pose selection; optional lower garment / shoes when pose workflow supports them

Submit to `/v1/jobs/tryon`, redirect to `/catalogues/{catalogueId}`.

### Design System

- Tokens in `apps/web/src/components/tokens.ts` — typed CSS variable map (colors, spacing, radius).
- No raw hex; always use tokens.
- Gradient `grad` is pink → amber.

---

## Admin SPA (`apps/admin`)

### Stack

- Vite 6, React 18, React Router DOM 6
- Built as standalone SPA; production base path `/panel/` to avoid collision with `/admin/*` API routes

### Pages (`apps/admin/src/pages/`)

| Page | Purpose |
|------|---------|
| `DashboardPage` | Stats, workers, recent failures, stuck jobs |
| `AssetsPage` | Faces, backgrounds, garment types, poses, pose assets, bulk ZIP import |
| `UsersPage` | User list, search, ban/unban, tier, credit grant/deduct |
| `JobsPage` | All jobs, filters, retry/cancel, job detail |
| `CatalogPage` | Lower garments + shoes management |
| `WorkflowsPage` | Workflow templates upload, node mapping, status |
| `RecycleBinPage` | Soft-deleted faces/backgrounds/pose assets restore/permanent delete |
| `SettingsPage` | Theme toggle, system config (credit cost, max jobs/day), credit plans |
| `WidgetClients` / `WidgetClientDetail` | Merchant/widget client management |
| `LoginPage` | Admin login |

### Auth

- Uses same users table but requires active `admin_users` row.
- JWT stored in memory; API calls use `Authorization: Bearer`.

---

## Admin Mobile (`apps/admin-mobile`)

### Stack

- Expo SDK 53, React Native 0.79, React 19, Expo Router 5
- Zustand for auth/theme state
- Body-based tokens (`login-mobile`, `refresh-body`) because mobile cannot read httpOnly cookies
- `@aivastra/types` consumed via CJS build for Metro compatibility

### Structure

```
apps/admin-mobile/src/
├── app/           # Expo Router file-system routes
├── components/    # Reusable UI components
├── hooks/         # useApi, useSSE, pagination hooks
├── lib/           # api fetch, SSE reader, formatters, roles
├── store/         # Zustand auth + theme stores
├── styles/        # Theme tokens
└── types.ts       # Shared admin domain types
```

### Implemented Phases

Per `docs/progress.md`, the mobile app has completed Phases 1–8:
- Auth, dashboard, jobs list/detail with SSE, users, assets (faces/backgrounds/garment-types/poses/pose assets), catalog, workflows/recycle bin, settings/config/workers/credit plans.

---

## Testing Architecture

### No Testcontainers

Integration tests reuse the docker-compose Postgres/Redis/MinIO already running on `127.0.0.1`. `pnpm docker:up` must be running before `pnpm test`.

### Per-Test Isolation

Each integration test file:

1. Creates a fresh Postgres database via `CREATE DATABASE` with random suffix.
2. Runs Drizzle migrations against it.
3. Creates a fresh MinIO bucket with random suffix.
4. Tears down both in `afterAll`.

### Harness Files

- `apps/api/test/helpers/containers.ts` — DB + MinIO setup/teardown
- `apps/api/test/helpers/api.ts` — `buildTestApp()` starts Fastify on ephemeral port
- SSE tests use raw `node:http` because Fastify `inject()` hangs on streaming responses.

### Test Commands

```bash
pnpm --filter @aivastra/api test           # full API integration suite
pnpm --filter @aivastra/api test -- <pattern>  # single test by name
pnpm --filter @aivastra/<pkg> test         # per-package tests
```

---

## Environment Variables

Key variables (see `.env.example` for full list):

| Variable | Used By | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | api, dispatcher, db | PostgreSQL connection |
| `REDIS_URL` | api, dispatcher | Redis connection |
| `JWT_SECRET` | api | HS256 signing key (min 32 chars) |
| `COOKIE_SECRET` | api | Fastify cookie plugin secret |
| `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_URL` | api, dispatcher | S3-compatible storage |
| `R2_PUBLIC_PRESIGN_BASE` | api | Public base URL for browser presigned uploads |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | api | Seed first super admin |
| `WORKER_IDS` | dispatcher | Comma-separated worker IDs |
| `WORKER_API_KEY` / `WORKER_<ID>_URL` / `WORKER_<ID>_API_KEY` | dispatcher | Per-worker routing + auth |
| `WIDGET_COMFYUI_URL` / `WIDGET_COMFYUI_BASIC_AUTH` | dispatcher | Dedicated widget ComfyUI instance |
| `NEXT_PUBLIC_API_URL` | web | Fastify API base URL |
| `NEXT_PUBLIC_BASE_PATH` | web | Subdirectory prefix (e.g. `/app`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | api | Google OAuth |
| `RESEND_API_KEY` / `EMAIL_FROM` | api | Transactional email |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | api | Payments |
| `SENTRY_DSN` | api, dispatcher | Error tracking |
| `GRAFANA_CLOUD_*` | alloy | Logs/metrics shipping (optional) |

---

## Infrastructure & Deployment

### Local Dev (`infra/docker-compose.yml`)

Services:
- `postgres:16-alpine` on `127.0.0.1:5432`
- `redis:7-alpine` on `127.0.0.1:6379`
- `minio/minio` API on `127.0.0.1:9000`, console on `127.0.0.1:9001`
- `minio-bootstrap` creates bucket, sets public download policy, sets CORS rules
- Optional `api` and `dispatcher` containers (`--profile apps`)
- Optional `alloy` observability agent (`--profile observability`)

### Production

- Main VPS runs CloudPanel + nginx.
- Next.js web on port 3000, admin SPA served as static under `/panel/`, Fastify API on port 4000.
- ComfyUI workers on Hostinger GPU VPS behind Cloudflare Tunnel.
- Dispatcher runs as a separate process/container, talks to workers via tunnel hostnames.
- Storage: Cloudflare R2 (not MinIO).

### CI/CD

- GitHub Actions: lint, typecheck, test in parallel.
- Deploy workflow: git pull on VPS, build images, docker compose up.
- Lefthook: pre-commit staged file checks; pre-push lint + typecheck + unit tests.

---

## Development Workflow

### First-Time Setup

```bash
cp .env.example .env
pnpm install
pnpm docker:up
pnpm db:generate
pnpm db:migrate
```

### Running Services

```bash
pnpm dev                                  # all services
pnpm --filter @aivastra/api dev           # API only
pnpm --filter @aivastra/dispatcher dev    # dispatcher only
pnpm --filter @aivastra/web dev           # web only
pnpm --filter @aivastra/admin dev         # admin SPA only
```

### Adding Migrations

```bash
pnpm db:generate   # after schema changes
pnpm db:migrate    # apply
```

`drizzle-kit generate` needs `DATABASE_URL` set.

### Code Style

- Biome: 2-space indent, single quotes, trailing commas, semicolons, 100-char line width.
- ESM everywhere.
- No `console.log` in committed code — use `req.log.child({ jobId, userId })`.

---

## Security & Invariants

### Hard Invariants

1. **Credit deduct + job insert must stay in one Postgres transaction.** Refund on terminal failure is also transactional.
2. **Catalog ID → R2 key resolution happens in API before enqueue.** Dispatcher trusts resolved keys on `job_inputs`.
3. **All `/admin/*` routes check `admin_users` row after JWT verify.**
4. **API never talks to ComfyUI.** Only dispatcher does.
5. **Access tokens travel in `Authorization` header only** — never query string.
6. **Postgres and Redis bind `127.0.0.1` only** in production.
7. **User hint is sanitized** (`promptGuard`) before reaching workflow prompt; max 300 chars.
8. **R2 garment upload keys are ownership-bound** in Redis (`upload:owner:{key}`) and verified server-side.

### Security Measures

- Argon2id password hashing.
- Refresh token family rotation with theft detection.
- Rate limiting (`@fastify/rate-limit`) on auth and sensitive endpoints.
- Helmet CSP configured with R2 origin.
- CORS credentials restricted to `CORS_ORIGIN`.
- Presigned PUT URLs omit `Content-Length` to avoid signature mismatch.
- File extension derivation from allow-list only in dispatcher.
- Sentry DSN and secrets redacted from logs.

---

## Current State & Phases

Per `CLAUDE.md` and `docs/PHASES.md`:

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Foundations | ✅ Done | Monorepo, DB schema, docker infra |
| Phase 1 — Backend API | ✅ Done | Auth, credits, catalog, admin, jobs |
| Phase 2 — Dispatcher | ✅ Done | Redis consumer, worker routing, ComfyUI pipeline |
| Phase 3 — Next.js frontend | 🟡 Partially done | Studio, catalogues, pricing, settings functional; ongoing polish |
| Phase 4 — E2E integration + real ComfyUI template | 🟡 In progress | Real workers deployed; template versioning active |

### Recent Major Work (from `docs/progress.md`)

- Refresh token family rotation with concurrent-tab handling (migration 0032).
- Email verification + password reset via Resend.
- Razorpay payments with resolution-based pricing (HD/2K/4K).
- `model_pose_assets` centralization and pose asset library.
- Bulk ZIP asset import for admins.
- Observability package with Prometheus metrics + Grafana Alloy.
- Admin mobile app Phases 1–8 implemented (Android/EAS).
- Aspect ratio cleanup and workflow size patching.

---

## Appendix: Key Files

### Must-Read Before Changes

| Topic | File |
|-------|------|
| API wiring | `apps/api/src/server.ts` |
| API env | `apps/api/src/env.ts` |
| Job creation | `apps/api/src/modules/jobs/create.ts` |
| Auth routes | `apps/api/src/modules/auth/routes.ts` |
| Auth service | `apps/api/src/modules/auth/service.ts` |
| DB factory | `packages/db/src/index.ts` |
| DB schema | `packages/db/src/schema/*.ts` |
| Shared types | `packages/types/src/*.ts` |
| Storage provider | `packages/storage/src/r2.ts` |
| Dispatcher main | `apps/dispatcher/src/index.ts` |
| Job processor | `apps/dispatcher/src/job/processor.ts` |
| Stream consumer | `apps/dispatcher/src/stream/consumer.ts` |
| Workflow patcher | `apps/dispatcher/src/workflow/patcher.ts` |
| Web middleware | `apps/web/src/middleware.ts` |
| Web API client | `apps/web/src/lib/api.ts` |
| Admin app | `apps/admin/src/App.tsx` |
| Root env example | `.env.example` |
| Docker compose | `infra/docker-compose.yml` |
| Design doc | `docs/virtual-tryon-system-design.md` |
| Phase plan | `docs/PHASES.md` |
| Progress log | `docs/progress.md` |

---

*End of reference document. Update this file when major architectural changes occur.*
