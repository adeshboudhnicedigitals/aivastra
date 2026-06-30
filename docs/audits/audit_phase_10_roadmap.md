# Phase 10: Prioritized Improvement Roadmap

This document consolidates findings from Phases 1 through 9 into a prioritized execution plan. Status is kept current as work progresses.

**Legend:** ✅ Done · ⛔ Skip/Rejected · 🔶 Deferred/Reframed · 🔴 Open

---

## Tier 1: Critical Stability & Security

| # | Finding | Status | Notes |
|---|---------|--------|-------|
| T1-1 | Credit Deduction Atomic Locking (1.3) | ✅ Debunked | `UPDATE ... WHERE balance >= amount` was already atomic transactional. No change needed. |
| T1-2 | Widget Rate Limiting (2.1) | ✅ Done | Redis fixed-window limiter (`60 req/min`) on `POST /v1/widget/presign` and `/v1/widget/jobs`, keyed by `clientId`. |
| T1-3 | Widget Origin Strictness (7.1) | 🔴 Open | reCAPTCHA / Turnstile or server-side signed session tokens required. High complexity architectural change. |
| T1-4 | Redis Stream Lifecycle Management (1.2) | ✅ Done | `MAXLEN ~ 10000` added to all `XADD` calls in widget and normal job paths. |
| T1-5 | ComfyUI Sandboxing / Dispatcher (7.5 + 9.1) | 🔴 Open | Dispatcher is prototype-grade. Input sanitization schema + multi-node orchestration not yet implemented. Critical severity. |

---

## Tier 2: Product Completeness & UI/UX

| # | Finding | Status | Notes |
|---|---------|--------|-------|
| T2-1a | Job Cancellation — user-facing (3.1) | 🔴 Open | `DELETE /v1/widget/jobs/:id` + dispatcher graceful abort not implemented. High complexity. |
| T2-1b | Stuck-job Sweeper / Refunds (1.5) | ✅ Done | `runSweeper` in dispatcher refunds credits and marks `FAILED` for orphaned-`QUEUED` and stuck in-flight jobs past SLA. |
| T2-2a | Client-Side File Validation (3.2) | ✅ Done | MIME allow-list + 5MB gate in `handleFileSelect`; `accept` attribute on hidden input; inline `validationError` state. |
| T2-2b | Client-Side Image Compression (6.3) | ⛔ Permanent skip | Compression before upload degrades ComfyUI generation quality. Maximum fidelity required. Do not implement. |
| T2-3 | B2B Webhook Infrastructure (2.2) | ✅ Done | Full dispatcher consumer with SSRF guard, redirect blocking, exponential backoff, HMAC signing, and admin config UI. |
| T2-4 | Design System Migration to Tailwind (4.2 + 9.2) | ⛔ Rejected | `tokens.ts` + CSS variables is the intentional, enforced design language. Tailwind migration is a full rewrite with no product benefit. |

---

## Tier 3: Developer Experience & Scale

| # | Finding | Status | Notes |
|---|---------|--------|-------|
| T3-1 | Testcontainers Migration (1.1 + 8.2) | ⛔ Rejected | `testcontainers` package installed but abandoned — MinIO startup issues on Windows. docker-compose harness is the mandated approach per `CLAUDE.md`. |
| T3-2a | Next.js Image Optimization (6.1) | ⛔ Skip | `unoptimized: true` globally; blob/presigned URLs structurally incompatible with `<Image>`. |
| T3-2b | Hydration Bloat from Inline Styles (6.2) | ⛔ Rejected | Same decision as T2-4; `tokens.ts` is the design system. |
| T3-3 | Image Generation Caching (2.4) | 🔶 Reframed | Premise is weak — every customer selfie is unique, so content-hash cache hit rate ≈ 0. Correct mechanism is an **idempotency key** on `POST /v1/widget/jobs` to prevent double-charge on accidental re-submit. Not yet implemented. |
| T3-4 | Monorepo Boundary Enforcement (8.1) | 🔴 Open | No `eslint-plugin-boundaries` or equivalent configured. Low complexity; could be done any time. |

