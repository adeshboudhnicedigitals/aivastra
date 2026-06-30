# Phase 4: Design System Audit

This document evaluates the UI consistency, styling architecture, and the scalability of the design system used across the application.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **4.1 Anti-Pattern: Heavy Reliance on JS Event Handlers for Styling** — Done. 11 elements were migrated from JS synthetic events (`onMouseEnter`/`Leave`) to pure CSS pseudo-classes (`.btn-hover-opacity`, `.hover-brightness`, etc.).
> - **4.2 Design System Fragmentation (Tailwind vs Vanilla CSS)** — Rejected by design decision. `tokens.ts` + inline CSS variables is the intentional design language. Tailwind migration would be a full rewrite with no product benefit. `tailwind.config.ts` exists as a Next.js scaffold artifact — it is not actively used and not worth removing.
> - **4.3 Hardcoded Responsive Breakpoints** — Skip. Merchant portal is a desktop-first admin SPA; mobile layout is not a product requirement at this stage. Widget is iframe-embedded and sized by the merchant. Inline styles are the intentional design language per 4.2 decision.
> - **4.4 Inconsistent Theming Strategy** — Partially done. The audit cited `error.tsx` and `confirm-dialog.tsx`. `confirm-dialog.tsx` already used `C.*` tokens throughout (audit was wrong). `error.tsx` line 19 fixed: `background: '#fff'` → `background: C.bg`. Remaining hardcoded hex values in other files are a known ongoing concern, not a discrete finding.
>
> All findings in Phase 4 are now resolved or skipped.
