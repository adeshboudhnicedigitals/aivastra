# Phase 3: UI & UX Audit

This document scrutinizes the interface design and user experience of both the Merchant Portal and the Widget. It challenges current implementations and highlights areas where the product falls short of top-tier SaaS standards.

## Finding 3.1: No Job Cancellation in Widget UX
* **Severity:** High
* **Evidence:** The widget transitions to a `waiting` state featuring a spinner and "Generating your try-on...". There is no button to cancel the job or back out if the user selected the wrong photo.
* **Exact files involved:** `apps/web/src/app/(widget)/widget/render/[key]/page.tsx`
* **User impact:** Users feel trapped. If they realize they uploaded an irrelevant photo, they must refresh the page, which breaks the UX flow on the merchant's site.
* **Business impact:** Merchant credits are wasted on user mistakes.
* **Technical impact:** Requires adding a `DELETE /v1/widget/jobs/:id` endpoint and handling graceful job termination in the Dispatcher/ComfyUI.
* **Recommendation:** Add a prominent "Cancel" button during the `waiting` step. If clicked within the first few seconds (before GPU lock), refund the credit automatically.
* **Estimated implementation complexity:** High

## Finding 3.2: Missing Client-Side File Validation
* **Severity:** Medium
* **Evidence:** The upload flow directly calls the API for a presigned URL as soon as a file is dropped. There is no explicit check for file size limits (e.g., >10MB) or invalid MIME types beyond the basic `<input accept="image/*">`.
* **Exact files involved:** `apps/web/src/app/(widget)/widget/render/[key]/page.tsx`
* **User impact:** Users uploading massive HEIC/RAW files from iPhones will experience slow uploads that ultimately fail backend validation, providing a poor feedback loop.
* **Business impact:** Increased cloud ingress costs for aborted/failed large files.
* **Technical impact:** Presigned URL generation endpoints might be unnecessarily abused.
* **Recommendation:** Enforce strict client-side checks for file size (max 5MB) and exact MIME types (JPEG, PNG, WEBP) *before* requesting the presigned URL. Display immediate, friendly error toasts if validation fails.
* **Estimated implementation complexity:** Low

## Finding 3.3: Dead-End "Coming Soon" States
* **Severity:** Medium
* **Evidence:** The `ComingSoon` component is used in place of unfinished features (e.g., analytics, certain settings). It provides no path forward.
* **Exact files involved:** `apps/web/src/components/ui/coming-soon.tsx`
* **User impact:** Dead ends frustrate users. They signal an incomplete product without capturing the user's intent to use the feature.
* **Business impact:** Missed opportunity to gauge feature demand.
* **Technical impact:** None.
* **Recommendation:** Replace generic "Coming Soon" messages with interactive elements, such as "Notify me when this is ready" (capturing intent in a database) or linking to documentation/roadmaps.
* **Estimated implementation complexity:** Low

## Finding 3.4: Insufficient Empty States
* **Severity:** Medium
* **Evidence:** If a merchant has no catalogues or assets, the UI likely renders empty tables or generic lists (inferred from common scaffolding). World-class SaaS platforms use empty states to educate and drive action.
* **Exact files involved:** `apps/web/src/app/(merchant)/catalogues/`, `apps/web/src/app/(merchant)/assets/`
* **User impact:** New merchants experience a "cold start" problem. They don't know what to do next.
* **Business impact:** Lower activation rates and higher onboarding drop-off.
* **Technical impact:** UI additions required.
* **Recommendation:** Design rich empty states with illustrations, clear primary call-to-actions ("Create your first catalogue"), and links to video tutorials or docs.
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
