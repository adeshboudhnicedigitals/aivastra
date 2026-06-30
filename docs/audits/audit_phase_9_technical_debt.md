# Phase 9: Technical Debt Audit

This document catalogues accumulated technical debt—code, architecture, or configurations that are "functional" but fundamentally unmaintainable or difficult to scale over time.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **9.2 Next.js Inline CSS "Tokens" Paradigm** — Rejected by design decision. `tokens.ts` is the intentional, enforced styling contract for this codebase. The recommendation to migrate to Tailwind was explicitly evaluated and declined. Not technical debt — it is the design system.
> - **9.3 Brittle Legacy Routing / Middleware Redirects** — Done. `REDIRECTS` dict and loop removed from `apps/web/src/middleware.ts`. Redirects moved to `async redirects()` in `apps/web/next.config.ts` with `permanent: true` and `basePath`-aware source/destination strings — now cached at CDN/Edge level. Note: `/tryon` was not in the original `REDIRECTS` dict; it has its own route page and was unaffected.
>
> Only the findings below remain open.

## Finding 9.1: Half-Implemented ComfyUI Dispatcher
* **Severity:** High
* **Evidence:** The dispatcher exists conceptually (`AGENTS.md` implies it is the only process talking to GPU workers), but it is heavily scaffolded without robust fault-tolerance, state machine reconciliation, or container orchestration.
* **Exact files involved:** `apps/dispatcher/`
* **User impact:** None directly, but the core business logic (generation) rests on a prototype foundation.
* **Business impact:** Cannot reliably scale beyond a single GPU node.
* **Technical impact:** Major rewrites required to support multi-node queuing, health checks, and autoscaling.
* **Recommendation:** Treat the current dispatcher as a prototype. Completely rebuild it using a durable workflow engine (e.g., Temporal or Temporal.io alternative) rather than manually pushing Redis Stream state updates.
* **Estimated implementation complexity:** High

## Finding 9.4: Lack of Standardized Database Seeding
* **Severity:** Medium
* **Evidence:** Creating the first admin requires relying on `.env` bootstraps (`ADMIN_BOOTSTRAP_EMAIL`). Tests manually seed data by executing raw SQL or Drizzle inserts mid-test.
* **Exact files involved:** `packages/db/src/`, `apps/api/test/helpers/`
* **User impact:** None.
* **Business impact:** Difficulty replicating production bugs locally.
* **Technical impact:** Every test file must reinvent its own state.
* **Recommendation:** Build a robust `db:seed` script in `@aivastra/db` utilizing libraries like `@faker-js/faker` to generate thousands of deterministic rows for local load testing and standardized QA environments.
* **Estimated implementation complexity:** Medium
