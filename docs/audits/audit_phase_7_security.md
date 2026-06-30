# Phase 7: Security Audit

This document reviews the system against common security vulnerabilities, authentication flaws, and data protection boundaries.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **7.2 Unrestricted Presigned URL Generation** — Done. The audit's recommendation (`content-length-range` POST policy) is structurally impossible for SDK-generated PUT presigned URLs (`ContentLength` intentionally omitted from `PutObjectCommand` — see `r2.ts` comment). The correct gates are: (1) Zod `.max(5 * 1024 * 1024)` on `WidgetPresignRequest.contentLength` in `packages/types/src/widget.ts` validates the declared size at presign time; (2) `headObject` check at `POST /v1/widget/jobs` in `apps/api/src/modules/widget/routes.ts` catches any lie — actual uploaded bytes validated against 5MB before credit deduction or GPU work is queued. Both caps are consistent at 5MB, matching the client-side JS gate.
>
> Only the findings below remain open.

## Finding 7.1: Missing Widget Origin Validation Strictness
* **Severity:** High
* **Evidence:** The public widget API uses `Origin` headers to validate if an API key is allowed to request a job. However, outside of a browser environment, `Origin` headers are trivial to spoof (e.g., using `curl`). 
* **Exact files involved:** `apps/api/src/modules/widget/widget.routes.ts`
* **User impact:** None directly.
* **Business impact:** Malicious actors can steal a merchant's public API key and bypass the widget, draining the merchant's credits by spamming the endpoint from custom scripts.
* **Technical impact:** Server/GPU overload.
* **Recommendation:** Public API keys are inherently vulnerable if they control billing. Introduce a challenge-response mechanism (e.g., reCAPTCHA/Turnstile) on the widget, or require the merchant's backend to sign requests with a Secret Key (e.g., generating short-lived JWTs for the widget session) rather than trusting a static Public Key.
* **Estimated implementation complexity:** High

## Finding 7.3: Auth Token Race Condition (Refresh Tokens)
* **Severity:** Medium
* **Evidence:** To mitigate concurrent 401 requests logging the user out when the refresh token is rotated, a manual `tryRefresh()` lock exists in frontend `api.ts`, combined with a `BroadcastChannel` hack. 
* **Exact files involved:** `apps/web/src/lib/api.ts`
* **User impact:** Users opening multiple tabs simultaneously may still face abrupt logouts if the network requests execute before the lock or broadcast channel can sync state.
* **Business impact:** Frustrating UX leading to increased support load.
* **Technical impact:** Non-deterministic authentication failures.
* **Recommendation:** Implement "Refresh Token Grace Periods" on the backend. When a refresh token is rotated, keep the old token valid for exactly 30-60 seconds. This natively solves the concurrent request problem without brittle frontend locks.
* **Estimated implementation complexity:** Medium

## Finding 7.4: Broad Next.js Middleware Catch-All
* **Severity:** Low
* **Evidence:** The Next.js middleware guards protected routes but specifically targets a `matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)']`. If developers add new public assets or folders (e.g., `/public/videos`), the middleware will unnecessarily intercept them.
* **Exact files involved:** `apps/web/src/middleware.ts`
* **User impact:** Marginally slower load times for static assets.
* **Business impact:** None.
* **Technical impact:** Unnecessary Edge Function executions.
* **Recommendation:** Update the matcher to be strictly positive (e.g., `matcher: ['/studio/:path*', '/merchant/:path*']`) rather than using a negative lookahead, or expand the negative lookahead comprehensively.
* **Estimated implementation complexity:** Low

## Finding 7.5: ComfyUI Arbitrary Payload Execution Risk
* **Severity:** Critical
* **Evidence:** The architecture implies the dispatcher takes API job instructions and formats them for ComfyUI. If end-users have any control over node parameters (e.g., via the widget injecting custom prompts), there is a severe risk of prompt injection or RCE if the GPU workers run untrusted code.
* **Exact files involved:** `apps/dispatcher/` (architectural implication)
* **User impact:** None directly.
* **Business impact:** Complete compromise of GPU infrastructure.
* **Technical impact:** Container escape and lateral movement.
* **Recommendation:** The dispatcher must strictly sanitize all inputs against a hardcoded schema. Never allow the frontend or API to specify arbitrary ComfyUI node connections or paths. Run ComfyUI nodes in heavily restricted, network-isolated sandboxes.
* **Estimated implementation complexity:** High
