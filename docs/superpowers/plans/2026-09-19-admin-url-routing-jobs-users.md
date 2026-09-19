# Admin URL-Driven Navigation — Jobs & Users Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the URL-driven navigation mechanism proven in Sub-project A (`GarmentTypesTab.tsx`) to `JobsPage.tsx` and `UsersPage.tsx`, so every modal, confirm dialog, master/detail view, and cross-page deep link becomes a real URL and a real back-button stop.

**Architecture:** No new mechanism. Reuse `useUrlState`/`useUrlStateMulti` (push-based query-param state), `useCloseOverlay` (Back-button-parity close), and `useCrumb` (breadcrumb registry) exactly as built in Sub-project A. The only new work is per-page: identifying which local `useState` represents navigation (→ URL param) versus list-viewing/filtering (→ stays local).

**Tech Stack:** React 18, React Router v6 (`react-router-dom`), existing hooks in `apps/admin-web/src/hooks/use-url-state.ts`, `use-close-overlay.ts`, `use-in-app-navigation.ts`, and `apps/admin-web/src/context/BreadcrumbContext.tsx`.

## Global Constraints

- Reuse hooks verbatim — do not create new ones: `useUrlState(key)` and `useUrlStateMulti(keys)` from `apps/admin-web/src/hooks/use-url-state.ts`; `useCloseOverlay(ownParamKeys)` from `apps/admin-web/src/hooks/use-close-overlay.ts`; `useCrumb(depth, crumb)` / `Crumb` type from `apps/admin-web/src/context/BreadcrumbContext.tsx`.
- Governing rule (spec, `docs/superpowers/specs/2026-09-19-admin-url-routing-design.md`, "Sub-project B" section): a URL param only if it affects **navigation** — which record/dialog is open. Filtering, sorting, and paging the same list stays local `useState`, unchanged in this rollout.
- **Hard constraint:** no password field (`newPasswordInput`, `deleteAssetsPassword`) may ever be written into a URL param, in this rollout or any future one. They stay local `useState` for their entire lifetime.
- Every URL-tracked overlay's "close" affordance (X, Cancel, overlay-click, Back-to-list button) goes through `useCloseOverlay`, never a manual `setSearchParams`/`navigate` call.
- When an id-bearing param doesn't resolve (deleted record, stale bookmark), the page falls back to its plain list view rather than rendering a broken state — same principle as the pilot's stale-id fallback, though here it's enforced by the API 404 path (see Task 1) rather than a local-list lookup.
- `apps/admin-web` has no frontend test suite (no `.test.`/`.spec.` files, no `test` script). Verification per task is: `pnpm --filter @aivastra/admin build` (typecheck) + `pnpm --filter @aivastra/admin lint`, plus a manual browser checklist executed by a human (no browser automation is available in this environment — confirmed repeatedly during Sub-project A).
- Breadcrumb depths are per-page (only one top-level page is mounted at a time via `<Routes>`, so depth numbers don't collide across pages). This rollout uses: **JobsPage** — 0 = job detail, 1 = confirm dialog, 2 = delete-assets modal. **UsersPage** — 0 = user detail, 1 = confirm dialog, 2 = modal (shared enum across Tasks 6–7), 3 = job-preview popup. The mobile accordion (Task 3) gets no breadcrumb slot, matching the pilot's own accordion precedent.

---

### Task 1: JobsPage — detail view via `job=` param

**Files:**
- Modify: `apps/admin-web/src/pages/JobsPage.tsx`

**Interfaces:**
- Consumes: `useUrlState(key)` from `../hooks/use-url-state`; `useCloseOverlay(ownParamKeys)` from `../hooks/use-close-overlay`; `useCrumb(depth, crumb)` from `../context/BreadcrumbContext`.
- Produces: `jobIdParam: string | null`, `closeDetail: () => void`, `openDetail(j: Job): void` (unchanged signature) — Task 2 and Task 9 both use these.

Today, `detail`/`detailLoading` are plain `useState`, opened by `openDetail(j)` on row click and reconstructed on deep link via a `useEffect` keyed on `location.state.jobId` (`requestedJobId`). This task makes the URL the source of truth: `job=<id>` replaces both mechanisms.

- [ ] **Step 1: Add the new imports**

At the top of `apps/admin-web/src/pages/JobsPage.tsx`, alongside the existing imports, add:

```ts
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
```

- [ ] **Step 2: Replace `requestedJobId`'s derivation and the detail state**

Find (near the top of `JobsPage`, right after `const { hasPermission } = useAuth();`):

```ts
  const requestedJobId = (location.state as { jobId?: string })?.jobId;
  const requestedFromUserId = (location.state as { fromUserId?: string })?.fromUserId;
```

Replace with:

```ts
  const [jobIdParam, setJobIdParam] = useUrlState('job');
  const closeDetail = useCloseOverlay(['job']);
  // Converted to a real URL param in Task 9 of the Jobs/Users rollout plan —
  // left on location.state for now so this task's diff stays scoped to the
  // detail view itself.
  const requestedFromUserId = (location.state as { fromUserId?: string })?.fromUserId;
```

- [ ] **Step 3: Replace the `detail`/`detailLoading` state declarations**

Find:

```ts
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
```

Leave these two lines exactly as they are — they still hold the loaded detail object and its loading flag locally. Only their *derivation* changes, in the next step.

- [ ] **Step 4: Replace the `requestedJobId` reconstruction effect**

Find the effect:

```ts
  useEffect(() => {
    if (!requestedJobId) return;
    let cancelled = false;
    setDetailLoading(true);
    apiFetch<JobDetail>(`/admin/jobs/${requestedJobId}`)
      .then((job) => {
        if (!cancelled) setDetail(job);
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            kind: 'error',
            title: 'Failed to load job detail',
            body: apiErrorMessage(e, 'Please try again.'),
          });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestedJobId, toast]);
```

Replace with:

```ts
  // Reconstructs the detail view from the URL alone — covers a hard refresh,
  // a deep link, and the physical Back button restoring a previous `job=`
  // value. Skipped when `openDetail` already seeded `detail` optimistically
  // for this same id (see Step 6), so a row click doesn't double-fetch.
  useEffect(() => {
    if (!jobIdParam || detail?.id === jobIdParam) return;
    let cancelled = false;
    setDetailLoading(true);
    apiFetch<JobDetail>(`/admin/jobs/${jobIdParam}`)
      .then((job) => {
        if (!cancelled) setDetail(job);
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            kind: 'error',
            title: 'Failed to load job detail',
            body: apiErrorMessage(e, 'Please try again.'),
          });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobIdParam, detail?.id, toast]);

  useCrumb(
    0,
    detail
      ? { label: `Job ${detail.id.slice(0, 8)}…`, href: `/jobs?job=${encodeURIComponent(detail.id)}` }
      : null,
  );
```

- [ ] **Step 5: Delete the stale reset effect's now-redundant `deleteAssetsOpen` line**

This effect is touched again in Task 2; leave it alone for this task.

- [ ] **Step 6: Update `openDetail` to push the URL**

Find:

```ts
  const openDetail = async (j: Job) => {
    setDetail(j);
    setDetailLoading(false);
    try {
      const full = await apiFetch<JobDetail>(`/admin/jobs/${j.id}`);
      setDetail(full);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load full job detail',
        body: apiErrorMessage(e, 'Displaying cached job info.'),
      });
    }
  };
```

Replace with:

```ts
  const openDetail = async (j: Job) => {
    setDetail(j);
    setDetailLoading(false);
    setJobIdParam(j.id);
    try {
      const full = await apiFetch<JobDetail>(`/admin/jobs/${j.id}`);
      setDetail(full);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load full job detail',
        body: apiErrorMessage(e, 'Displaying cached job info.'),
      });
    }
  };
```

- [ ] **Step 7: Wire the "Back to jobs" button through `closeDetail`, and fix the "Back to user" condition**

Find:

```tsx
            {requestedFromUserId && requestedJobId === j.id ? (
              <button
                className="btn ghost"
                onClick={() =>
                  onNav('users', {
                    page: 'users',
                    userId: requestedFromUserId,
                    jobId: requestedJobId,
                  })
                }
              >
                <Icon.Back /> Back to user
              </button>
            ) : (
              <button className="btn ghost" onClick={() => setDetail(null)}>
                <Icon.Back /> Back to jobs
              </button>
            )}
```

Replace with:

```tsx
            {requestedFromUserId && jobIdParam === j.id ? (
              <button
                className="btn ghost"
                onClick={() =>
                  onNav('users', {
                    page: 'users',
                    userId: requestedFromUserId,
                    jobId: jobIdParam,
                  })
                }
              >
                <Icon.Back /> Back to user
              </button>
            ) : (
              <button className="btn ghost" onClick={closeDetail}>
                <Icon.Back /> Back to jobs
              </button>
            )}
```

(The "Back to user" branch is converted to a real URL in Task 9 — this step only fixes the reference from the removed `requestedJobId` to `jobIdParam` so the file compiles and behaves identically in the meantime.)

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds, no TS errors (in particular, no leftover reference to `requestedJobId`).

Run: `pnpm --filter @aivastra/admin lint`
Expected: no new warnings introduced by this diff.

- [ ] **Step 9: Manual verification**

With `pnpm --filter @aivastra/api dev` and `pnpm --filter @aivastra/admin dev` running:
1. Open `/jobs`, click a row → URL becomes `/jobs?job=<id>`, detail view shows.
2. Press browser Back → URL returns to `/jobs`, list view shows (not a blank page, not app exit).
3. Hard-refresh while on `/jobs?job=<id>` → detail view reconstructs (loading state briefly, then full detail).
4. Manually edit the URL to `/jobs?job=00000000-0000-0000-0000-000000000000` (a non-existent id) → an error toast appears ("Failed to load job detail"); the page does not crash.
5. Click "Back to jobs" button → same result as pressing physical Back (returns to list, URL loses `job=`).

- [ ] **Step 10: Commit**

```bash
git add apps/admin-web/src/pages/JobsPage.tsx
git commit -m "feat(admin): drive Jobs page detail view from a job= URL param"
```

---

### Task 2: JobsPage — confirm-cancel, delete-assets, and flush-queue dialogs

**Files:**
- Modify: `apps/admin-web/src/pages/JobsPage.tsx`

**Interfaces:**
- Consumes: `jobIdParam`, `closeDetail` from Task 1; `useUrlState`, `useUrlStateMulti`, `useCloseOverlay`, `useCrumb`.
- Produces: `confirmCancelJobId: string | null`, `confirmFlush: boolean`, `deleteAssetsOpen: boolean`, `openConfirmCancel(jobId: string)`, `openConfirmFlush()`, `closeConfirm()`, `openDeleteAssetsModal()`, `closeDeleteAssetsModal()` — none consumed by later tasks, but must not collide with Task 6/7's UsersPage `modal`/`confirm` names (different file, no actual collision risk).

- [ ] **Step 1: Add the shared `confirm` and `modal` param state**

Add `useUrlStateMulti` to the Step 1 import line from Task 1 (now: `import { useUrlState, useUrlStateMulti } from '../hooks/use-url-state';`).

Near the top of `JobsPage`, after the `closeDetail` line from Task 1, add:

```ts
  const [{ confirm: confirmParam, confirmId }, setConfirmParams] = useUrlStateMulti([
    'confirm',
    'confirmId',
  ]);
  const confirmCancelJobId = confirmParam === 'cancel-job' ? confirmId : null;
  const confirmFlush = confirmParam === 'flush-queue';
  const closeConfirm = useCloseOverlay(['confirm', 'confirmId']);
  const openConfirmCancel = (jobId: string) =>
    setConfirmParams({ confirm: 'cancel-job', confirmId: jobId });
  const openConfirmFlush = () => setConfirmParams({ confirm: 'flush-queue', confirmId: null });

  const [modalParam, setModalParam] = useUrlState('modal');
  const deleteAssetsOpen = modalParam === 'delete-assets';
  const closeDeleteAssetsModal = useCloseOverlay(['modal']);

  useCrumb(
    1,
    confirmParam === 'cancel-job'
      ? { label: 'Cancel job', href: `/jobs?job=${encodeURIComponent(jobIdParam ?? '')}&confirm=cancel-job&confirmId=${encodeURIComponent(confirmId ?? '')}` }
      : confirmParam === 'flush-queue'
        ? { label: 'Flush queue', href: '/jobs?confirm=flush-queue' }
        : null,
  );
  useCrumb(
    2,
    deleteAssetsOpen
      ? { label: 'Delete assets', href: `/jobs?job=${encodeURIComponent(jobIdParam ?? '')}&modal=delete-assets` }
      : null,
  );
```

- [ ] **Step 2: Remove the now-obsolete local state**

Delete these two lines (now replaced by the derived values above):

```ts
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  ...
  const [confirmFlush, setConfirmFlush] = useState(false);
  ...
  const [deleteAssetsOpen, setDeleteAssetsOpen] = useState(false);
```

(Leave `deleteAssetsTargets`, `deleteAssetsPassword`, `deleteAssetsError`, `deletingAssets` exactly as they are — ephemeral form/working-set state, stays local per the governing rule.)

- [ ] **Step 3: Simplify the reset-on-job-change effect**

Find:

```ts
  useEffect(() => {
    setDeleteAssetsTargets(new Set());
    setDeleteAssetsOpen(false);
    setDeleteAssetsPassword('');
  }, [detail?.id]);
```

Replace with:

```ts
  // deleteAssetsOpen is now derived from the URL, scoped to whichever job=
  // is currently open — there's no path in this UI that changes `job=`
  // directly from one id to another without first closing back to the list,
  // so it never needs a manual reset here the way the local form fields do.
  useEffect(() => {
    setDeleteAssetsTargets(new Set());
    setDeleteAssetsPassword('');
  }, [detail?.id]);
```

- [ ] **Step 4: Update every `confirmCancel` call site**

Replace all four occurrences of `setConfirmCancel(j.id)` (desktop row action icon, detail-view Cancel button, mobile card action button — three call sites) with `openConfirmCancel(j.id)`.

Replace all occurrences of `onClick={() => setConfirmCancel(null)}` (modal overlay click, "Back" button inside the confirm dialog) with `onClick={closeConfirm}`.

In `handleCancel`, find:

```ts
  const handleCancel = async () => {
    if (!confirmCancel) return;
    setActioning(true);
    try {
      await apiFetch(`/admin/jobs/${confirmCancel}/cancel`, { method: 'POST' });
      toast({ title: `Job cancelled` });
      setConfirmCancel(null);
      if (detail?.id === confirmCancel) setDetail((d) => (d ? { ...d, status: 'CANCELLED' } : d));
      setJobs((prev) =>
        prev.map((j) => (j.id === confirmCancel ? { ...j, status: 'CANCELLED' } : j)),
      );
```

Replace with:

```ts
  const handleCancel = async () => {
    if (!confirmCancelJobId) return;
    setActioning(true);
    try {
      await apiFetch(`/admin/jobs/${confirmCancelJobId}/cancel`, { method: 'POST' });
      toast({ title: `Job cancelled` });
      closeConfirm();
      if (detail?.id === confirmCancelJobId)
        setDetail((d) => (d ? { ...d, status: 'CANCELLED' } : d));
      setJobs((prev) =>
        prev.map((j) => (j.id === confirmCancelJobId ? { ...j, status: 'CANCELLED' } : j)),
      );
```

And update the confirm dialog's own JSX from `{confirmCancel && (...)}` / `<strong>{confirmCancel}</strong>` to `{confirmCancelJobId && (...)}` / `<strong>{confirmCancelJobId}</strong>` (two occurrences — desktop dialog near the end of the detail view, and the list-view dialog near the end of the file).

- [ ] **Step 5: Update flush-queue call sites**

Replace `onClick={() => setConfirmFlush(true)}` with `onClick={openConfirmFlush}`.
Replace `onClick={() => setConfirmFlush(false)}` with `onClick={closeConfirm}`.
In `flushQueue`, replace the `finally` block's `setConfirmFlush(false);` with `closeConfirm();`.

- [ ] **Step 6: Update delete-assets call sites**

Replace `setDeleteAssetsOpen(true)` (the floating "Delete" pill button) with `setModalParam('delete-assets')`.
Replace all three occurrences of `setDeleteAssetsOpen(false)` (overlay click-outside, modal Cancel button, `handleDeleteAssets`'s success path) with `closeDeleteAssetsModal()`.

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds, no reference to `confirmCancel`, `confirmFlush`, or the old `deleteAssetsOpen` `useState` remains.

Run: `pnpm --filter @aivastra/admin lint`
Expected: no new warnings.

- [ ] **Step 8: Manual verification**

1. Open a queued job's detail, click Cancel → URL gains `&confirm=cancel-job&confirmId=<id>`; press Back → dialog closes, URL loses those params, detail view still shown underneath.
2. From the list view, click Flush queue → URL becomes `/jobs?confirm=flush-queue`; press Back → returns to plain `/jobs`.
3. Open a completed job's detail (with delete permission), select an asset, click Delete → URL gains `&modal=delete-assets`; press Back → modal closes, selection chip still visible underneath (targets are local, unaffected by the URL round-trip).
4. Refresh the browser while `&confirm=cancel-job&confirmId=<id>` is in the URL → the confirm dialog reconstructs directly (no need to re-click Cancel).

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web/src/pages/JobsPage.tsx
git commit -m "feat(admin): drive Jobs page confirm/delete-assets/flush dialogs from URL params"
```

---

### Task 3: JobsPage — mobile accordion

**Files:**
- Modify: `apps/admin-web/src/pages/JobsPage.tsx`

**Interfaces:**
- Consumes: `useUrlStateMulti`, `useCloseOverlay` (already imported from Tasks 1–2).
- Produces: nothing consumed by later tasks in this plan.

- [ ] **Step 1: Replace `expandedJobId` and `expandedSubTabsMap` with URL state**

Find:

```ts
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [expandedSubTabsMap, setExpandedSubTabsMap] = useState<
    Record<string, 'input' | 'output' | 'events' | null>
  >({});
```

Replace with:

```ts
  // Only the currently-expanded row's subtab is tracked — switching which
  // row is expanded resets the subtab, trading away the old behavior's
  // per-row subtab memory (a Record keyed by every job id ever expanded)
  // for a URL that reflects exactly "what's open right now."
  const [{ expanded: expandedJobId, expandedSubtab }, setAccordionParams] = useUrlStateMulti([
    'expanded',
    'expandedSubtab',
  ]);
  const closeAccordion = useCloseOverlay(['expanded', 'expandedSubtab']);
```

- [ ] **Step 2: Update `toggleMobileJobExpand`**

Find:

```ts
  const toggleMobileJobExpand = async (j: Job) => {
    const willExpand = expandedJobId !== j.id;
    setExpandedJobId(willExpand ? j.id : null);
    if (willExpand && !jobDetailsMap[j.id]) {
```

Replace with:

```ts
  const toggleMobileJobExpand = async (j: Job) => {
    const willExpand = expandedJobId !== j.id;
    if (willExpand) {
      setAccordionParams({ expanded: j.id, expandedSubtab: null });
    } else {
      closeAccordion();
    }
    if (willExpand && !jobDetailsMap[j.id]) {
```

(The rest of the function — the `try`/`catch` fetching `jobDetailsMap` — is unchanged.)

- [ ] **Step 3: Add a `setSubtab` helper and update `activeSubTab`**

Find:

```ts
              const activeSubTab = expandedSubTabsMap[j.id] ?? null;
```

Replace with:

```ts
              const activeSubTab = expandedJobId === j.id ? expandedSubtab : null;
```

Just above the mobile card's `.map()` (near `const sorted = [...jobs].sort(...)` or immediately before the `<div className="mobile-only" ...>` block, whichever reads more naturally in context), add:

```ts
  const setAccordionSubtab = (jobId: string, tab: 'input' | 'output' | 'events') =>
    setAccordionParams({
      expanded: jobId,
      expandedSubtab: expandedJobId === jobId && expandedSubtab === tab ? null : tab,
    });
```

- [ ] **Step 4: Update the three subtab buttons**

Replace:

```ts
                          onClick={() =>
                            setExpandedSubTabsMap((prev) => ({
                              ...prev,
                              [j.id]: prev[j.id] === 'input' ? null : 'input',
                            }))
                          }
```

with:

```ts
                          onClick={() => setAccordionSubtab(j.id, 'input')}
```

and identically for the `'output'` and `'events'` buttons (same replacement pattern, substituting the tab name).

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds, no reference to `expandedSubTabsMap` or the old `setExpandedJobId` remains.

Run: `pnpm --filter @aivastra/admin lint`
Expected: no new warnings.

- [ ] **Step 6: Manual verification** (mobile viewport, e.g. browser devtools responsive mode)

1. On `/jobs`, tap a card → it expands inline, URL gains `?expanded=<id>`.
2. Tap "Input Uploads" → URL gains `&expandedSubtab=input`; tap it again → `expandedSubtab` is removed from the URL, subtab content collapses.
3. Press physical Back while a subtab is open → subtab closes first (one step), not the whole card.
4. Press Back again → the card collapses, URL loses `expanded`.
5. Tap a different card while one is already expanded → the new card expands, old one collapses, `expandedSubtab` resets (does not carry over).

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/pages/JobsPage.tsx
git commit -m "feat(admin): drive Jobs page mobile accordion from URL params"
```

---

### Task 4: UsersPage — detail view via `user=` param

**Files:**
- Modify: `apps/admin-web/src/pages/UsersPage.tsx`

**Interfaces:**
- Consumes: `useUrlState`, `useCloseOverlay`, `useCrumb` (same hooks as Task 1, new imports for this file).
- Produces: `userIdParam: string | null`, `closeDetail: () => void`, `openDetail(u: User): void` (unchanged signature), `detail: User | null` — consumed by Tasks 5–9.

This mirrors Task 1's shape exactly, adapted to `UsersPage`'s `Promise.all([user, creditActivity])` load and its `requestedUserId`/`requestedJobId` location.state pair. The job-preview reopen-after-navigation behavior that today lives inside this effect moves to Task 8, where it becomes automatic (once `jobPreview=` is its own URL param, arriving at a URL that already contains it opens the popup with no special-case code needed).

- [ ] **Step 1: Add the new imports**

At the top of `apps/admin-web/src/pages/UsersPage.tsx`, add:

```ts
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
```

- [ ] **Step 2: Remove `useLocation` and its derived variables**

Find:

```ts
import { useLocation } from 'react-router-dom';
```

Delete this import — nothing else in the file uses `useLocation` after this task (verified: `requestedUserId`/`requestedJobId` were its only consumers).

Find:

```ts
  const location = useLocation();
  const requestedUserId = (location.state as { userId?: string })?.userId;
  const requestedJobId = (location.state as { jobId?: string })?.jobId;
```

Replace with:

```ts
  const [userIdParam, setUserIdParam] = useUrlState('user');
  const closeDetail = useCloseOverlay(['user']);
```

- [ ] **Step 3: Update `openDetail`**

Find:

```ts
  const openDetail = async (u: User) => {
    setDetail(u);
    setSelectedTier(u.tier);
    setSelectedMaxDevices(String(u.maxActiveDevices ?? 1));
    setShowAllCreditActivity(false);
    setDetailLoading(true);
```

Replace with:

```ts
  const openDetail = async (u: User) => {
    setDetail(u);
    setSelectedTier(u.tier);
    setSelectedMaxDevices(String(u.maxActiveDevices ?? 1));
    setShowAllCreditActivity(false);
    setUserIdParam(u.id);
    setDetailLoading(true);
```

- [ ] **Step 4: Replace the `requestedUserId` reconstruction effect**

Find:

```ts
  useEffect(() => {
    if (!requestedUserId) return;
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([
      apiFetch<User>(`/admin/users/${requestedUserId}`),
      loadCreditActivity(requestedUserId),
    ])
      .then(([full]) => {
        if (cancelled) return;
        setDetail(full);
        setSelectedTier(full.tier);
        setSelectedMaxDevices(String(full.maxActiveDevices ?? 1));
        setShowAllCreditActivity(false);
        // Landed here via the job popup's "Go to job" link + the job page's
        // "Back to user" — reopen the same popup instead of just the bare
        // user detail, so the trip back feels like a round-trip, not a reset.
        if (requestedJobId) void openJobPreview(requestedJobId);
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            kind: 'error',
            title: 'Failed to load user detail',
            body: apiErrorMessage(e, 'Please try again.'),
          });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestedUserId, requestedJobId, loadCreditActivity, openJobPreview, toast]);
```

Replace with:

```ts
  // Reconstructs the detail view from the URL alone — covers a hard refresh,
  // a deep link, and the physical Back button restoring a previous `user=`
  // value. Skipped when `openDetail` already seeded `detail` for this same
  // id. The job-preview popup no longer needs special-casing here: once
  // Task 8 lands, `jobPreview=<id>` is its own URL param, read by its own
  // effect — landing on a URL that already contains it just opens it.
  useEffect(() => {
    if (!userIdParam || detail?.id === userIdParam) return;
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([
      apiFetch<User>(`/admin/users/${userIdParam}`),
      loadCreditActivity(userIdParam),
    ])
      .then(([full]) => {
        if (cancelled) return;
        setDetail(full);
        setSelectedTier(full.tier);
        setSelectedMaxDevices(String(full.maxActiveDevices ?? 1));
        setShowAllCreditActivity(false);
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            kind: 'error',
            title: 'Failed to load user detail',
            body: apiErrorMessage(e, 'Please try again.'),
          });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userIdParam, detail?.id, loadCreditActivity, toast]);

  useCrumb(
    0,
    detail
      ? { label: userLabel(detail), href: `/users?user=${encodeURIComponent(detail.id)}` }
      : null,
  );
```

- [ ] **Step 5: Wire "Back to users" through `closeDetail`**

Find:

```tsx
            <button className="btn ghost" onClick={() => setDetail(null)}>
              <Icon.Back /> Back to users
            </button>
```

Replace with:

```tsx
            <button className="btn ghost" onClick={closeDetail}>
              <Icon.Back /> Back to users
            </button>
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds, no reference to `useLocation`, `requestedUserId`, or `requestedJobId` remains in this file.

Run: `pnpm --filter @aivastra/admin lint`
Expected: no new warnings.

- [ ] **Step 7: Manual verification**

1. Open `/users`, click a row → URL becomes `/users?user=<id>`, detail view shows.
2. Press Back → returns to `/users`, list shows.
3. Hard-refresh on `/users?user=<id>` → detail view reconstructs.
4. Edit the URL to a non-existent user id → error toast, no crash.
5. Click "Back to users" → same as physical Back.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/pages/UsersPage.tsx
git commit -m "feat(admin): drive Users page detail view from a user= URL param"
```

---

### Task 5: UsersPage — suspend, delete-user, and bulk-delete confirm dialogs

**Files:**
- Modify: `apps/admin-web/src/pages/UsersPage.tsx`

**Interfaces:**
- Consumes: `detail`, `closeDetail` (Task 4); `useUrlStateMulti`, `useCloseOverlay`, `useCrumb`.
- Produces: `confirmParam`, `confirmId` (also consumed by Task 6/7 for the shared breadcrumb — no, Tasks 6/7 use a separate `modal` param, no overlap) — nothing else consumed downstream.

- [ ] **Step 1: Add `useUrlStateMulti` to the import line**

Update the Task 4 import line to: `import { useUrlState, useUrlStateMulti } from '../hooks/use-url-state';`

- [ ] **Step 2: Add the confirm-dialog URL state**

After the `closeDetail` line from Task 4, add:

```ts
  const [{ confirm: confirmParam, confirmId }, setConfirmParams] = useUrlStateMulti([
    'confirm',
    'confirmId',
  ]);
  const confirmSuspend = confirmParam === 'suspend' ? confirmId : null;
  const confirmDelete = confirmParam === 'delete-user' ? confirmId : null;
  const showBulkDeleteConfirm = confirmParam === 'bulk-delete-users';
  const closeConfirm = useCloseOverlay(['confirm', 'confirmId']);
  const openConfirmSuspend = () => {
    if (detail) setConfirmParams({ confirm: 'suspend', confirmId: detail.id });
  };
  const openConfirmDelete = () => {
    if (detail) setConfirmParams({ confirm: 'delete-user', confirmId: detail.id });
  };
  const openBulkDeleteConfirm = () =>
    setConfirmParams({ confirm: 'bulk-delete-users', confirmId: null });

  useCrumb(
    1,
    confirmParam === 'suspend'
      ? { label: 'Suspend', href: `/users?user=${encodeURIComponent(detail?.id ?? '')}&confirm=suspend&confirmId=${encodeURIComponent(confirmId ?? '')}` }
      : confirmParam === 'delete-user'
        ? { label: 'Delete', href: `/users?user=${encodeURIComponent(detail?.id ?? '')}&confirm=delete-user&confirmId=${encodeURIComponent(confirmId ?? '')}` }
        : confirmParam === 'bulk-delete-users'
          ? { label: 'Delete selected', href: '/users?confirm=bulk-delete-users' }
          : null,
  );
```

- [ ] **Step 3: Remove the now-obsolete local state**

Delete:

```ts
  const [confirmSuspend, setConfirmSuspend] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  ...
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
```

(Leave `selectedUserIds`, `deletingUser`, `bulkDeleting` exactly as they are.)

- [ ] **Step 4: Update call sites**

Replace `onClick={() => setConfirmSuspend(u.id)}` with `onClick={openConfirmSuspend}`.
Replace `onClick={() => setConfirmDelete(u.id)}` with `onClick={openConfirmDelete}`.
Replace `onClick={() => setShowBulkDeleteConfirm(true)}` with `onClick={openBulkDeleteConfirm}`.

Replace all three "cancel"/overlay-click sites (`setConfirmSuspend(null)`, `setConfirmDelete(null)` ×2 including inside `disabled={deletingUser}` button, `setShowBulkDeleteConfirm(false)` ×2) with `closeConfirm`.

In `handleSuspendConfirm`, replace the trailing `setConfirmSuspend(null);` with `closeConfirm();`.
In `handleDeleteConfirm`'s `finally` block, replace `setConfirmDelete(null);` with `closeConfirm();`.
In `handleBulkDeleteConfirm`'s `finally` block, replace `setShowBulkDeleteConfirm(false);` with `closeConfirm();`.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds.

Run: `pnpm --filter @aivastra/admin lint`
Expected: no new warnings.

- [ ] **Step 6: Manual verification**

1. Open a user, click Suspend → URL gains `&confirm=suspend&confirmId=<id>`; press Back → dialog closes, still on the detail view.
2. Open a non-admin user (as SUPER_ADMIN), click Delete → URL gains `&confirm=delete-user&confirmId=<id>`; press Back → dialog closes.
3. From the list, select two users via checkboxes, click "Delete selected" → URL becomes `/users?confirm=bulk-delete-users`; press Back → dialog closes, selection chip still shows underneath.
4. Refresh on a URL with `?confirm=bulk-delete-users` but no prior selection made in this session → dialog shows "0 selected" gracefully (not a crash) — matches the existing behavior of an empty `selectedUserIds` array, since that state is intentionally not URL-tracked.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/pages/UsersPage.tsx
git commit -m "feat(admin): drive Users page suspend/delete/bulk-delete confirms from URL params"
```

---

### Task 6: UsersPage — adjust-credits, monthly-plan, and plan/device-limit editors

**Files:**
- Modify: `apps/admin-web/src/pages/UsersPage.tsx`

**Interfaces:**
- Consumes: `detail` (Task 4); `useUrlState`, `useCloseOverlay`, `useCrumb`.
- Produces: `modalParam: string | null`, `closeModal: () => void` — consumed by Task 7 (which adds four more values to the same `modal` enum and replaces this task's partial breadcrumb with the complete one).

`selectedTier`/`selectedMaxDevices` already get freshly set on every full detail load (inside `openDetail` and the Task 4 reconstruction effect) — so unlike the merchant-edit form in Task 7, the plan/device-limit editor needs **no extra deep-link reconstruction effect**: by the time a user reaches this modal, those two values are already current.

- [ ] **Step 1: Add the modal URL state**

After Task 5's `useCrumb(1, ...)` block, add:

```ts
  const [modalParam, setModalParam] = useUrlState('modal');
  const closeModal = useCloseOverlay(['modal']);
  const grantUserId = modalParam === 'adjust-credits' ? (detail?.id ?? null) : null;
  const editingAccountField: 'plan' | 'devices' | null =
    modalParam === 'plan' || modalParam === 'devices' ? modalParam : null;
  const showMonthlyPlanEditor = modalParam === 'monthly-plan';
```

- [ ] **Step 2: Remove the now-obsolete local state**

Delete:

```ts
  const [grantUserId, setGrantUserId] = useState<string | null>(null);
  ...
  const [editingAccountField, setEditingAccountField] = useState<'plan' | 'devices' | null>(null);
```

Leave `grantMode`, `grantAmount`, `grantReason`, `granting` and the `unlimitedPlanForm` state declaration itself unchanged — only the "is it open" flags move to the URL, not the form field values.

- [ ] **Step 3: Update `openAdjustCredits`/`closeAdjustCredits`**

Find:

```ts
  const openAdjustCredits = () => {
    if (!detail) return;
    setGrantUserId(detail.id);
    setGrantMode('grant');
    setGrantAmount('');
    setGrantReason('');
  };

  const closeAdjustCredits = () => {
    setGrantUserId(null);
    setGrantMode('grant');
    setGrantAmount('');
    setGrantReason('');
  };
```

Replace with:

```ts
  const openAdjustCredits = () => {
    if (!detail) return;
    setGrantMode('grant');
    setGrantAmount('');
    setGrantReason('');
    setModalParam('adjust-credits');
  };

  const closeAdjustCredits = closeModal;
```

- [ ] **Step 4: Update `openPlanEditor`/`openDeviceLimitEditor`/`closeAccountFieldEditor`**

Find:

```ts
  const openPlanEditor = () => {
    if (!detail) return;
    setSelectedTier(detail.tier);
    setEditingAccountField('plan');
  };

  const openDeviceLimitEditor = () => {
    if (!detail) return;
    setSelectedMaxDevices(String(detail.maxActiveDevices ?? 1));
    setEditingAccountField('devices');
  };

  const closeAccountFieldEditor = () => {
    if (detail) {
      setSelectedTier(detail.tier);
      setSelectedMaxDevices(String(detail.maxActiveDevices ?? 1));
    }
    setEditingAccountField(null);
  };
```

Replace with:

```ts
  const openPlanEditor = () => {
    if (!detail) return;
    setSelectedTier(detail.tier);
    setModalParam('plan');
  };

  const openDeviceLimitEditor = () => {
    if (!detail) return;
    setSelectedMaxDevices(String(detail.maxActiveDevices ?? 1));
    setModalParam('devices');
  };

  const closeAccountFieldEditor = () => {
    if (detail) {
      setSelectedTier(detail.tier);
      setSelectedMaxDevices(String(detail.maxActiveDevices ?? 1));
    }
    closeModal();
  };
```

- [ ] **Step 5: Update `openUnlimitedPlanEditor`/`closeUnlimitedPlanEditor`, and add the deep-link reconstruction effect**

Find:

```ts
  const openUnlimitedPlanEditor = () => {
    if (!detail) return;
    const today = new Date().toISOString().slice(0, 10);
    const plan = detail.unlimitedPlan;
    const hasActive =
      plan && plan.status !== 'none' && plan.status !== 'revoked' && plan.status !== 'expired';
    setUnlimitedPlanForm({
      startAt: hasActive && plan?.startAt ? plan.startAt.slice(0, 10) : today,
      endAt:
        hasActive && plan?.endAt
          ? plan.endAt.slice(0, 10)
          : new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      note: (hasActive && plan?.note) || '',
      priceRupees: hasActive && plan?.pricePaise != null ? String(plan.pricePaise / 100) : '',
      queueStream: (hasActive && plan?.queueStream) || 'normal',
    });
  };

  const closeUnlimitedPlanEditor = () => setUnlimitedPlanForm(null);
```

Replace with:

```ts
  const openUnlimitedPlanEditor = () => {
    if (detail) setModalParam('monthly-plan');
  };

  const closeUnlimitedPlanEditor = () => {
    setUnlimitedPlanForm(null);
    closeModal();
  };

  // Unlike selectedTier/selectedMaxDevices, unlimitedPlanForm has no other
  // sync point — a hard refresh or bookmark landing directly on
  // ?modal=monthly-plan needs this effect to (re)build the form from
  // `detail.unlimitedPlan`. Guarded on `unlimitedPlanForm` being null so it
  // only runs once per "open" session, not on every unrelated `detail` update
  // while the editor is already open (which would clobber in-progress edits).
  useEffect(() => {
    if (!showMonthlyPlanEditor || unlimitedPlanForm || !detail) return;
    const today = new Date().toISOString().slice(0, 10);
    const plan = detail.unlimitedPlan;
    const hasActive =
      plan && plan.status !== 'none' && plan.status !== 'revoked' && plan.status !== 'expired';
    setUnlimitedPlanForm({
      startAt: hasActive && plan?.startAt ? plan.startAt.slice(0, 10) : today,
      endAt:
        hasActive && plan?.endAt
          ? plan.endAt.slice(0, 10)
          : new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      note: (hasActive && plan?.note) || '',
      priceRupees: hasActive && plan?.pricePaise != null ? String(plan.pricePaise / 100) : '',
      queueStream: (hasActive && plan?.queueStream) || 'normal',
    });
  }, [showMonthlyPlanEditor, unlimitedPlanForm, detail]);
```

- [ ] **Step 6: Update the render gate for the monthly-plan `EditDrawer`**

Find `{unlimitedPlanForm && (` (the monthly-plan `EditDrawer`'s opening condition) and replace with `{showMonthlyPlanEditor && unlimitedPlanForm && (`.

- [ ] **Step 7: Add a partial breadcrumb for this task's four modal kinds**

Immediately after Step 5's `useEffect`, add:

```ts
  useCrumb(
    2,
    modalParam === 'adjust-credits'
      ? { label: 'Adjust credits', href: `/users?user=${encodeURIComponent(detail?.id ?? '')}&modal=adjust-credits` }
      : modalParam === 'monthly-plan'
        ? { label: 'Monthly plan', href: `/users?user=${encodeURIComponent(detail?.id ?? '')}&modal=monthly-plan` }
        : modalParam === 'plan'
          ? { label: 'Change plan', href: `/users?user=${encodeURIComponent(detail?.id ?? '')}&modal=plan` }
          : modalParam === 'devices'
            ? { label: 'Change device limit', href: `/users?user=${encodeURIComponent(detail?.id ?? '')}&modal=devices` }
            : null,
  );
```

(Task 7 replaces this whole block with the complete 8-value version — this is an intentionally temporary, self-consistent state for this task's own review.)

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds, no reference to the old `setGrantUserId`/`setEditingAccountField` remains.

Run: `pnpm --filter @aivastra/admin lint`
Expected: no new warnings.

- [ ] **Step 9: Manual verification**

1. Open a user, click "Adjust credits" → URL gains `&modal=adjust-credits`; press Back → drawer closes.
2. Click "Change plan" → URL gains `&modal=plan`; the dropdown already shows the user's current tier (no flash of a blank value); press Back → closes.
3. Click "Manage monthly plan" (or "Grant monthly plan") → URL gains `&modal=monthly-plan`; press Back → closes.
4. Refresh the browser directly on a URL with `&modal=monthly-plan` for a user who already has an active monthly plan → the form reconstructs pre-filled with that plan's actual start/end/price, not blank defaults.

- [ ] **Step 10: Commit**

```bash
git add apps/admin-web/src/pages/UsersPage.tsx
git commit -m "feat(admin): drive Users page credit/plan/device-limit editors from a modal= URL param"
```

---

### Task 7: UsersPage — grant/edit-merchant, create-user, and reset-password modals

**Files:**
- Modify: `apps/admin-web/src/pages/UsersPage.tsx`

**Interfaces:**
- Consumes: `modalParam`, `closeModal` (Task 6).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the four derived flags and open functions**

After Task 6's Step 7 breadcrumb block, add:

```ts
  const showGrantMerchant = modalParam === 'grant-merchant';
  const showEditMerchant = modalParam === 'edit-merchant';
  const showCreateUser = modalParam === 'create-user';
  const resettingPassword = modalParam === 'reset-password';
```

- [ ] **Step 2: Remove the now-obsolete local state**

Delete:

```ts
  const [showGrantMerchant, setShowGrantMerchant] = useState(false);
  ...
  const [showEditMerchant, setShowEditMerchant] = useState(false);
  ...
  const [showCreateUser, setShowCreateUser] = useState(false);
  ...
  const [resettingPassword, setResettingPassword] = useState(false);
```

Leave `grantMerchantForm`, `merchantEditForm`, `createUserForm`, `createUserError`, `newPasswordInput`, and all the `*ing`/`*Saving`/`*Uploading` flags unchanged.

- [ ] **Step 3: Update `openGrantMerchant`**

Find:

```ts
  function openGrantMerchant() {
    setGrantMerchantForm(EMPTY_GRANT_MERCHANT_FORM);
    setShowGrantMerchant(true);
  }
```

Replace with:

```ts
  function openGrantMerchant() {
    setGrantMerchantForm(EMPTY_GRANT_MERCHANT_FORM);
    setModalParam('grant-merchant');
  }
```

- [ ] **Step 4: Update `openEditMerchant`, and add its deep-link reconstruction effect**

Find:

```ts
  function openEditMerchant() {
    if (!detail?.merchant) return;
    const m = detail.merchant;
    setMerchantEditForm({
      companyName: m.companyName,
      contactName: m.contactName,
      phone: m.phone,
      businessAddress: m.businessAddress,
      jobRateLimitPerMin: m.jobRateLimitPerMin != null ? String(m.jobRateLimitPerMin) : '',
    });
    setShowEditMerchant(true);
  }
```

Replace with:

```ts
  function openEditMerchant() {
    if (!detail?.merchant) return;
    const m = detail.merchant;
    setMerchantEditForm({
      companyName: m.companyName,
      contactName: m.contactName,
      phone: m.phone,
      businessAddress: m.businessAddress,
      jobRateLimitPerMin: m.jobRateLimitPerMin != null ? String(m.jobRateLimitPerMin) : '',
    });
    setModalParam('edit-merchant');
  }

  // Unlike the plan/device-limit editor (Task 6), merchantEditForm has no
  // other sync point — a hard refresh or bookmark landing directly on
  // ?modal=edit-merchant needs this effect to rebuild it from `detail`.
  // Guarded on every field being blank so it only fires for a genuinely
  // fresh (deep-linked) open, not on every unrelated `detail` update while
  // the drawer is already open with in-progress edits.
  useEffect(() => {
    if (modalParam !== 'edit-merchant' || !detail?.merchant) return;
    const m = detail.merchant;
    setMerchantEditForm((prev) =>
      prev.companyName ||
      prev.contactName ||
      prev.phone ||
      prev.businessAddress ||
      prev.jobRateLimitPerMin
        ? prev
        : {
            companyName: m.companyName,
            contactName: m.contactName,
            phone: m.phone,
            businessAddress: m.businessAddress,
            jobRateLimitPerMin: m.jobRateLimitPerMin != null ? String(m.jobRateLimitPerMin) : '',
          },
    );
  }, [modalParam, detail?.merchant]);
```

- [ ] **Step 5: Update `openCreateUser` and the reset-password open site**

Find:

```ts
  function openCreateUser() {
    setCreateUserForm(EMPTY_CREATE_USER_FORM);
    setCreateUserError('');
    setShowCreateUser(true);
  }
```

Replace with:

```ts
  function openCreateUser() {
    setCreateUserForm(EMPTY_CREATE_USER_FORM);
    setCreateUserError('');
    setModalParam('create-user');
  }
```

Find:

```tsx
            <button
              className="btn ghost"
              onClick={() => {
                setNewPasswordInput('');
                setResettingPassword(true);
              }}
            >
              <Icon.Refresh /> Reset Password
            </button>
```

Replace with:

```tsx
            <button
              className="btn ghost"
              onClick={() => {
                setNewPasswordInput('');
                setModalParam('reset-password');
              }}
            >
              <Icon.Refresh /> Reset Password
            </button>
```

- [ ] **Step 6: Update close call sites**

Replace `onClose={() => setShowGrantMerchant(false)}` with `onClose={closeModal}`.
Replace `onClose={() => setShowEditMerchant(false)}` with `onClose={closeModal}`.
Replace `onClose={() => setShowCreateUser(false)}` with `onClose={closeModal}`.
Replace `onClose={() => setResettingPassword(false)}` with `onClose={closeModal}`.

In `handleGrantMerchant`'s success path, replace `setShowGrantMerchant(false);` with `closeModal();`.
In `handleMerchantEditSave`'s success path, replace `setShowEditMerchant(false);` with `closeModal();`.
In `handleCreateUser`'s success path, replace `setShowCreateUser(false);` with `closeModal();`.
In the reset-password `EditDrawer`'s `onSave`, replace:

```ts
            onSave={async () => {
              await handleResetPassword(newPasswordInput);
              setResettingPassword(false);
            }}
```

with:

```ts
            onSave={async () => {
              await handleResetPassword(newPasswordInput);
              closeModal();
            }}
```

- [ ] **Step 7: Replace Task 6's partial breadcrumb with the complete version**

Find the `useCrumb(2, ...)` block added in Task 6 and replace it entirely with:

```ts
  const MODAL_LABELS: Record<string, string> = {
    'adjust-credits': 'Adjust credits',
    'monthly-plan': 'Monthly plan',
    plan: 'Change plan',
    devices: 'Change device limit',
    'grant-merchant': 'Grant merchant access',
    'edit-merchant': 'Edit merchant',
    'create-user': 'Create user',
    'reset-password': 'Reset password',
  };
  useCrumb(
    2,
    modalParam && MODAL_LABELS[modalParam]
      ? {
          label: MODAL_LABELS[modalParam],
          href: `/users?${detail ? `user=${encodeURIComponent(detail.id)}&` : ''}modal=${modalParam}`,
        }
      : null,
  );
```

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds, no reference to the old boolean `useState`s for these four modals remains.

Run: `pnpm --filter @aivastra/admin lint`
Expected: no new warnings.

- [ ] **Step 9: Manual verification**

1. From the users list, click "Create User" → URL becomes `/users?modal=create-user`; press Back → closes, list still shown.
2. Open a user without merchant access, click "Grant access" → URL gains `&modal=grant-merchant`; press Back → closes.
3. Open a user with merchant access, click "Edit" (merchant card) → URL gains `&modal=edit-merchant`, fields show the merchant's actual current values; press Back → closes.
4. Refresh directly on a URL with `&modal=edit-merchant` for a user with an existing merchant → fields reconstruct with real values, not blank.
5. Click "Reset Password" → URL gains `&modal=reset-password`; type a password, then check the URL bar — it must **not** contain the typed password anywhere.

- [ ] **Step 10: Commit**

```bash
git add apps/admin-web/src/pages/UsersPage.tsx
git commit -m "feat(admin): drive Users page merchant/create-user/reset-password modals from URL params"
```

---

### Task 8: UsersPage — job-preview popup

**Files:**
- Modify: `apps/admin-web/src/pages/UsersPage.tsx`

**Interfaces:**
- Consumes: `useUrlState`, `useCloseOverlay`, `useCrumb`.
- Produces: `jobPreviewId: string | null`, `openJobPreview(jobId: string): void` (now synchronous, no longer returns a Promise) — consumed by Task 9 for the "Go to job" cross-link.

- [ ] **Step 1: Replace `jobPreviewId`/`jobPreview`/`jobPreviewLoading` derivation**

Find:

```ts
  const [jobPreviewId, setJobPreviewId] = useState<string | null>(null);
  const [jobPreview, setJobPreview] = useState<JobPreview | null>(null);
  const [jobPreviewLoading, setJobPreviewLoading] = useState(false);
```

Replace with:

```ts
  const [jobPreviewId, setJobPreviewId] = useUrlState('jobPreview');
  const closeJobPreview = useCloseOverlay(['jobPreview']);
  const [jobPreview, setJobPreview] = useState<JobPreview | null>(null);
  const [jobPreviewLoading, setJobPreviewLoading] = useState(false);

  useCrumb(
    3,
    jobPreviewId
      ? {
          label: `Job ${jobPreviewId.slice(0, 8)}…`,
          href: `/users?user=${encodeURIComponent(detail?.id ?? '')}&jobPreview=${encodeURIComponent(jobPreviewId)}`,
        }
      : null,
  );
```

- [ ] **Step 2: Replace `openJobPreview`**

Find:

```ts
  const openJobPreview = useCallback(
    async (jobId: string) => {
      setJobPreviewId(jobId);
      setJobPreview(null);
      setJobPreviewLoading(true);
      try {
        const full = await apiFetch<JobPreview>(`/admin/jobs/${jobId}`);
        setJobPreview(full);
      } catch (e) {
        toast({
          kind: 'error',
          title: 'Failed to load job details',
          body: apiErrorMessage(e, 'Please try again.'),
        });
        setJobPreviewId(null);
      } finally {
        setJobPreviewLoading(false);
      }
    },
    [toast],
  );
```

Replace with:

```ts
  const openJobPreview = useCallback((jobId: string) => setJobPreviewId(jobId), [setJobPreviewId]);

  useEffect(() => {
    if (!jobPreviewId) {
      setJobPreview(null);
      return;
    }
    let cancelled = false;
    setJobPreview(null);
    setJobPreviewLoading(true);
    apiFetch<JobPreview>(`/admin/jobs/${jobPreviewId}`)
      .then((full) => {
        if (!cancelled) setJobPreview(full);
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            kind: 'error',
            title: 'Failed to load job details',
            body: apiErrorMessage(e, 'Please try again.'),
          });
      })
      .finally(() => {
        if (!cancelled) setJobPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobPreviewId, toast]);
```

- [ ] **Step 3: Update the two call sites that opened it**

Find `onClick={() => void openJobPreview(l.jobId as string)}` and replace with `onClick={() => openJobPreview(l.jobId as string)}` (no longer async).

- [ ] **Step 4: Update the two close call sites**

Find both occurrences of:

```ts
                setJobPreviewId(null);
                setJobPreview(null);
```

(the modal-overlay click and the "Close" button) and replace each with:

```ts
                closeJobPreview();
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds.

Run: `pnpm --filter @aivastra/admin lint`
Expected: no new warnings.

- [ ] **Step 6: Manual verification**

1. Open a user with credit-ledger job references, click one → URL gains `&jobPreview=<id>`, popup shows.
2. Press Back → popup closes, URL loses `jobPreview`, still on the user detail.
3. Refresh directly on a URL with `&jobPreview=<id>` → popup reconstructs with the job's data.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/pages/UsersPage.tsx
git commit -m "feat(admin): drive Users page job-preview popup from a jobPreview= URL param"
```

---

### Task 9: Cross-page linking — Jobs ↔ Users via real URLs

**Files:**
- Modify: `apps/admin-web/src/pages/JobsPage.tsx`
- Modify: `apps/admin-web/src/pages/UsersPage.tsx`

**Interfaces:**
- Consumes: `jobIdParam`/`closeDetail` (Task 1) and `requestedFromUserId` (temporarily still `location.state`-based, per Task 1's Step 2 comment) on the Jobs side; `jobPreviewId`/`openJobPreview` (Task 8) and `detail` (Task 4) on the Users side.
- Produces: nothing consumed further — this is the final task.

The one deep link this task deliberately does **not** touch is Users' "Jobs generated" stat card (`onNav('jobs', { page: 'jobs', search: ... })`) — it seeds Jobs' local `query` state via `location.state`, exactly as it does today. Search is a filter, not navigation, so per the governing rule it stays exactly as-is; this is not a regression, since it never survived a refresh before this rollout either.

- [ ] **Step 1: Convert Jobs' `requestedFromUserId` to a URL param**

In `apps/admin-web/src/pages/JobsPage.tsx`, find (from Task 1, Step 2):

```ts
  // Converted to a real URL param in Task 9 of the Jobs/Users rollout plan —
  // left on location.state for now so this task's diff stays scoped to the
  // detail view itself.
  const requestedFromUserId = (location.state as { fromUserId?: string })?.fromUserId;
```

Replace with:

```ts
  const [fromUserId] = useUrlState('fromUser');
```

Rename every remaining reference to `requestedFromUserId` in this file to `fromUserId` (the "Back to user" condition and button from Task 1, Step 7).

Check whether `location` (from `useLocation()`) is still used anywhere else in this file (it is — `filter`/`dateFilter`/`query` still read their initial values from `location.state` on mount, which stays untouched per this task's own scope). Leave `useLocation` and `const location = useLocation();` in place.

- [ ] **Step 2: Add `useNavigate` to Jobs and rewrite the "Back to user" button**

Find the existing router import line:

```ts
import { useLocation } from 'react-router-dom';
```

Replace with:

```ts
import { useLocation, useNavigate } from 'react-router-dom';
```

Add `const navigate = useNavigate();` next to `const location = useLocation();`.

Find (from Task 1, Step 7, after the `fromUserId` rename):

```tsx
            {fromUserId && jobIdParam === j.id ? (
              <button
                className="btn ghost"
                onClick={() =>
                  onNav('users', {
                    page: 'users',
                    userId: fromUserId,
                    jobId: jobIdParam,
                  })
                }
              >
                <Icon.Back /> Back to user
              </button>
```

Replace with:

```tsx
            {fromUserId && jobIdParam === j.id ? (
              <button
                className="btn ghost"
                onClick={() =>
                  navigate(
                    `/users?user=${encodeURIComponent(fromUserId)}&jobPreview=${encodeURIComponent(j.id)}`,
                  )
                }
              >
                <Icon.Back /> Back to user
              </button>
```

- [ ] **Step 3: Add `useNavigate` to Users and rewrite "Go to job"**

In `apps/admin-web/src/pages/UsersPage.tsx`, add near the top:

```ts
import { useNavigate } from 'react-router-dom';
```

Add `const navigate = useNavigate();` near the top of `UsersPage` (alongside `const { role: myRole } = useAuth();`).

Find:

```tsx
                {detail && (
                  <button
                    className="btn ghost"
                    style={{ marginRight: 'auto' }}
                    onClick={() =>
                      onNav('jobs', {
                        page: 'jobs',
                        search: jobPreviewId,
                        jobId: jobPreviewId,
                        fromUserId: detail.id,
                      })
                    }
                  >
                    Go to job <Icon.ExternalLink />
                  </button>
                )}
```

Replace with:

```tsx
                {detail && jobPreviewId && (
                  <button
                    className="btn ghost"
                    style={{ marginRight: 'auto' }}
                    onClick={() =>
                      navigate(
                        `/jobs?job=${encodeURIComponent(jobPreviewId)}&fromUser=${encodeURIComponent(detail.id)}`,
                      )
                    }
                  >
                    Go to job <Icon.ExternalLink />
                  </button>
                )}
```

(This drops the old `search: jobPreviewId` seed entirely — it existed only to make the job findable in Jobs' filtered list behind the detail view; now that Jobs opens the detail directly from `job=<id>` regardless of what's in the list, that workaround is unnecessary.)

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds in both files.

Run: `pnpm --filter @aivastra/admin lint`
Expected: no new warnings.

- [ ] **Step 5: Manual verification**

1. Open a user, open a job-preview popup, click "Go to job" → lands on `/jobs?job=<id>&fromUser=<userId>`, job detail shows directly (no flash of the jobs list first).
2. On that job detail, click "Back to user" → lands on `/users?user=<userId>&jobPreview=<jobId>`, user detail shows with the job-preview popup already open.
3. Refresh the browser at any point in that round trip → the current page reconstructs fully from its URL (both hops survive a refresh, unlike the old `location.state`-based version).
4. From a user's detail, click "Jobs generated" stat card → still lands on `/jobs` with the search box pre-filled with that user's email (unchanged, `location.state`-based as before); confirm a refresh at that point clears the search box back to empty — this is the one intentionally-unconverted link, matching today's behavior exactly.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/pages/JobsPage.tsx apps/admin-web/src/pages/UsersPage.tsx
git commit -m "feat(admin): replace Jobs<->Users location.state deep links with real URL params"
```

---

### Task 10: Whole-slice verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full build and lint**

Run: `pnpm --filter @aivastra/admin build`
Expected: clean, no TS errors.

Run: `pnpm --filter @aivastra/admin lint`
Expected: only pre-existing warnings (diff each one against `git show <merge-base>:apps/admin-web/src/pages/JobsPage.tsx` / `UsersPage.tsx` to confirm it predates this slice, same method used at the end of Sub-project A).

- [ ] **Step 2: Human QA pass (no browser automation available in this environment)**

Walk the full checklist from every task above in one sitting, plus:
1. Breadcrumb trail: open a job detail, then its cancel-confirm — trail reads `Aivastra / Jobs / Job <id> / Cancel job`; click the `Jobs` crumb — lands back on the plain list, both deeper URL params gone.
2. Same for Users: open a user, then Edit merchant — trail reads `Aivastra / Users / <user name> / Edit merchant`; click the `Users` crumb — lands back on the plain list.
3. Confirm no password ever appears in the URL bar at any point across both pages (Reset Password and Delete-assets flows).
4. Confirm list filters/sort/page on both pages are unaffected by this slice — they still work exactly as before and are not reflected in the URL.

- [ ] **Step 3: Update the progress ledger**

Append a final summary line to `.superpowers/sdd/progress.md` noting this slice's completion, commit range, and the one deliberately-unconverted link (Users' "Jobs generated" search seed).
