# Admin URL-Driven Navigation — Standard

Applies to every page in `apps/admin-web`. Follow this for any new page and
when touching an existing page that still uses plain `useState` for
navigation-shaped UI (tabs, sub-views, detail drawers, modals, confirm
dialogs, expand/collapse).

Origin: proven on `GarmentTypesTab.tsx` and rolled out to `JobsPage.tsx` /
`UsersPage.tsx`. Full history and rationale:
`docs/superpowers/specs/2026-09-19-admin-url-routing-design.md` (mechanism
design) and `docs/superpowers/plans/2026-09-19-admin-url-routing-jobs-users.md`
(a worked example — copy its per-state param tables as a template for the next
page). This doc is the distilled rule set; read those two for the "why" behind
an edge case not covered here.

## The governing rule

**A URL param only if it affects navigation** — which record or dialog is
currently open.

- Navigation → URL param: active tab, master/detail selection, which
  modal/drawer/confirm-dialog is open, which accordion row is expanded, which
  sub-tab within an expanded row.
- Not navigation → stays local `useState`: search boxes, filters, sort order,
  page number, date ranges, "show all" density toggles, selection sets for
  bulk actions, in-flight/loading/saving flags, form field values, any cache
  keyed by id (e.g. a `Record<id, detail>` map).

When in doubt, ask: *if a teammate pasted me this URL, should it reopen this
exact state?* If yes, it's a param. If it's just how the list is currently
sliced, it isn't.

## Hard constraints

- **Never put a password (or any secret/credential) in a URL param.** Password
  fields (`newPasswordInput`, `deleteAssetsPassword`, and anything like them)
  stay local `useState` for their entire lifetime, no exceptions.
- **Closing an overlay always goes through `useCloseOverlay`.** Never a manual
  `setSearchParams`/`navigate` call to clear a param — see "Closing an
  overlay" below for why.
- **A stale or unresolvable id in the URL falls back to the plain list view**,
  not a broken render. Either resolve it against already-loaded data (client
  list lookup) or let the API's 404 surface as an error toast that leaves the
  page in a sane state — never a crash.
- **Free-text/live-filter inputs never push history.** Pushing on every
  keystroke makes the back-stack unusable.

## The three hooks — reuse verbatim, never reimplement

All three live in `apps/admin-web/src/`:

| Hook | File | Purpose |
|---|---|---|
| `useUrlState(key)` | `hooks/use-url-state.ts` | One query param as `[value, setValue]`. `setValue` always **pushes** (never `{ replace: true }`). |
| `useUrlStateMulti(keys)` | `hooks/use-url-state.ts` | Several params read/written atomically in one push — use whenever two-or-more params represent one logical state (e.g. `confirm` + `confirmId`, `modal` enum), so entering/leaving it is one history entry, not several. |
| `useCloseOverlay(ownParamKeys)` | `hooks/use-close-overlay.ts` | The only correct way to close a URL-tracked overlay. |
| `useCrumb(depth, crumb)` | `context/BreadcrumbContext.tsx` | Registers `{ label, href }` at a fixed depth for as long as the component is mounted with non-null `crumb`; auto-clears on unmount. `Topbar` renders whatever's currently registered. |

### Why `useCloseOverlay`, not a manual close

Every "X" / "Cancel" / overlay-click-outside control must call
`useCloseOverlay`'s returned function, not push a new URL with the param
cleared. Pushing a "closed" state leaves a dead-end forward entry: click X,
then press the physical Back button, and the overlay reopens instead of going
further back.

`useCloseOverlay` calls `navigate(-1)` (real browser back) when this tab has
prior in-app history (tracked via `hasInAppNavigation()` in
`hooks/use-in-app-navigation.ts`), so the X button and the physical Back
button are the literally same operation. When there's no in-app history to go
back to — a fresh load or a refresh landing directly on a URL that already has
the overlay open — it falls back to a `replace` that strips only
`ownParamKeys`, preserving every sibling param.

### Why `useUrlStateMulti` for grouped state

Use it whenever a "kind" param and an "id" param travel together — e.g.
`confirm=cancel-job&confirmId=<id>`, or a `modal` enum consumed by several
different open functions. Writing both atomically means the back-stack has one
entry for "dialog opened," not two.

## Pattern for a master/detail view (list ↔ one record)

