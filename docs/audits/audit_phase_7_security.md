# Phase 7: Security Audit

This document reviews the system against common security vulnerabilities, authentication flaws, and data protection boundaries.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **7.2 Unrestricted Presigned URL Generation** — Done. The audit's recommendation (`content-length-range` POST policy) is structurally impossible for SDK-generated PUT presigned URLs (`ContentLength` intentionally omitted from `PutObjectCommand` — see `r2.ts` comment). The correct gates are: (1) Zod `.max(5 * 1024 * 1024)` on `WidgetPresignRequest.contentLength` in `packages/types/src/widget.ts` validates the declared size at presign time; (2) `headObject` check at `POST /v1/widget/jobs` in `apps/api/src/modules/widget/routes.ts` catches any lie — actual uploaded bytes validated against 5MB before credit deduction or GPU work is queued. Both caps are consistent at 5MB, matching the client-side JS gate.
> - **7.3 Auth Token Race Condition** — Debunked. The system natively handles concurrent refresh requests via the `rotateTokenFamily` successor/reissue mechanism (`{ kind: 'reissue' }`). If multiple tabs refresh simultaneously, the first rotation marks it `usedAt` and creates a successor, while subsequent calls get reissued the active successor, fully preventing spurious 401s without relying on arbitrary 30-60s grace periods.
> - **7.4 Broad Next.js Middleware Catch-All** — Done. Updated the `middleware.ts` matcher to explicitly bypass static image extensions (`.*\\.(?:svg|png|jpg|jpeg|gif|webp)$`), preventing Edge function executions on static assets.
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

## Finding 7.5: ComfyUI Arbitrary Payload Execution Risk
* **Severity:** Critical
* **Evidence:** The architecture implies the dispatcher takes API job instructions and formats them for ComfyUI. If end-users have any control over node parameters (e.g., via the widget injecting custom prompts), there is a severe risk of prompt injection or RCE if the GPU workers run untrusted code.
* **Exact files involved:** `apps/dispatcher/` (architectural implication)
* **User impact:** None directly.
* **Business impact:** Complete compromise of GPU infrastructure.
* **Technical impact:** Container escape and lateral movement.
* **Recommendation:** The dispatcher must strictly sanitize all inputs against a hardcoded schema. Never allow the frontend or API to specify arbitrary ComfyUI node connections or paths. Run ComfyUI nodes in heavily restricted, network-isolated sandboxes.
* **Estimated implementation complexity:** High
