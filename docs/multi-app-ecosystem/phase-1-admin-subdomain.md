# Phase 1 — Admin Subdomain Infra

> Part of the [Multi-App Ecosystem Plan](../multi-app-ecosystem-plan.md) (`docs/multi-app-ecosystem-plan.md`, §6). This document is self-contained — implement from this file directly.

**Depends on:** nothing. **Blocks:** nothing (Phase 2 has its own, separate CORS/MinIO addition — don't wait for it). **User-facing surface:** admin panel moves to a new host; zero feature change.

## Why

The admin SPA (`apps/admin-web`, a Vite + React app) is currently deployed at `app.aivastra.com/panel/` via path-based NGINX proxying, sharing a host with the customer-facing Next.js app. It's moving to its own subdomain, `admin.aivastra.com`, as the first step toward each part of the ecosystem (customer web, admin, and a future merchant portal) being independently deployable while still sharing one backend. This phase is **pure deployment/config — no feature or auth-logic change.**

## Repo conventions (load-bearing — read before editing)

- pnpm workspaces. `apps/admin-web` builds via Vite; check `apps/admin-web/package.json` for the exact build script before assuming `vite build`.
- Postgres and Redis bind to `127.0.0.1` only — this is an existing invariant, don't change it while touching `infra/docker-compose.prod.yml`.
- Commit when this phase is complete and verified. **Do not push.**

## Spec

1. **`apps/admin-web/vite.config.ts`** — find the current `base` config (expected to be conditionally `/panel/` in production). Change it to always `base: '/'`. Admin-web now only ever deploys at its own subdomain root, so the environment-conditional subpath logic can be deleted entirely, not just bypassed.

2. **`apps/api/src/env.ts`** — find the `CORS_ORIGIN` env var definition (currently a single string). Change it to parse a comma-separated list into a `string[]` via Zod's `.transform()`, e.g. `z.string().default('http://localhost:3000').transform((s) => s.split(',').map((o) => o.trim()))`. Check `apps/api/src/server.ts` for where `CORS_ORIGIN` is passed to the `@fastify/cors` plugin registration — its `origin` option already accepts a `string[]` natively, so no code change should be needed there beyond the type now matching. Do not add a new CORS library or dependency.

3. **`infra/docker-compose.prod.yml`** — find the `minio-bootstrap` service's entrypoint script, which runs `mc cors set` with a JSON policy that currently interpolates a single `${CORS_ORIGIN}` value. This is a **separate CORS surface** from the API's (it governs direct browser PUT/GET requests to MinIO via presigned URLs) and must independently become a multi-origin JSON array — parse the same comma-separated `CORS_ORIGIN` env value into a shell array or generate the JSON with multiple `AllowedOrigin` entries. This is easy to miss because it looks unrelated to "API CORS" at a glance; it is not optional.

4. **New CloudPanel/NGINX vhost** for `admin.aivastra.com` (this is server config, likely outside this repo's version control — if there's an existing NGINX/CloudPanel config file checked into this repo for the current `app.aivastra.com` setup, mirror its structure; otherwise document the required rules in your Report Back for the person who applies them on the server):
   ```
   admin.aivastra.com/        → 127.0.0.1:3001   (admin-web container, unchanged)
   admin.aivastra.com/admin/  → 127.0.0.1:4000   (api)
   admin.aivastra.com/v1/     → 127.0.0.1:4000   (api)
   ```
   Both API path prefixes must be proxied, not just one — check `apps/admin-web/src/lib/data.ts` (or wherever its fetch wrapper lives) to confirm it makes relative-path `fetch()` calls with no base URL (this is expected to already be true); if so, both `/admin/` and `/v1/` traffic from the browser needs the same-origin proxy to keep working, since admin-web has no concept of an API base URL to point elsewhere.
   Optional but cheap: a redirect from `app.aivastra.com/panel/*` to `https://admin.aivastra.com/$1` for old bookmarks.

5. **`.env.production`** (and `.env.production.example`, so the format is documented): `CORS_ORIGIN=https://app.aivastra.com,https://admin.aivastra.com`.

## Out of scope for this phase

- No changes to any admin-web feature, page, or component.
- No changes to auth logic, JWT claims, or cookie handling — admin's existing cookie-based refresh should keep working unmodified because admin→API traffic remains same-origin behind the new proxy.
- No changes to `apps/catalogues-web` or any other app.

## Definition of Done

- [ ] `apps/admin-web/vite.config.ts` has `base: '/'` unconditionally; the old `/panel/` conditional logic is deleted, not just unused.
- [ ] `pnpm --filter @aivastra/admin build` (with `NODE_ENV=production` if that's what gates the old subpath logic) produces an `index.html` referencing asset paths at `/assets/...`, not `/panel/assets/...`. Paste the relevant lines of the built HTML in your report.
- [ ] `CORS_ORIGIN` parses correctly as a list — write a quick local check (or reuse/extend an existing env-validation test if one exists) confirming a comma-separated value produces the expected array.
- [ ] Local smoke test: start the API with `CORS_ORIGIN` set to two different origins (e.g. two local dev ports), issue a CORS preflight/request from both, confirm each gets back a matching `Access-Control-Allow-Origin` for its own origin, and confirm a third, unlisted origin does **not** get a matching header.
- [ ] The `minio-bootstrap` CORS JSON is confirmed to contain multiple `AllowedOrigin` entries when `CORS_ORIGIN` has multiple values — inspect the rendered script/JSON, don't just assume the string substitution worked.
- [ ] Existing `apps/api/test/integration/admin-*.test.ts` suite (whatever admin-related integration tests already exist) passes unmodified — this proves the CORS/env change didn't alter any auth or route behavior.
- [ ] `pnpm typecheck` across the repo passes (the `CORS_ORIGIN` type change from `string` to `string[]` could break other call sites that assumed a string — check for any).

## Report Back

_Codex: fill this in when the phase is complete._

- Files created:
- Files modified:
- Built admin-web `index.html` asset-path snippet (proving the base-path fix):
- CORS smoke-test output:
- NGINX/CloudPanel config: applied directly, or documented here for manual application? (paste the rules either way)
- Test run output:
- Any deviation from this spec, and why:
- Anything ambiguous you had to make a judgment call on:
