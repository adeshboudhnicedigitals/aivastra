# AGENTS.md

Compact guidance for OpenCode sessions in this repo.

## Stack

- **Monorepo:** pnpm workspaces (`apps/*`, `packages/*`)
- **Runtime:** Node 20+, TypeScript 5.6, ESM only (`"type": "module`)
- **API:** Fastify 5 + `fastify-type-provider-zod` + ioredis + Drizzle ORM
- **DB:** PostgreSQL 16, migrations in `packages/db/src/migrations`
- **Cache/Queue:** Redis 7 Streams (`jobs:priority`, `jobs:normal`, `jobs:low`, `jobs:video`)
- **Storage:** S3-compatible (Cloudflare R2), local stub = MinIO
- **Tests:** Vitest + testcontainers-free harness (see below)

## Setup

```bash
cp .env.example .env
pnpm docker:up          # postgres + redis + minio (binds 127.0.0.1)
pnpm db:generate        # drizzle-kit generate
pnpm db:migrate         # apply migrations
pnpm install
```

## Important Commands

| Command | What |
|---------|------|
| `pnpm dev` | parallel dev across all workspace packages |
| `pnpm --filter @aivastra/api test` | full API integration suite |
| `pnpm --filter @aivastra/api test -- <pattern>` | single test by name (Vitest `-t`) |
| `pnpm --filter @aivastra/<pkg> test` | single package tests |
| `pnpm db:generate` | generate Drizzle migration SQL |
| `pnpm db:migrate` | run `packages/db/src/migrate.ts` against DATABASE_URL |
| `pnpm docker:up` / `pnpm docker:down` | compose at `infra/docker-compose.yml` |
| `pnpm docker:reset` | compose down + volumes |
| `pnpm build` | typecheck + build all |

## Testing Architecture (Critical)

**No testcontainers.** Integration tests reuse the docker-compose Postgres/Redis/MinIO already running on localhost. Each test file:

1. Creates a **fresh Postgres database** via `CREATE DATABASE`
2. Runs Drizzle migrations once via `migrate(drizzle(client), { migrationsFolder: './node_modules/@aivastra/db/src/migrations' })`
3. Creates a **fresh MinIO bucket** per test file via `CreateBucketCommand`
4. Tears down DB + bucket in `afterAll`

This is faster but means:
- `docker:up` **must** be running before `pnpm test`
- Tests cannot run in parallel if they share the same MinIO bucket name — use random suffixes
- The test harness lives in `apps/api/test/helpers/containers.ts`

**API test harness:** `buildTestApp()` in `apps/api/test/helpers/api.ts` calls `app.listen({ port: 0 })` so `app.server.address()` gives the real ephemeral port. Use raw `node:http` for SSE tests (Fastify `inject()` hangs on streaming responses).

## Monorepo Boundaries

| Package | Role |
|---------|------|
| `@aivastra/db` | Drizzle schema + `createDb(url)` factory. Exports `schema` namespace. |
| `@aivastra/types` | Zod schemas only. No runtime deps except `zod`. |
| `@aivastra/storage` | `StorageProvider` interface + `createR2Provider()` + key builders. |
| `@aivastra/logger` | `createLogger(service)` wrapper around pino. |
| `apps/api` | Fastify service. All routes wired in `src/server.ts`. |

## Architecture Invariants

- **api** validates catalog + deducts credits in one Postgres txn, then `XADD` to Redis Stream. Never talks to ComfyUI.
- **dispatcher** (not yet built) is the only process that talks to GPU workers.
- Catalog ID → R2 key resolution happens in api before enqueue.
- All `/admin/*` routes check `admin_users` row after JWT verify.
- Credit deduct + job insert must stay in one transaction. Refund on failure too.
- No `console.log` in committed code — use `req.log.child({ jobId, userId })`.

## Environment Notes

- `.env` required. `DATABASE_URL` points to `127.0.0.1:5432`.
- `R2_*` vars target MinIO in dev (`http://127.0.0.1:9000`).
- `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` seed first admin.
- Postgres and Redis bind `127.0.0.1` only (never `0.0.0.0`).

## Git Commit & Push Policy

**Only commit and push when a meaningful unit of work is complete.** Do NOT commit after every minor UI tweak, typo fix, or single-line change.

Commit when:
- A full feature is working end-to-end (new wizard step, new admin page, new API endpoint)
- A bug is fixed and verified
- A migration + its corresponding API/UI changes are all done together
- A refactor spanning multiple files is complete

Do NOT commit for:
- Single CSS property changes
- Label/copy tweaks
- One-liner fixes that are part of a larger in-progress task

Batch related small changes into one commit with the larger task they belong to.

## Progress Tracking

After every plan execution, update `docs/progress.md`:
- **Done** — completed work
- **Failed / Not Done** — skipped, blocked, or broken
- **Open Questions / Decisions** — unresolved choices affecting next steps

Add a new dated entry at the top of the log.

## Gotchas

- `drizzle-kit generate` needs `DATABASE_URL` set (reads `drizzle.config.ts`).
- `packages/db/src/index.ts` exports `* as schema` — do not duplicate-export `schema`.
- `@aivastra/db` is imported as `workspace:*` — no relative paths into `packages/`.
- The `catalog.test.ts` integration test seeds `catalog_types` with `slug: 'models'` — use unique slugs if running multiple tests in same process (parallel collisions).
- `testcontainers` package is installed but **not used** by the harness; it was abandoned due to MinIO startup issues on Windows. Do not re-introduce it for the API test harness.
