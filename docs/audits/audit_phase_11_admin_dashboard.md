# Phase 11: Admin Dashboard Audit

This document explicitly evaluates the internal admin application (`apps/admin`), which operates as a separate Vite/React SPA. This audit highlights critical gaps where the admin dashboard falls short of production-grade, enterprise SaaS standards.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **11.1 Primitive Data Visualization** — Done. Replaced custom div-based sparklines in `DashboardPage.tsx` with interactive Recharts `<BarChart>` and `<Tooltip>`, preserving existing data wiring.
>
> Only the findings below remain open.


## Finding 11.2: Inferior Real-Time UX (Polling Anti-Pattern)
* **Severity:** High
* **Evidence:** Despite the Fastify backend supporting advanced Redis PubSub and SSE streams for real-time job updates, the admin dashboard relies on a rudimentary 30-second polling loop (`setInterval(fetchStats, 30_000)`).
* **Exact files involved:** `apps/admin/src/pages/DashboardPage.tsx`
* **User impact:** Admins viewing the dashboard during an active incident or traffic spike are always up to 30 seconds behind reality. The UI flashes jarringly on every full refresh.
* **Business impact:** Slower incident response times.
* **Technical impact:** Unnecessary repeated load on the Fastify API and Postgres database for data that hasn't changed.
* **Recommendation:** Deprecate polling. Integrate the existing SSE infrastructure (`/v1/jobs/stream`) to push live metric deltas to the dashboard in real-time, matching the widget's capabilities.
* **Estimated implementation complexity:** High

## Finding 11.3: Fragmented and Unpolished Styling (Lack of UI Library)
* **Severity:** Medium
* **Evidence:** The UI mixes legacy CSS classes (`className="page-head"`, `className="banner"`) with hardcoded inline styles (`style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}`). 
* **Exact files involved:** `apps/admin/src/pages/DashboardPage.tsx`, `apps/admin/src/components/Topbar.tsx`
* **User impact:** The interface feels rigid, unpolished, and lacks the smooth micro-animations, consistent spacing, and aesthetic quality ("WOW factor") expected in modern tooling.
* **Business impact:** Lowers the perceived quality of the internal platform, leading to admin fatigue.
* **Technical impact:** High maintenance burden for frontend engineers trying to align new components.
* **Recommendation:** Adopt a professional component library (e.g., shadcn/ui with Tailwind CSS or Radix UI primitives) to ensure perfect accessibility, consistent spacing, and premium aesthetics.
* **Estimated implementation complexity:** High

## Finding 11.4: Dead-End Metrics and Poor Information Hierarchy
* **Severity:** Medium
* **Evidence:** The dashboard presents aggregated numbers (e.g., "Queue depth: 15", "Active users today") but these are dead ends. While some buttons link to filtered lists (`?filter=QUEUED`), the context is frequently lost.
* **Exact files involved:** `apps/admin/src/pages/DashboardPage.tsx`
* **User impact:** Admins see an alert (e.g., "Worker capacity degraded") but must manually navigate to a separate page and hunt for the failing node rather than having an inline diagnostic panel.
* **Business impact:** Slower operational workflows.
* **Technical impact:** None.
* **Recommendation:** Implement contextual drill-downs. Clicking a failing metric should open a slide-out side panel (Sheet/Drawer) with the exact logs, affected users, or failing worker traces without losing the dashboard context.
* **Estimated implementation complexity:** Medium

## Finding 11.5: Brittle Theming and State Sync
* **Severity:** Low
* **Evidence:** The theme mechanism (`apps/admin/src/App.tsx`) manually manipulates DOM attributes (`document.documentElement.setAttribute`) and debounces server syncs with `setTimeout`.
* **Exact files involved:** `apps/admin/src/App.tsx`
* **User impact:** Potential race conditions if an admin clicks quickly between theme states.
* **Business impact:** None.
* **Technical impact:** Brittle React code bridging imperative DOM mutations.
* **Recommendation:** Use a standard theme provider (e.g., `next-themes` adapted for Vite) and rely on React Query mutations with optimistic UI updates for server syncing, rather than manual debouncing.
* **Estimated implementation complexity:** Low
