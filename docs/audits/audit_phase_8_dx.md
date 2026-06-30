# Phase 8: Developer Experience Audit

This document examines the Developer Experience (DX), CI/CD readiness, monorepo boundaries, and local development workflows.

## Finding 8.1: Poor Monorepo Boundary Enforcement
* **Severity:** Medium
* **Evidence:** Although `AGENTS.md` explicitly warns against relative imports into `packages/` (e.g., forcing `@aivastra/db` imports via `workspace:*`), there is no automated enforcement (like ESLint `no-restricted-imports`).
* **Exact files involved:** `.eslintrc.js` or `eslint.config.js` (missing configuration)
* **User impact:** None.
* **Business impact:** Slower onboarding as developers accidentally break boundaries, leading to spaghetti dependencies and slow build times.
* **Technical impact:** A web component might accidentally import Node-specific DB connection code, breaking Next.js client builds.
* **Recommendation:** Configure ESLint and tools like `eslint-plugin-boundaries` to strictly forbid `../packages/` paths and prevent cross-app contamination (e.g., `apps/web` importing from `apps/api`).
* **Estimated implementation complexity:** Low

## Finding 8.2: Database Migrations Developer Friction
* **Severity:** Medium
* **Evidence:** Developers must manually run `pnpm db:generate` and `pnpm db:migrate`. The integration test harness (`apps/api/test/helpers/containers.ts`) explicitly runs migrations before every test file. 
* **Exact files involved:** `AGENTS.md`, `packages/db/src/migrate.ts`
* **User impact:** None.
* **Business impact:** Lower developer velocity. Unpredictable local states.
* **Technical impact:** Running Drizzle migrations per test file against a shared local Postgres instance is incredibly slow and highly susceptible to race conditions.
* **Recommendation:** Create a dedicated DB testing container (via Testcontainers) and cache the migrated DB snapshot. Alternatively, inject isolated schemas per test instead of isolating by dropping/creating the whole DB.
* **Estimated implementation complexity:** High

## Finding 8.3: Hardcoded Port Conflicts
* **Severity:** Low
* **Evidence:** Fastify binds explicitly to port `4000`. The BFF uses `NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'`. If a developer is running multiple projects or if tests spawn parallel processes, port collisions occur.
* **Exact files involved:** `apps/api/src/server.ts`, `apps/web/src/app/api/...`
* **User impact:** None.
* **Business impact:** Broken local dev experiences for engineers.
* **Technical impact:** Tests and servers crash on startup (`EADDRINUSE`).
* **Recommendation:** Fallback to random ephemeral ports (`0`) for testing (already noted as done for the API tests, but confirm it for all services) and use environment variables rigorously for all cross-service bindings.
* **Estimated implementation complexity:** Low

## Finding 8.4: Missing Shared Configuration Management
* **Severity:** Low
* **Evidence:** Both the API and Web apps copy `.env.example`. Next.js requires `NEXT_PUBLIC_` prefixes, while the API uses raw variables. This dual-source-of-truth often leads to misconfigurations.
* **Exact files involved:** `.env.example`
* **User impact:** None.
* **Business impact:** Production outages if ops teams update the backend DB URL but forget the worker or frontend vars.
* **Technical impact:** Fragile deployments.
* **Recommendation:** Use a tool like Infisical, Doppler, or a shared `.env` package to centralize configurations across the monorepo workspaces, typed tightly with Zod.
* **Estimated implementation complexity:** Medium
