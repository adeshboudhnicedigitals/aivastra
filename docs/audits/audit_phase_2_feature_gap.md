# Phase 2: Feature Gap Audit

This document identifies major functional gaps and missing capabilities that prevent the application from functioning as a mature, enterprise-ready SaaS product.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **2.1 Missing Rate Limiting** — Done. Redis fixed-window limiter keyed by `clientId` on `POST /v1/widget/presign` and `/v1/widget/jobs`. (Per-IP was intentionally dropped — widget calls are server-to-server, so IP is meaningless here.)
> - **2.2 Lack of B2B Webhook Infrastructure** — Done. Full dispatcher consumer (`webhooks:outbound` stream) with SSRF guard, redirect blocking, IPv6 hardening, exponential backoff, HMAC signing, plus admin config UI.
> - **2.5 Missing Self-Serve API Key Management** — Done. `POST /v1/merchant/api-keys/regenerate` + BFF proxy + two-step confirm UI in `ApiKeysContent.tsx`. (Note: there is no `api_keys` table — the merchant credential is the single `widgetKey` column, so this is key *rotation*, not CRUD.)
> - **2.4 Absence of Image Generation Caching (Idempotency)** — Done. Widget now generates a UUID per generation attempt and passes it as `X-Idempotency-Key`. The backend uses Redis (`idempotency:{clientId}:{idempKey}`) to cache and return the `jobId` immediately on duplicate requests (e.g. network retries), preventing duplicate GPU queueing and double-charging.
> - **2.3 Incomplete Merchant Analytics and Telemetry** — Deferred. A full analytics pipeline (events, aggregation, dashboards) is a product feature, not a codebase defect. This is out of scope for the audit hardening sprint and deferred to a future product phase.
>
> All findings in Phase 2 are now resolved, skipped, or deferred.