---

## Findings completed outside the original roadmap tiers

These were addressed without being explicitly listed in the original roadmap:

| Finding | Status | Notes |
|---------|--------|-------|
| 2.5 Self-Serve API Key Management | ✅ Done | `POST /v1/merchant/api-keys/regenerate` + BFF proxy + two-step confirm UI (`ApiKeysContent.tsx`). |
| 3.4 Empty States (assets page) | ✅ Done | `GarmentIcon` + heading + CTA in `(app)/assets/page.tsx`. |
| 3.5 SSE Reconnection UX | ✅ Done | `SSEState` exported from `sse.ts`; `onStateChange` callback in `createSSEConnection`; reconnecting toast in `JobStreamProvider`; widget SSE extracted to `useEffect` with exponential-backoff reconnection. |
| 4.4 Hardcoded colors | ✅ Done | `error.tsx` `background: '#fff'` → `C.bg`. `confirm-dialog.tsx` was already tokenized. |
| 5.1 ARIA live regions (widget) | ✅ Done | `aria-live="polite"` on processing status; `role="alert" aria-live="assertive"` on error container. |
| 5.2 PremiumSelect ARIA | ✅ Done | `role="combobox"`, `useId` for stable IDs, `aria-controls`, `aria-activedescendant`. |
| 5.3 Focus trap in modals | ✅ Done | `SupportModal` and `ConfirmDialog` both have full focus traps, `role="dialog" aria-modal="true"`, and keyboard dismiss. |
| 5.4 Focus-visible outlines | ✅ Done | `.focus-ring` utility in `globals.css`; `outline: none` inline overrides removed; class applied to all interactive buttons in `PremiumSelect` and `PremiumDateRange`. |
| 7.2 Presigned URL upload cap | ✅ Done | Three-layer enforcement: Zod `.max(5MB)` at presign time; `headObject` check at job creation; client-side MIME+size gate. |
| 7.4 Broad middleware catch-all | ✅ Done | Matcher extended to exclude `.svg|png|jpg|jpeg|gif|webp` extensions from Edge middleware execution. |
| 9.3 Middleware redirects | ✅ Done | Redirects moved from middleware to `next.config.ts` `async redirects()` — now CDN-cached with `permanent: true`. |

---

## Open findings summary (as of 2026-06-30)

| Phase | # | Severity | Complexity |
|-------|---|----------|------------|
| 2 | 2.3 Merchant analytics | Medium | High |
| 2 | 2.4 Idempotency key (reframed from caching) | Medium | Medium |
| 3 | 3.1 Job cancellation in widget | High | High |
| 3 | 3.3 "Coming Soon" dead ends | Medium | Low |
| 4 | 4.1 JS hover handlers anti-pattern | High | Medium |
| 4 | 4.3 Hardcoded responsive breakpoints | Medium | High |
| 6 | 6.4 BFF duplicate fetches (React Query hydration) | Low | Medium |
| 7 | 7.1 Widget origin validation / reCAPTCHA | High | High |
| 7 | 7.3 Auth token race / refresh grace period | Medium | Medium |
| 7 | 7.5 ComfyUI arbitrary payload execution | Critical | High |
| 8 | 8.1 Monorepo boundary enforcement | Medium | Low |
| 8 | 8.2 DB migration friction | Medium | High |
| 8 | 8.3 Hardcoded port conflicts | Low | Low |
| 8 | 8.4 Missing shared config management | Low | Medium |
| 9 | 9.1 Half-implemented dispatcher | High | High |
| 9 | 9.4 DB seeding standardization | Medium | Medium |
| 11 | 11.1 Primitive div-based charts | High | Medium |
| 11 | 11.2 Admin dashboard polling → SSE | High | High |
| 11 | 11.3 Fragmented admin styling | Medium | High |
| 11 | 11.4 Dead-end metric drill-downs | Medium | Medium |
| 11 | 11.5 Brittle theme state sync | Low | Low |
| 1 | 1.4 BFF proxying overhead (non-auth routes) | Medium | High |
