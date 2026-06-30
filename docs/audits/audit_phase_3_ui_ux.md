# Phase 3: UI & UX Audit

This document scrutinizes the interface design and user experience of both the Merchant Portal and the Widget. It challenges current implementations and highlights areas where the product falls short of top-tier SaaS standards.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **3.2 Missing Client-Side File Validation** — Done. `handleFileSelect` validates MIME against `['image/jpeg','image/png','image/webp']` and rejects >5MB files before a presigned URL is ever requested. Inline `validationError` state renders below the dropzone — no global alert. `accept` attribute on the hidden input matches the JS allow-list exactly.
> - **3.4 Insufficient Empty States** — Done for the real gap. The audit referenced non-existent paths (`apps/web/src/app/(merchant)/catalogues/`); actual pages live in `(app)/`. The catalogues page (`(app)/catalogues/page.tsx`) already had a complete empty state with a "Get started" CTA. The assets page (`(app)/assets/page.tsx`) was genuinely bare — replaced with `GarmentIcon` + heading + sub-copy + `<Link href="/studio"><GradBtn>` CTA; filter-miss path preserved as plain text.
>
> - **3.5 Poor Reconnection UX on SSE Drops** — Done. `SSEState` type exported from `sse.ts`; `onStateChange` callback added to `createSSEConnection`. `JobStreamProvider` exposes `sseState` in context and renders a fixed bottom toast when `'reconnecting'`. Widget page's inline fire-and-forget SSE (which silently stalled on stream close) replaced with a `useEffect`-based reconnecting loop with exponential backoff and `AbortController` cancellation; `sseConnState` drives a "Connection lost — retrying…" indicator in the processing step UI.
>
> Only the findings below remain open.

## Finding 3.1: No Job Cancellation in Widget UX
* **Severity:** High
* **Evidence:** The widget transitions to a `waiting` state featuring a spinner and "Generating your try-on...". There is no button to cancel the job or back out if the user selected the wrong photo.
* **Exact files involved:** `apps/web/src/app/(widget)/widget/render/[key]/page.tsx`
* **User impact:** Users feel trapped. If they realize they uploaded an irrelevant photo, they must refresh the page, which breaks the UX flow on the merchant's site.
* **Business impact:** Merchant credits are wasted on user mistakes.
* **Technical impact:** Requires adding a `DELETE /v1/widget/jobs/:id` endpoint and handling graceful job termination in the Dispatcher/ComfyUI.
* **Recommendation:** Add a prominent "Cancel" button during the `waiting` step. If clicked within the first few seconds (before GPU lock), refund the credit automatically.
* **Estimated implementation complexity:** High

## Finding 3.3: Dead-End "Coming Soon" States
* **Severity:** Medium
* **Evidence:** The `ComingSoon` component is used in place of unfinished features (e.g., analytics, certain settings). It provides no path forward.
* **Exact files involved:** `apps/web/src/components/ui/coming-soon.tsx`
* **User impact:** Dead ends frustrate users. They signal an incomplete product without capturing the user's intent to use the feature.
* **Business impact:** Missed opportunity to gauge feature demand.
* **Technical impact:** None.
* **Recommendation:** Replace generic "Coming Soon" messages with interactive elements, such as "Notify me when this is ready" (capturing intent in a database) or linking to documentation/roadmaps.
* **Estimated implementation complexity:** Low

## Finding 3.5: Poor Reconnection UX on SSE Drops
* **Severity:** Medium
* **Evidence:** The `createSSEConnection` util handles exponential backoff reconnection. However, there is no UI indicator telling the user that the connection was lost and is reconnecting.
* **Exact files involved:** `apps/web/src/lib/sse.ts`, `apps/web/src/components/job-stream-provider.tsx`
* **User impact:** If the connection drops during generation, the widget appears permanently stalled on "Generating...". The user doesn't know if their internet dropped or the system broke.
* **Business impact:** Perception of poor reliability.
* **Technical impact:** Requires exposing connection state (e.g., `CONNECTING`, `CONNECTED`, `RECONNECTING`) from the hook.
* **Recommendation:** Expose the SSE connection state in `useJobStreamContext`. If `RECONNECTING`, overlay a subtle warning (e.g., "Connection unstable, reconnecting...").
* **Estimated implementation complexity:** Medium
