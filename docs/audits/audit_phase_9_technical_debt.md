# Phase 9: Technical Debt Audit

This document catalogues accumulated technical debt—code, architecture, or configurations that are "functional" but fundamentally unmaintainable or difficult to scale over time.

## Finding 9.1: Half-Implemented ComfyUI Dispatcher
* **Severity:** High
* **Evidence:** The dispatcher exists conceptually (`AGENTS.md` implies it is the only process talking to GPU workers), but it is heavily scaffolded without robust fault-tolerance, state machine reconciliation, or container orchestration.
* **Exact files involved:** `apps/dispatcher/`
* **User impact:** None directly, but the core business logic (generation) rests on a prototype foundation.
* **Business impact:** Cannot reliably scale beyond a single GPU node.
* **Technical impact:** Major rewrites required to support multi-node queuing, health checks, and autoscaling.
* **Recommendation:** Treat the current dispatcher as a prototype. Completely rebuild it using a durable workflow engine (e.g., Temporal or Temporal.io alternative) rather than manually pushing Redis Stream state updates.
* **Estimated implementation complexity:** High

## Finding 9.2: Next.js Inline CSS "Tokens" Paradigm
* **Severity:** High
* **Evidence:** Rather than standardizing on CSS Modules or a utility framework, the app relies heavily on importing a `C` and `M` object from `tokens.ts` and injecting them into `style={{}}` tags across hundreds of components.
* **Exact files involved:** `apps/web/src/components/tokens.ts`, `apps/web/src/components/ui/`
* **User impact:** Slower rendering times.
* **Business impact:** Slows down frontend feature development. Designer handoffs are manual and error-prone.
* **Technical impact:** Bypasses all standard CSS tooling (PostCSS, Autoprefixer, PurgeCSS).
* **Recommendation:** Rip out the `tokens.ts` object dictionary. Convert it into strict CSS Variables attached to Tailwind config, and refactor all inline styles to Tailwind classes.
* **Estimated implementation complexity:** High

## Finding 9.3: Brittle Legacy Routing / Middleware Redirects
* **Severity:** Low
* **Evidence:** The Next.js `middleware.ts` maintains a hardcoded `REDIRECTS` dictionary mapping old routes (like `/dashboard` to `/catalogues`). 
* **Exact files involved:** `apps/web/src/middleware.ts`
* **User impact:** Slightly slower TTFB for old links.
* **Business impact:** None.
* **Technical impact:** Middleware bloat.
* **Recommendation:** Move static redirects out of `middleware.ts` and into `next.config.js` `redirects()` so they are cached at the CDN/Edge level efficiently and don't consume middleware execution time.
* **Estimated implementation complexity:** Low

## Finding 9.4: Lack of Standardized Database Seeding
* **Severity:** Medium
* **Evidence:** Creating the first admin requires relying on `.env` bootstraps (`ADMIN_BOOTSTRAP_EMAIL`). Tests manually seed data by executing raw SQL or Drizzle inserts mid-test.
* **Exact files involved:** `packages/db/src/`, `apps/api/test/helpers/`
* **User impact:** None.
* **Business impact:** Difficulty replicating production bugs locally.
* **Technical impact:** Every test file must reinvent its own state.
* **Recommendation:** Build a robust `db:seed` script in `@aivastra/db` utilizing libraries like `@faker-js/faker` to generate thousands of deterministic rows for local load testing and standardized QA environments.
* **Estimated implementation complexity:** Medium
