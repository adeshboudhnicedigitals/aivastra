# Phase 1: Architecture Audit

This document critically evaluates the architectural decisions, system boundaries, and infrastructural design of the Ai Vastra platform.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **1.1 Fragile Integration Testing** — Rejected. `AGENTS.md`/`CLAUDE.md` deliberately forbid `testcontainers` (MinIO startup issues on Windows); the docker-compose harness is the mandated approach.
> - **1.2 Unbounded Redis Stream Growth** — Done. `MAXLEN ~ 10000` added to all `XADD` calls. (Audit's "missing XACK" claim was false — XACK was already in place.)
> - **1.3 Race Conditions in Credit Deduction** — Debunked. The code already uses an atomic `UPDATE ... WHERE balance >= amount` inside a transaction. No race existed.
> - **1.5 Missing Compensating Transactions** — Done. The dispatcher `runSweeper` now refunds + fails both orphaned-`QUEUED` jobs and stuck in-flight jobs (`PREPROCESSING`/`GENERATING`/`UPLOADING`) past their SLA.
>
> Only the finding below remains open.

## Finding 1.4: Inefficient Backend-For-Frontend (BFF) Proxying
* **Severity:** Medium
* **Status:** Deferred (partially by-design — see note)
* **Evidence:** The Next.js app uses API routes (`apps/web/src/app/api/...`) to proxy requests to the Fastify backend (`API_URL`).
* **Exact files involved:** `apps/web/src/app/api/auth/login/route.ts`, `apps/web/src/app/api/merchant/me/route.ts`
* **User impact:** Increased TTFB (Time to First Byte) due to double-hop network latency.
* **Business impact:** Higher Vercel/Serverless execution costs, as Next.js API routes consume compute time merely waiting for the Fastify backend.
* **Technical impact:** Token copying and manual cookie forwarding (`setAuthCookies`, `safeJson`) introduce brittleness.
* **Recommendation:** Since both frontend and backend are on the same domain/subdomain architecture, authenticate directly against the Fastify backend using cross-origin cookies (`credentials: 'include'`). Reserve BFF strictly for server-side rendering data fetching, not client-side REST proxying.
* **Estimated implementation complexity:** High
* **Reviewer note:** The **auth** BFF (`apps/web/src/app/api/auth/*`) is an intentional security design — the Next server sets httpOnly cookies so the browser never handles the token exchange; this part should **not** be unwound. The actionable remainder is only the non-auth client-side data proxies (e.g. `merchant/me`), where the double-hop adds latency with no security benefit. Scope any future work to those.
