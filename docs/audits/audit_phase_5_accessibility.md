# Phase 5: Accessibility Audit

This document evaluates the platform against accessibility (a11y) standards, focusing on keyboard navigation, screen reader compatibility, and ARIA attributes.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **5.1 Missing ARIA Live Regions** — Done. `aria-live="polite" aria-atomic="true"` wraps the processing status text in the widget; `role="alert" aria-live="assertive" aria-atomic="true"` wraps the error container. Both in `apps/web/src/app/(widget)/widget/render/[key]/page.tsx`.
> - **5.3 Focus Trapping in Modals** — Done. `SupportModal`: `modalRef` + `role="dialog" aria-modal="true" aria-labelledby="support-modal-title"` on modal div; `id="support-modal-title"` on heading; `useEffect` trap auto-focuses first element, cycles Tab/Shift+Tab, Escape → close; `SupportButton` uses `triggerRef` + `requestAnimationFrame` return-focus on close. `ConfirmDialog`: `dialogRef` + `role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title"` on inner panel (not backdrop); `id="confirm-dialog-title"` on `<h3>`; `useEffect` trap auto-focuses confirm button (intentional — Enter-to-confirm UX). Backdrop demoted to `role="presentation"`. Both in `apps/web/src/components/SupportModal.tsx` and `apps/web/src/components/ui/confirm-dialog.tsx`.
> - **5.2 PremiumSelect ARIA** — Done. Added `role="combobox"`, stable `useId()` for `listboxId`, `aria-controls`, and `aria-activedescendant`.
> - **5.4 Missing Focus Visible Outlines** — Done. Removed `outline: 'none'` and applied a global `.focus-ring` utility class for keyboard-driven focus rings on interactive elements.
>
> All findings in this phase have been fully resolved.


