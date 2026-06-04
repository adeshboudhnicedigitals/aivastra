# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

- [x] Phase 0 — Foundations (monorepo, DB schema, docker infra)
- [x] Phase 1 — Backend API (auth, credits, catalog, admin, jobs)
- [x] Phase 2 — Dispatcher (Redis consumer, worker routing, ComfyUI pipeline)
- [ ] Phase 3 — Next.js frontend (`apps/web` — partially scaffolded)
- [ ] Phase 4 — E2E integration + real ComfyUI workflow template

Read `docs/virtual-tryon-system-design.md` before changing architecture. See `docs/PHASES.md` for phase detail.

## Stack & Tooling

- **Package manager:** pnpm workspaces. Never introduce npm/yarn lockfiles.
- **Runtime:** Node 20+, TypeScript 5.6, ESM only (`"type": "module"` everywhere).
- **API:** Fastify 5 + `fastify-type-provider-zod`. All routes wired in `apps/api/src/server.ts`.
- **DB:** PostgreSQL 16 via Drizzle ORM. Schema in `packages/db/src/schema/`. Migrations in `packages/db/src/migrations/`.
- **Cache/Queue:** Redis 7 Streams (`jobs:priority`, `jobs:normal`). Consumer group: `dispatcher-cg`.
- **Storage:** S3-compatible (Cloudflare R2 in prod, MinIO locally). `StorageProvider` interface in `packages/storage`.
- **Logger:** pino via `@aivastra/logger` (`createLogger(service)`). No `console.log` in committed code. Use child loggers with `jobId`/`userId` bindings.
- **Tests:** Vitest. No testcontainers — see Testing section below.

## Monorepo Layout

```
apps/api          Fastify 5 REST API — auth, credits, catalog, jobs, admin
apps/dispatcher   Redis Stream consumer — routes jobs to GPU workers
apps/web          Next.js 15 — user-facing UI (auth, studio, catalogues, pricing)
apps/admin        Vite + React SPA — internal admin panel (separate from apps/web)
packages/db       Drizzle schema + migrations + createDb() factory
packages/types    Zod schemas only — single source of truth for request/response shapes
packages/storage  StorageProvider interface + R2/MinIO impl + R2 key builders
packages/logger   pino wrapper — createLogger(service)
packages/catalog  (planned) category tree builder
infra/            docker-compose.yml, cloudflared configs
templates/        ComfyUI workflow JSON (versioned)
scripts/          seed-catalog.ts and other ops scripts
docs/             Design doc, phase plans, progress log
```

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
3. **web** — uploads garments **direct to R2 via presigned URL** (bypasses api), then POSTs job metadata. Opens SSE for live progress. Auth via httpOnly cookie (`access_token`). Token refresh handled automatically in `apps/web/src/lib/api.ts`.
4. **admin** — separate Vite+React SPA (`apps/admin`). Talks directly to `apps/api` `/admin/*` routes.

Worker connectivity: each ComfyUI VPS runs `cloudflared`; no inbound ports. Health monitor probes `/system_stats` every 15s and sets `worker:health:{id}` with 30s TTL — expired = unhealthy = no routing.

Input model: 1 user-uploaded garment + `faceId` + `backgroundId` + `poseId` (all admin-curated) + optional `lowerCatalogId` / `shoeCatalogId`. All IDs must resolve to active catalog/asset rows before credits deduct.

## Web App Architecture (apps/web)

### Auth Flow

Next.js API routes in `apps/web/src/app/api/auth/` act as a **BFF (Backend For Frontend)** proxy. They receive auth requests from the browser, call the Fastify API, then set httpOnly cookies via `apps/web/src/lib/auth-cookies.ts`. This means:
- Browser never directly calls the Fastify API for auth.
- The `access_token` cookie is set by the Next.js server, not by the client.
- `apps/web/src/lib/api.ts` reads the token from `document.cookie` for authenticated API calls and auto-refreshes on 401.

### Route Groups

- `(auth)` — login, register, forgot/reset password, verify email (unauthenticated)
- `(app)` — studio, catalogues, pricing, settings, assets (protected)

The middleware (`apps/web/src/middleware.ts`) guards all non-public routes by checking the `access_token` cookie. It also handles redirects for old route names (`/tryon` → `/studio`, `/dashboard` → `/catalogues`, `/jobs` → `/catalogues`).

### Studio Wizard (4-step flow)

`apps/web/src/app/(app)/studio/page.tsx` — the core user flow:
- **Step 0** — gender, garment type (from `/v1/models/garment-types?gender=`), publishing platform + aspect ratio, garment upload (direct to R2 via presigned URL from `/v1/uploads/presign`)
- **Step 1** — model/face selection from `/v1/models/faces?gender=&garmentTypeId=`
- **Step 2** — background selection from `/v1/models/backgrounds?faceId=`
- **Step 3** — pose selection from `/v1/models/poses?garmentTypeId=&faceId=&backgroundId=`; lower garment and shoes optional, shown only when selected poses have `hasLower`/`hasShoes` flags

Submit POSTs to `/v1/jobs/tryon`, redirects to `/catalogues/{catalogueId}`.

### Design Tokens

All components use `C` from `apps/web/src/components/tokens.ts` — a typed map of CSS variables (e.g. `C.pink`, `C.text`, `C.border`). The gradient is `grad` (pink → amber). Never use raw hex or hardcoded colors; always use tokens.

### `NEXT_PUBLIC_BASE_PATH`

Supports subdirectory deployment (e.g. `/app`). All internal asset references and redirects must account for this. The middleware strips it before route matching.

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

## Invariants (do not break)

- Credit deduct + job insert must be one Postgres transaction. Refund on terminal failure is also transactional.
- Catalog ID → R2 key resolution happens in api before enqueue. Dispatcher trusts the resolved keys on the `job_inputs` row.
- ComfyUI workflow template is versioned in `templates/`; never inline-mutate, always clone-and-patch.
- Postgres and Redis bind to `127.0.0.1` only.
- All `/admin/*` routes double-check admin role: JWT claim AND `admin_users` row lookup.
- User hint field (300 char max) goes through sanitization before reaching the workflow prompt.
- `@aivastra/db` exports `* as schema` from `packages/db/src/index.ts` — do not add a duplicate `schema` re-export.

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
| `WORKER_IDS` | dispatcher (comma-separated worker IDs) |
| `WORKER_API_KEY` | dispatcher |
| `NEXT_PUBLIC_API_URL` | web (Fastify API base URL, default `http://localhost:4000`) |
| `NEXT_PUBLIC_BASE_PATH` | web (subdirectory prefix, e.g. `/app`; empty in root deploy) |

In dev, `R2_*` vars point to MinIO at `http://127.0.0.1:9000`.

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

## Reference

Design doc sections worth re-reading before related work: §2 Tunnel, §3 Catalog model, §4 Dispatcher routing, §5 Admin surface, §6 DB schema, §11 Security layers.