```ts
const [idParam, setIdParam] = useUrlState('recordId');
const closeDetail = useCloseOverlay(['recordId']);

// Reconstructs from the URL alone — hard refresh, deep link, or Back
// restoring a previous value. Skipped when openDetail already seeded
// `detail` for this same id, so a row click doesn't double-fetch.
useEffect(() => {
  if (!idParam || detail?.id === idParam) return;
  // fetch and setDetail(...)
}, [idParam, detail?.id]);

useCrumb(0, detail ? { label: someLabel(detail), href: `/page?recordId=${encodeURIComponent(detail.id)}` } : null);

const openDetail = (record) => {
  setDetail(record);          // optimistic
  setIdParam(record.id);      // pushes
  // then fetch full detail and setDetail again on resolve
};
```

"Back to list" / breadcrumb-root button calls `closeDetail`, never
`setDetail(null)` directly.

## Pattern for a confirm dialog or modal enum

```ts
const [{ confirm: confirmParam, confirmId }, setConfirmParams] = useUrlStateMulti(['confirm', 'confirmId']);
const confirmDeleteId = confirmParam === 'delete-thing' ? confirmId : null;
const closeConfirm = useCloseOverlay(['confirm', 'confirmId']);
const openConfirmDelete = (id: string) => setConfirmParams({ confirm: 'delete-thing', confirmId: id });
```

For a page with several mutually-exclusive modals, use one `modal` param with
string-literal values (`'adjust-credits' | 'edit-merchant' | 'create-user' | …`)
rather than a boolean `useState` per modal — see `UsersPage.tsx` for the
worked example of an 8-value enum sharing one param and one breadcrumb slot.

## Pattern for an expand/collapse row (accordion)

```ts
const [{ expanded, expandedSubtab }, setAccordionParams] = useUrlStateMulti(['expanded', 'expandedSubtab']);
const closeAccordion = useCloseOverlay(['expanded', 'expandedSubtab']);
```

Only the currently-expanded row's sub-tab needs tracking — switching which row
is expanded resets the sub-tab (don't try to preserve a per-row sub-tab map in
the URL; that was the old in-memory behavior and isn't worth the param
complexity).

Accordion rows do **not** get a breadcrumb slot (no precedent for it, and a
mobile-only accordion isn't part of the desktop navigation trail).

## Cross-page linking replaces `location.state`

`navigate(path, { state })` is invisible to the URL and lost on refresh. Any
"go to X and land on this specific nested view" cross-link becomes a query
param on the destination instead:

```ts
// old: onNav('users', { page: 'users', userId, jobId })
// new:
navigate(`/users?user=${encodeURIComponent(userId)}&jobPreview=${encodeURIComponent(jobId)}`);
```

The one accepted exception: seeding a **filter/search box** on the destination
page (e.g. "Jobs generated" stat card seeding Jobs' search field with a user's
email). That's filter state, not navigation, so per the governing rule it's
allowed to keep using `location.state` and does not need to survive a refresh
— this mirrors `JobsPage`/`UsersPage`'s own accepted regression, not a gap to
close later.

## Breadcrumb depth numbering

Depths are per-page (only one top-level page is mounted at a time via
`<Routes>`, so numbers don't collide across pages). Pick depths bottom-up as
you design the param table for a page, e.g.:

```
0 = detail view
1 = confirm dialog
2 = modal (shared enum, if several modals share one param)
3 = a popup nested inside the detail view (e.g. job-preview from Users)
```

Write the full depth table into the page's own implementation plan before
coding — see the Jobs/Users plan's "Global Constraints" section for the
worked example.

## Verification checklist for any page migrated to this pattern

`apps/admin-web` has no frontend test suite — verification is
`pnpm --filter @aivastra/admin build` (typecheck) + `pnpm --filter @aivastra/admin lint`,
plus manual browser QA:

- [ ] Click into each URL-tracked state (tab/detail/modal/confirm/accordion);
      confirm the URL changes and a browser Back stop is created.
- [ ] Press physical Back at each depth; confirm it un-nests exactly one layer,
      never skips or reopens a dismissed layer.
- [ ] Hard-refresh at each depth; confirm the view reconstructs correctly from
      already-loaded context or a fresh fetch.
- [ ] Manually edit the URL to a non-existent id; confirm an error
      toast/fallback, never a crash.
- [ ] Click every breadcrumb level; confirm it navigates to the expected
      ancestor URL with deeper params actually gone (check the URL bar, not
      just the visible UI).
- [ ] Confirm no password ever appears in the URL bar at any point.
- [ ] Confirm list filters/sort/page are unaffected and still not reflected in
      the URL.

## When this doesn't apply

`apps/admin-mobile` is paused (see root `CLAUDE.md`) — don't apply this there.
Other apps (`catalogues-web`, `shopify`) have their own routing conventions
(Next.js App Router, React Router with a different base path) and are out of
scope for this doc.
