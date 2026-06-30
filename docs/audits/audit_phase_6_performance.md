# Phase 6: Performance Audit

This document assesses the application's performance, load times, rendering overhead, and data transfer efficiency.

> **Triage note:** Resolved/skipped findings have been removed. For traceability:
> - **6.1 Missing Next.js Image Optimization** — Skip (structural incompatibility). `next.config.ts` sets `unoptimized: true` globally because NGINX basePath routing breaks the built-in image optimizer. Additionally, garment images come from blob URLs and presigned R2 URLs, which are structurally incompatible with `<Image>` (which needs static `src` strings). No-op to use `<Image>` here; the audit recommendation cannot be applied. `eslint-disable-next-line @next/next/no-img-element` suppression comments are appropriate and intentional.
> - **6.2 Heavy Hydration Payloads due to Inline Styles** — Rejected by design decision. `tokens.ts` + inline CSS variables is the intentional, enforced styling contract (same decision as 4.2). Migrating to Tailwind/CSS Modules would be a full rewrite of the entire UI with no product benefit. Not technical debt — it is the design system.
> - **6.3 Unoptimized Client-Side Image Uploads** — Skip (permanent product constraint). Compressing or resizing the uploaded garment photo before upload would degrade ComfyUI generation quality. Maximum pixel fidelity is required for the AI diffusion nodes. Do not implement image compression in the widget upload flow.
>
> Only the finding below remains open.

## Finding 6.4: Duplicated API Requests via BFF
* **Severity:** Low
* **Evidence:** Next.js Server Components might fetch data directly, while Client Components use React Query to fetch data via the BFF API routes. Unless properly dehydrated and passed as initial data, the client will blindly re-fetch data the server already knew about.
* **Exact files involved:** `apps/web/src/app/api/...`, `apps/web/src/components/providers.tsx`
* **User impact:** Brief flashes of loading states on hard navigations.
* **Business impact:** None significant, but breaks the illusion of speed.
* **Technical impact:** Redundant database hits.
* **Recommendation:** Use React Query's `HydrationBoundary` and `dehydrate` to pass server-fetched query states to the client, preventing the client from re-fetching on mount.
* **Estimated implementation complexity:** Medium
