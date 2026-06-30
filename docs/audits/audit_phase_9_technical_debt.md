# Phase 9: Technical Debt Audit

This document catalogues accumulated technical debt—code, architecture, or configurations that are "functional" but fundamentally unmaintainable or difficult to scale over time.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **9.2 Next.js Inline CSS "Tokens" Paradigm** — Rejected by design decision. `tokens.ts` is the intentional, enforced styling contract for this codebase. The recommendation to migrate to Tailwind was explicitly evaluated and declined. Not technical debt — it is the design system.
> - **9.3 Brittle Legacy Routing / Middleware Redirects** — Done. `REDIRECTS` dict and loop removed from `apps/web/src/middleware.ts`. Redirects moved to `async redirects()` in `apps/web/next.config.ts` with `permanent: true` and `basePath`-aware source/destination strings — now cached at CDN/Edge level. Note: `/tryon` was not in the original `REDIRECTS` dict; it has its own route page and was unaffected.
> - **9.1 Half-Implemented ComfyUI Dispatcher** — Merged. This finding overlaps completely with Finding 7.5 (ComfyUI payload sandboxing). Fixing the dispatcher's "prototype-grade" lack of input sanitization and multi-node orchestration is part of the core 7.5 architecture task.
> - **9.4 Lack of Standardized Database Seeding** — Done. Built a robust `db:seed` script in `@aivastra/db` utilizing `@faker-js/faker` to generate thousands of deterministic rows for local load testing and standardized QA environments, wired into `pnpm db:seed`.
>
> All findings in Phase 9 are now resolved, skipped, or deferred.
