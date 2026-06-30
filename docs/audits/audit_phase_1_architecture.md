# Phase 1: Architecture Audit

This document critically evaluates the architectural decisions, system boundaries, and infrastructural design of the Ai Vastra platform.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **1.1 Fragile Integration Testing** — Rejected. `AGENTS.md`/`CLAUDE.md` deliberately forbid `testcontainers` (MinIO startup issues on Windows); the docker-compose harness is the mandated approach.
> - **1.2 Unbounded Redis Stream Growth** — Done. `MAXLEN ~ 10000` added to all `XADD` calls. (Audit's "missing XACK" claim was false — XACK was already in place.)
> - **1.3 Race Conditions in Credit Deduction** — Debunked. The code already uses an atomic `UPDATE ... WHERE balance >= amount` inside a transaction. No race existed.
> - **1.5 Missing Compensating Transactions** — Done. The dispatcher `runSweeper` now refunds + fails both orphaned-`QUEUED` jobs and stuck in-flight jobs (`PREPROCESSING`/`GENERATING`/`UPLOADING`) past their SLA.
> - **1.4 Inefficient Backend-For-Frontend (BFF) Proxying** — Rejected. The recommendation to eliminate the Next.js BFF layer contradicts the security architecture (httpOnly cookie auth requires the BFF to set cookies). The BFF is architecturally necessary.
>
> All findings in Phase 1 are now resolved, skipped, or deferred.
