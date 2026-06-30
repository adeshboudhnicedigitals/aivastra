# Phase 6: Performance Audit

This document assesses the application's performance, load times, rendering overhead, and data transfer efficiency.

## Finding 6.1: Missing Next.js Image Optimization
* **Severity:** High
* **Evidence:** Across the application (e.g., `apps/web/src/components/logo.tsx`, `apps/web/src/app/(widget)/widget/render/[key]/page.tsx`), standard `<img>` tags are used with `eslint-disable-next-line @next/next/no-img-element`.
* **Exact files involved:** Multiple files containing `<img src=... />`
* **User impact:** Users download full-resolution images even on mobile devices. Heavy layout shifts (CLS - Cumulative Layout Shift) occur as images load without predefined aspect ratios.
* **Business impact:** Poor Core Web Vitals (CWV) scores negatively impact merchant site performance if the widget is embedded.
* **Technical impact:** Bypasses Next.js automatic WebP/AVIF conversion, lazy loading, and sizing.
* **Recommendation:** Replace `<img>` tags with Next.js `<Image>` components. Configure `next.config.js` to allow remote patterns for the R2/S3 bucket domains.
* **Estimated implementation complexity:** Low

## Finding 6.2: Heavy Hydration Payloads due to Inline Styles
* **Severity:** Medium
* **Evidence:** Extensive use of `style={{ display: 'flex', flexDirection: 'column', ... }}` injects massive amounts of redundant styling directly into the DOM tree and the React hydration payload.
* **Exact files involved:** Virtually all files in `apps/web/src/components/` and `apps/web/src/app/`
* **User impact:** Slower Time to Interactive (TTI) on lower-end devices due to React having to parse and apply thousands of inline style properties during hydration.
* **Business impact:** Marginally worse SEO and performance metrics.
* **Technical impact:** Bloated HTML payload over the wire.
* **Recommendation:** Transition to static CSS classes (Vanilla Extract, CSS Modules, or Tailwind) so styles are cached via CSS stylesheets rather than parsed per element by JavaScript.
* **Estimated implementation complexity:** High

## Finding 6.3: Unoptimized Client-Side Image Uploads
* **Severity:** High
* **Evidence:** The upload flow (`apps/web/src/lib/api.ts` -> `uploadToR2WithProgress`) takes raw user files (which can easily exceed 10MB from modern smartphones) and uploads them directly to S3 without client-side compression or resizing.
* **Exact files involved:** `apps/web/src/lib/api.ts`, `apps/web/src/app/(widget)/widget/render/[key]/page.tsx`
* **User impact:** Extremely slow upload times on 4G/3G networks, leading to a high drop-off rate before the generation even begins.
* **Business impact:** Lost conversions. High ingress bandwidth costs.
* **Technical impact:** Requires client-side processing before the PUT request.
* **Recommendation:** Implement client-side image compression (e.g., using `browser-image-compression` or an off-main-thread Web Worker) to resize uploads to a maximum reasonable dimension (e.g., 2048px max edge) and convert to JPEG/WEBP before requesting the presigned URL.
* **Estimated implementation complexity:** Medium

## Finding 6.4: Duplicated API Requests via BFF
* **Severity:** Low
* **Evidence:** Next.js Server Components might fetch data directly, while Client Components use React Query to fetch data via the BFF API routes. Unless properly dehydrated and passed as initial data, the client will blindly re-fetch data the server already knew about.
* **Exact files involved:** `apps/web/src/app/api/...`, `apps/web/src/components/providers.tsx`
* **User impact:** Brief flashes of loading states on hard navigations.
* **Business impact:** None significant, but breaks the illusion of speed.
* **Technical impact:** Redundant database hits.
* **Recommendation:** Use React Query's `HydrationBoundary` and `dehydrate` to pass server-fetched query states to the client, preventing the client from re-fetching on mount.
* **Estimated implementation complexity:** Medium
