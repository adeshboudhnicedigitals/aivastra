# Phase 6: Performance Audit

This document assesses the application's performance, load times, rendering overhead, and data transfer efficiency.

> **Triage note:** Resolved/skipped findings have been removed. For traceability:
> - **6.1 Missing Next.js Image Optimization** — Skip (structural incompatibility). `next.config.ts` sets `unoptimized: true` globally because NGINX basePath routing breaks the built-in image optimizer. Additionally, garment images come from blob URLs and presigned R2 URLs, which are structurally incompatible with `<Image>` (which needs static `src` strings). No-op to use `<Image>` here; the audit recommendation cannot be applied. `eslint-disable-next-line @next/next/no-img-element` suppression comments are appropriate and intentional.
> - **6.2 Heavy Hydration Payloads due to Inline Styles** — Rejected by design decision. `tokens.ts` + inline CSS variables is the intentional, enforced styling contract (same decision as 4.2). Migrating to Tailwind/CSS Modules would be a full rewrite of the entire UI with no product benefit. Not technical debt — it is the design system.
> - **6.3 Unoptimized Client-Side Image Uploads** — Skip (permanent product constraint). Compressing or resizing the uploaded garment photo before upload would degrade ComfyUI generation quality. Maximum pixel fidelity is required for the AI diffusion nodes. Do not implement image compression in the widget upload flow.
>
> - **6.4 BFF Duplicate Fetches** — N/A. All `(app)/` pages are `use client` components — there are no Server Components fetching data in this application. The BFF routes in `apps/web/src/app/api/` handle auth only. HydrationBoundary/dehydrate has no applicable surface. Closing as not applicable.
>
> All findings in Phase 6 are now resolved or marked N/A.
