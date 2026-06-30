# Phase 5: Accessibility Audit

This document evaluates the platform against accessibility (a11y) standards, focusing on keyboard navigation, screen reader compatibility, and ARIA attributes.

> **Triage note:** Resolved findings have been removed. For traceability:
> - **5.1 Missing ARIA Live Regions** — Done. `aria-live="polite" aria-atomic="true"` wraps the processing status text in the widget; `role="alert" aria-live="assertive" aria-atomic="true"` wraps the error container. Both in `apps/web/src/app/(widget)/widget/render/[key]/page.tsx`.
> - **5.3 Focus Trapping in Modals** — Done. `SupportModal`: `modalRef` + `role="dialog" aria-modal="true" aria-labelledby="support-modal-title"` on modal div; `id="support-modal-title"` on heading; `useEffect` trap auto-focuses first element, cycles Tab/Shift+Tab, Escape → close; `SupportButton` uses `triggerRef` + `requestAnimationFrame` return-focus on close. `ConfirmDialog`: `dialogRef` + `role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title"` on inner panel (not backdrop); `id="confirm-dialog-title"` on `<h3>`; `useEffect` trap auto-focuses confirm button (intentional — Enter-to-confirm UX). Backdrop demoted to `role="presentation"`. Both in `apps/web/src/components/SupportModal.tsx` and `apps/web/src/components/ui/confirm-dialog.tsx`.
>
> Only the findings below remain open.

## Finding 5.2: Flawed Custom Dropdown Accessibility
* **Severity:** Medium
* **Evidence:** The `PremiumSelect` component implements custom keyboard navigation (Arrow keys, Enter, Escape) and uses `role="listbox"` and `role="option"`. However, the trigger button uses `aria-haspopup="listbox"` but lacks `aria-controls` pointing to the listbox ID, and `aria-activedescendant` is not used to manage focus.
* **Exact files involved:** `apps/web/src/components/ui/premium-select.tsx`
* **User impact:** Screen readers will struggle to associate the options with the trigger button or announce the currently focused option during keyboard navigation.
* **Business impact:** Degraded experience for power users and users with motor/visual disabilities.
* **Technical impact:** Custom components require meticulous ARIA attribute orchestration.
* **Recommendation:** Utilize a headless UI library (like Radix UI or React Aria) for complex interactive primitives rather than building and managing focus/ARIA states manually.
* **Estimated implementation complexity:** Medium

## Finding 5.4: Missing Focus Visible Outlines
* **Severity:** Medium
* **Evidence:** Global CSS explicitly customizes focus rings (e.g., `focus-visible`), but many custom inline-styled elements lack focus outlines or use `outline: 'none'` without providing a custom visual focus indicator.
* **Exact files involved:** `apps/web/src/components/ui/premium-date-range.tsx`, `apps/web/src/components/ui/premium-select.tsx`
* **User impact:** Sighted keyboard users cannot determine which element currently holds focus.
* **Business impact:** Frustrating UX for power users.
* **Technical impact:** None.
* **Recommendation:** Remove `outline: 'none'` from interactive elements unless replacing it with a clear `box-shadow` or custom border indicator driven by `:focus-visible`.
* **Estimated implementation complexity:** Low
