# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Greenfield. Only `docs/virtual-tryon-system-design.md` exists. All app code, infra, and tooling not yet scaffolded. Treat the design doc as the source of truth — read it before changing architecture.

## Stack & Tooling Decisions

- **Package manager:** pnpm (workspaces). Use `pnpm-workspace.yaml`; do not introduce npm/yarn lockfiles.
- **Logger:** pino across all services (api, dispatcher, web server actions). No `console.log` in committed code. Use child loggers per request with `jobId`/`userId` bindings.
- **Containerization:** Docker Compose for local infra (Postgres, Redis, MinIO-as-R2-stub if needed, api, dispatcher, web). Compose file lives at `infra/docker-compose.yml`.
- **Runtime:** Node.js + TypeScript everywhere. Fastify (api), Next.js 15 (web), plain Node service (dispatcher).
- **DB:** PostgreSQL via Drizzle ORM. Migrations in `packages/db`.
- **Cache/queue:** Redis Streams (`jobs:priority`, `jobs:normal`), hashes for worker registry.
- **Object storage:** Cloudflare R2 via S3-compatible SDK behind a `StorageProvider` interface in `packages/storage`.

## Target Monorepo Layout

```
apps/web          Next.js 15 — user UI + admin panel
apps/api          Fastify — /v1/* and /admin/*
apps/dispatcher   Redis Stream consumer, ComfyUI bridge, worker health monitor
packages/types    Shared TS types + Zod schemas (single source of truth for request shapes)
packages/db       Drizzle schema + migrations
packages/storage  StorageProvider interface + R2 impl
packages/catalog  Category tree builder + catalog query helpers
infra/            docker-compose.yml, cloudflared configs, comfyui setup
templates/        ComfyUI workflow JSON (versioned)
scripts/          seed-catalog.ts and other ops scripts
```

## Architecture — Big Picture

Three-service split with a hard boundary at the Redis Stream:

1. **api** owns auth, credits, catalog reads, job creation. Validates catalog IDs are active → atomic credit deduct (`UPDATE WHERE balance > 0`) → writes `jobs` row → `XADD` to stream. Never talks to ComfyUI.
2. **dispatcher** is the only service that talks to GPU workers. Consumes stream via `XREADGROUP`, picks a healthy IDLE worker from Redis `worker:registry` hash (atomic claim → BUSY), patches the versioned workflow template with R2 inputs, posts to ComfyUI `/prompt` over a Cloudflare Tunnel, listens on ComfyUI websocket for progress, uploads result to R2, updates Postgres, publishes SSE events, `XACK`s. Refunds credits in the same Postgres transaction on terminal failure (max 2 attempts).
3. **web** uploads garments **direct to R2 via presigned URL** (bypasses api to save bandwidth), then POSTs job metadata. Opens SSE for live progress.

Worker connectivity: each ComfyUI VPS runs `cloudflared`; no inbound ports. Dispatcher authenticates with `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers. Health monitor probes `/system_stats` every 15s and sets `worker:health:{id}` with 30s TTL — expired key = unhealthy = no routing.

Input model: 1 user-uploaded garment + 4 admin-curated catalog selections (model, pose, background, lower). All 4 catalog IDs must resolve to `catalog_items` rows with `is_active=true` before credits deduct.

## Invariants (do not break)

- Credit deduct and job enqueue must be in one Postgres transaction. Refund on terminal failure also transactional.
- Catalog ID → R2 key resolution happens in api (before enqueue), not dispatcher. Dispatcher trusts the resolved keys on the job row.
- ComfyUI workflow template is versioned in `templates/`; never inline-mutate, always clone-and-patch.
- Postgres and Redis bind to `127.0.0.1` only. Worker URLs reach the dispatcher only via env / Redis registry, never hardcoded.
- All `/admin/*` routes double-check admin role: JWT claim AND `admin_users` row lookup.
- User hint field (300 char max) goes through sanitization before reaching the workflow prompt — protects the locked system prompt.

## Commands

Not yet wired. When scaffolding, expose these at the root via pnpm:

- `pnpm dev` — turbo-run dev across web/api/dispatcher
- `pnpm build` — typecheck + build all packages
- `pnpm db:migrate` / `pnpm db:generate` — Drizzle
- `pnpm seed:catalog` — runs `scripts/seed-catalog.ts`
- `pnpm docker:up` / `pnpm docker:down` — wrap `docker compose -f infra/docker-compose.yml`
- `pnpm test --filter <pkg>` — single-package test run
- `pnpm test --filter api -- <pattern>` — single test by name (Vitest `-t`)

## Reference

Design doc sections worth re-reading before related work: §2 Tunnel, §3 Catalog model, §4 Dispatcher routing, §5 Admin surface, §6 DB schema, §11 Security layers.
