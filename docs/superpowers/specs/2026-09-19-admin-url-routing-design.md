# Admin URL-Driven Navigation — Design

Date: 2026-09-19

## Problem

`apps/admin-web` uses React Router for its top-level pages (`/assets`, `/users`,
`/jobs`, …), but almost everything *inside* a page — tabs, sub-views, detail
drawers, add/edit modals, confirm-delete dialogs, even accordion expand/collapse
— is plain `useState`, invisible to the URL. The browser Back button therefore
either does nothing (no URL changed) or jumps straight past several UI states at
once to the previous top-level page. Grep across `apps/admin-web/src/pages`
found this pattern in 15 files: `AssetsPage` and its tabs (`GarmentTypesTab`,
`BackgroundsTab`, `FacesTab`, `PoseAssetsTab`, `CatalogTab`), `CatalogPage`,
`RecycleBinPage`, `JobsPage`, `CreditAnalysisPage`, `WorkflowsPage`,
`UsersPage`, `ShopifyStoresPage`, `ChatInboxPage`, `TelemetryPage`,
`DemoCatalogPage`.

Goal: every one of those transitions — including modals and confirm dialogs —
becomes a real URL change and a real back-button stop, one step per transition,
with no exceptions carved out for "just a dialog" or "just an accordion".

The one existing precedent, `AssetsContext`'s top-level tab (`?tab=`,
`AssetsContext.tsx:71-77`), already lives in the URL but uses
`{ replace: true }` — switching tabs today does *not* create a back-button
stop. That default flips as part of this work.

## Scope decomposition

This is too large for one implementation pass, so it's split in two:

- **Sub-project A (this spec):** establish the mechanism and prove it on one
  file, `GarmentTypesTab.tsx`, which exercises every layer we need — a
  top-level tab, a nested sub-view, two modals, and a confirm-delete dialog.
- **Sub-project B (separate, later):** apply the same mechanism to the
  remaining 14 files. Mechanical once A is proven; not designed here.

## Core mechanism

A shared hook, `useUrlState(key, defaultValue)` returning `[value, setValue]`,
used as a drop-in replacement for `useState` wherever a piece of UI state should
be a back-button stop. `setValue` **pushes** a new history entry by writing the
full merged query-param set (never `{ replace: true }`).

This works without any separate "view stack" data structure because the browser
history already snapshots the whole URL string at every push — that snapshot
*is* the stack. Three things open at once (tab + sub-view + modal) is simply
three params present in one URL string; pressing Back restores the previous
full combination automatically, regardless of how many params changed at once.

**Exception — switching tabs clears the old tab's deeper state.** The tab
setter doesn't merge; it writes `{ tab: newTab }` as the complete param set
(dropping any `view`/modal/confirm params that belonged to the previous tab),
still as a push instead of today's replace. This matches the existing
`setActiveTab` implementation almost exactly — the only change is removing
`{ replace: true }`.

**Excluded from URL-push:** free-text inputs (search boxes, live filters) stay
local `useState`. Pushing history on every keystroke would make the back-stack
unusable. Only discrete transitions (select a tab, open a view/modal/dialog,
expand an accordion row) push.

## Closing an overlay: Back-button parity

Every URL-tracked modal/drawer/confirm-dialog's "X" / "Cancel" control calls
`navigate(-1)` (real browser back) — it does **not** push a new state with the
param cleared. Pushing a "closed" state would leave a dead-end forward entry:
click X, then press the physical Back button, and the modal would reopen
instead of taking you further back. `navigate(-1)` makes the X button and the
physical Back button produce the identical result, because they're the same
operation.

Edge case: a direct/refreshed load can land on a URL that already has a modal
open, with no prior in-app history in that tab. `navigate(-1)` there could exit
the app. Fallback: track (a module-level flag or ref, set on the first
successful in-app push this session) whether there's any in-app history to go
back to; if not, "close" instead **replaces** to the computed parent URL (same
params, minus the top key) rather than calling back.

## Breadcrumb extension

`Topbar.tsx` already renders exactly this markup from a `trail: string[]` +
`onNavTrail(i)` pair passed down from `App.tsx` (currently just two levels:
`['Aivastra', pageLabel]`):

```html
<div class="crumbs">
  <button class="crumb-link">Aivastra</button><span class="sep">/</span><b>Dashboard</b>
</div>
```

Deeper crumb labels depend on data only the owning component has loaded (e.g. a
garment type's display name lives in `AssetsContext`, scoped to `AssetsPage`) —
`App.tsx` can't compute them top-down without lifting all page data up. Instead:

- A **breadcrumb registry** (context): any mounted component can register
  `{ label, href }` for its level; it deregisters on unmount. `href` is the
  computed URL for that depth (current params truncated to that key).
- `Topbar` renders whatever's currently registered, in order, as the existing
  `.crumbs` markup — no markup change, just a richer trail source.
- Clicking a crumb does a **plain `navigate(href)`** (a push), not a computed
  `history.go(-n)`. Simpler, matches how breadcrumbs behave in most apps.
  Side effect: pressing Back right after a crumb-click returns to the deep
  state you jumped *from*, not one level further up the trail — accepted as
  standard breadcrumb behavior, avoiding extra bookkeeping to keep
  Forward/Back perfectly linear across a crumb-jump.

## Pilot: `GarmentTypesTab.tsx`

Concrete param plan:

| State | Param(s) | Notes |
|---|---|---|
| Active tab (existing) | `tab` | Already exists; only change is dropping `replace: true` and clearing sibling params on switch. |
| Sub-view (list ↔ configs) | `view` (`configs`), `gtId` | `subView` currently holds the full `GarmentType` object in memory (`GarmentTypesTab.tsx:23`) — the URL can only hold an id. On load, resolve `gtId` against `garmentTypes` from `AssetsContext`, which loads on mount regardless of which tab is active, so a hard refresh resolves correctly too, not just in-session clicks. |
| Add garment type modal | `modal=add-garment-type` | Replaces `showSubcatModal`. |
| Edit garment type modal | `modal=edit-garment-type`, `editId` | Replaces `editingSubcat` (currently the full object — same id-resolution approach as `gtId`). |
| Confirm delete | `confirm=delete-garment-type`, `confirmId` | Replaces `confirmDelete`; the label shown in the dialog is re-derived from `confirmId` via the loaded list, not stored in the URL. |

`expandedGarmentTypeId` (accordion) also becomes a URL param
(`expanded=<id>`), per the "everything, including modals and accordions"
scope decision.

Each of the above registers a breadcrumb entry while active: e.g.
`Aivastra / Assets / Garment Types / Configs: Kurta / Edit`.

## Verification plan

- Manual: click through tab → sub-view → edit modal → confirm-delete, pressing
  physical Back at each step, confirming it un-nests exactly one layer at a
  time and never skips or reopens a dismissed layer.
- Manual: hard-refresh at each depth, confirming the view reconstructs from
  `AssetsContext`'s loaded lists. If an id in the URL (`gtId`/`editId`/
  `confirmId`) no longer resolves against the loaded list — e.g. the garment
  type was deleted since the URL was bookmarked — fall back to the tab's plain
  list view rather than rendering a broken sub-view.
- Manual: click each breadcrumb level, confirming it navigates to the expected
  ancestor URL and that the deeper state is gone (not just visually, the URL
  reflects it).
- No new automated test infra: `apps/admin-web` has no existing frontend test
  suite (no `.test.`/`.spec.` files, no `test` script in its `package.json`),
  so this stays manual, consistent with the rest of the app.
