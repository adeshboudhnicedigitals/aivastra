# Phase 4: Design System Audit

This document evaluates the UI consistency, styling architecture, and the scalability of the design system used across the application.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **4.2 Design System Fragmentation (Tailwind vs Vanilla CSS)** — Rejected by design decision. `tokens.ts` + inline CSS variables is the intentional design language. Tailwind migration would be a full rewrite with no product benefit. `tailwind.config.ts` exists as a Next.js scaffold artifact — it is not actively used and not worth removing.
> - **4.4 Inconsistent Theming Strategy** — Partially done. The audit cited `error.tsx` and `confirm-dialog.tsx`. `confirm-dialog.tsx` already used `C.*` tokens throughout (audit was wrong). `error.tsx` line 19 fixed: `background: '#fff'` → `background: C.bg`. Remaining hardcoded hex values in other files are a known ongoing concern, not a discrete finding.
>
> Only the findings below remain open.

## Finding 4.1: Anti-Pattern: Heavy Reliance on JS Event Handlers for Styling
* **Severity:** High
* **Evidence:** Across numerous components (e.g., `PremiumSelect`, `DarkBtn`, `GradBtn`), hover and focus states are implemented using React synthetic events (`onMouseEnter`, `onMouseLeave`, `onFocus`) to mutate `e.currentTarget.style.opacity` or `background`.
* **Exact files involved:** `apps/web/src/components/ui/premium-select.tsx`, `apps/web/src/components/ui/dark-btn.tsx`, `apps/web/src/components/ui/premium-date-range.tsx`
* **User impact:** Noticeable interaction latency on lower-end devices. Re-renders triggered by state changes can cause hover states to stick or behave erratically.
* **Business impact:** A sub-premium feel that contradicts the "WOW factor" goal of the UI.
* **Technical impact:** Bypasses the browser's highly optimized CSS engine. Prevents pseudo-classes (`:hover`, `:active`, `:focus-visible`) from working correctly with CSS transitions.
* **Recommendation:** Move all interactive styling to CSS classes or CSS modules. Utilize native pseudo-classes and remove all JS-based style mutations.
* **Estimated implementation complexity:** Medium

## Finding 4.3: Hardcoded Responsive Breakpoints
* **Severity:** Medium
* **Evidence:** The application uses inline styles extensively, which do not support CSS media queries. The only media query found is in `globals.css` for a specific `.auth-image-panel`.
* **Exact files involved:** `apps/web/src/components/topbar.tsx`, `apps/web/src/components/sidebar.tsx`
* **User impact:** The merchant portal and widget are unlikely to be fully responsive on mobile devices or varying screen sizes.
* **Business impact:** Poor mobile experience frustrates users checking dashboards on the go.
* **Technical impact:** Implementing responsive design requires rewriting inline styles into standard CSS/Tailwind.
* **Recommendation:** Refactor layout components (`TopBar`, `Sidebar`, Grids) to use a standardized responsive grid system.
* **Estimated implementation complexity:** High

