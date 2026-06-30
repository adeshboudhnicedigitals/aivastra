# Phase 2: Feature Gap Audit

This document identifies major functional gaps and missing capabilities that prevent the application from functioning as a mature, enterprise-ready SaaS product.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **2.1 Missing Rate Limiting** — Done. Redis fixed-window limiter keyed by `clientId` on `POST /v1/widget/presign` and `/v1/widget/jobs`. (Per-IP was intentionally dropped — widget calls are server-to-server, so IP is meaningless here.)
> - **2.2 Lack of B2B Webhook Infrastructure** — Done. Full dispatcher consumer (`webhooks:outbound` stream) with SSRF guard, redirect blocking, IPv6 hardening, exponential backoff, HMAC signing, plus admin config UI.
> - **2.5 Missing Self-Serve API Key Management** — Done. `POST /v1/merchant/api-keys/regenerate` + BFF proxy + two-step confirm UI in `ApiKeysContent.tsx`. (Note: there is no `api_keys` table — the merchant credential is the single `widgetKey` column, so this is key *rotation*, not CRUD.)
>
> Only the findings below remain open.

## Finding 2.3: Incomplete Merchant Analytics and Telemetry
* **Severity:** Medium
* **Status:** Deferred (real gap)
* **Evidence:** The dashboard provides credit balance, but there are no endpoints or DB tables tracking end-user engagement metrics (e.g., click-through rates, add-to-cart conversions after try-on).
* **Exact files involved:** `packages/db/src/schema/`, `apps/web/src/app/(merchant)/merchant/dashboard/`
* **User impact:** Merchants cannot measure the ROI of using the Ai Vastra widget.
* **Business impact:** High churn risk. Without data proving that virtual try-on increases sales, merchants have no incentive to refill credits.
* **Technical impact:** Needs an analytics ingestion pipeline capable of handling high-volume telemetry without blocking main database transactions.
* **Recommendation:** Introduce a lightweight telemetry endpoint (`POST /v1/widget/events`) that records events (viewed, generated, clicked_buy).
* **Estimated implementation complexity:** High
* **Reviewer note:** The audit's ClickHouse / partitioned-Postgres recommendation is over-engineered for current scale. A simple append-only `widget_events` table + `POST /v1/widget/events` is the right v1; revisit a dedicated analytics store only if event volume actually demands it.

## Finding 2.4: Absence of Image Generation Caching
* **Severity:** Medium
* **Status:** Deferred (weak premise — reframe before building)
* **Evidence:** Every job request deducts a credit and hits the GPU queue, even if the same user image + garment is submitted multiple times.
* **Exact files involved:** `apps/api/src/modules/widget/routes.ts`
* **User impact:** Users wait 30-60 seconds for an image they may have already generated previously.
* **Business impact:** Wasted GPU compute and wasted merchant credits on identical inputs.
* **Technical impact:** Inefficient use of resources.
* **Recommendation:** A content-hash cache (user image + garment ID) returning a prior `COMPLETED` `resultKey` without deducting a credit or queueing a GPU task.
* **Estimated implementation complexity:** Medium
* **Reviewer note:** The premise is weak for the dominant widget path: `customerPhotoKey` is a *unique customer selfie uploaded every session*, so a content-hash cache would have a near-zero hit rate (every customer is a different person). If the real goal is preventing double-charge on accidental duplicate submits, the correct mechanism is an **idempotency key**, not content-hash caching. Do not build as originally specced.
