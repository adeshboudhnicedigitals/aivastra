# Phase 3: UI & UX Audit

This document scrutinizes the interface design and user experience of both the Merchant Portal and the Widget. It challenges current implementations and highlights areas where the product falls short of top-tier SaaS standards.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **3.1 No Job Cancellation in Widget UX** — Done. Added `DELETE /v1/widget/jobs/:id` which cancels `QUEUED` or `PREPROCESSING` jobs, refunds credits, and publishes a `CANCELLED` SSE event. Added a Cancel button to the widget `processing` screen.
> - **3.2 Missing Client-Side File Validation** — Done. `handleFileSelect` validates MIME against `['image/jpeg','image/png','image/webp']` and rejects >5MB files before a presigned URL is ever requested. Inline `validationError` state renders below the dropzone — no global alert. `accept` attribute on the hidden input matches the JS allow-list exactly.
> - **3.3 Dead-End "Coming Soon" States** — Done. Upgraded the `coming-soon.tsx` component to a stateful client component with a "Notify me when ready" button, turning dead ends into an engagement hook. Fixed dark-mode token bug.
> - **3.4 Insufficient Empty States** — Done for the real gap. The audit referenced non-existent paths (`apps/web/src/app/(merchant)/catalogues/`); actual pages live in `(app)/`. The catalogues page (`(app)/catalogues/page.tsx`) already had a complete empty state with a "Get started" CTA. The assets page (`(app)/assets/page.tsx`) was genuinely bare — replaced with `GarmentIcon` + heading + sub-copy + `<Link href="/studio"><GradBtn>` CTA; filter-miss path preserved as plain text.
>
> - **3.5 Poor Reconnection UX on SSE Drops** — Done. `SSEState` type exported from `sse.ts`; `onStateChange` callback added to `createSSEConnection`. `JobStreamProvider` exposes `sseState` in context and renders a fixed bottom toast when `'reconnecting'`. Widget page's inline fire-and-forget SSE (which silently stalled on stream close) replaced with a `useEffect`-based reconnecting loop with exponential backoff and `AbortController` cancellation; `sseConnState` drives a "Connection lost — retrying…" indicator in the processing step UI.
>
> All findings in Phase 3 are now resolved.
