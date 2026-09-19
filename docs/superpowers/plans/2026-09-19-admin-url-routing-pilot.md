# Admin URL-Driven Navigation — Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every tab/sub-view/modal/confirm-dialog/accordion-expand inside `apps/admin-web`'s `GarmentTypesTab.tsx` a real URL change and a real browser-Back stop, proving a reusable mechanism before rolling it out to the other 14 affected files.

**Architecture:** A shared `useUrlState`/`useUrlStateMulti` hook pair replaces `useState` for anything that should be a back-button stop, always pushing (never `{ replace: true }`) so the browser's own history stack does the work of remembering prior combinations. Closing any URL-tracked overlay calls real browser back (`navigate(-1)`) via a `useCloseOverlay` helper, with a replace-to-parent fallback for the case where the tab has no prior in-app history yet. A small breadcrumb registry (`BreadcrumbContext`) lets each mounted level publish its own `{ label, href }`, aggregated into the existing `.crumbs` UI in `Topbar.tsx`.

**Tech Stack:** React 18, `react-router-dom` ^6.28.0 (`useSearchParams`, `useNavigate`), TypeScript ~5.6.3, Vite. No test runner exists for `apps/admin-web` (no `.test.`/`.spec.` files, no `test` script) — verification here is `pnpm --filter @aivastra/admin build` (full typecheck) plus manual browser steps, consistent with the rest of the app.

## Global Constraints

- Every history-changing action must **push**, never `{ replace: true }` — the one exception is `useCloseOverlay`'s deep-link fallback, which intentionally replaces.
- `useSearchParams`'s `setSearchParams` is stable across renders (already relied on this way in `AssetsContext.tsx:74-77`) — safe to put in a `useCallback` dependency array.
- Design source: `docs/superpowers/specs/2026-09-19-admin-url-routing-design.md`. Concrete param names for this pilot: `tab` (existing), `view`+`gtId`, `modal`+`editId`, `confirm`+`confirmId`, `expanded`.
- Out of scope for this pilot (do not touch): `genderFilter` (stays context/local state, not URL-tracked — it wasn't named in the approved spec's pilot table), the deeper `editingTemplate`/`editingPromptId` modals inside `GarmentTemplateMappingPanel`/`MappedTemplateWorkflowModal` further down `GarmentTypesTab.tsx` (lines 1231+ — a later, separate rollout item, not part of this pilot), and all 14 other files named in the design doc (sub-project B).
- Breadcrumb depth numbers (the integer passed to `useCrumb`) are a single flat namespace shared by the whole app via one `BreadcrumbContext`. This pilot only ever has one page's tab mounted at a time (`AssetsPage.tsx:178-184` conditionally renders exactly one tab component), so depths 0-3 used here can't collide with anything else today. This is a known simplification — sub-project B may need a less flat scheme once multiple independently-depth-numbered pages exist; not solved here (YAGNI).

---

### Task 1: Foundational hooks — `useUrlState`, `useUrlStateMulti`, `useCloseOverlay`

**Files:**
- Create: `apps/admin-web/src/hooks/use-in-app-navigation.ts`
- Create: `apps/admin-web/src/hooks/use-url-state.ts`
- Create: `apps/admin-web/src/hooks/use-close-overlay.ts`

**Interfaces:**
- Produces: `markInAppNavigation(): void`, `hasInAppNavigation(): boolean` (from `use-in-app-navigation.ts`)
- Produces: `useUrlState(key: string): [string | null, (value: string | null) => void]` and `useUrlStateMulti(keys: readonly string[]): [Record<string, string | null>, (next: Record<string, string | null>) => void]` (from `use-url-state.ts`)
- Produces: `useCloseOverlay(toParentUrl: string): () => void` (from `use-close-overlay.ts`)

- [ ] **Step 1: Create the in-app-navigation flag module**

```ts
// apps/admin-web/src/hooks/use-in-app-navigation.ts

// A tiny module-level flag, not React state — deliberately not routed through
// context. It answers one question: has this browser tab performed at least
// one in-app push yet? useCloseOverlay uses it to decide whether "close" can
// safely call browser back (there's something to go back to) or must replace
// to a computed parent URL instead (a fresh deep-link/refresh landing directly
// on a URL with an overlay already open has no prior in-app history).
let hasPushed = false;

export function markInAppNavigation(): void {
  hasPushed = true;
}

export function hasInAppNavigation(): boolean {
  return hasPushed;
}
```

- [ ] **Step 2: Create the URL-state hooks**

```ts
// apps/admin-web/src/hooks/use-url-state.ts
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { markInAppNavigation } from './use-in-app-navigation';

/**
 * Multiple query-param-backed values, read together and written atomically in
 * one push. Use this whenever two or more params represent one logical piece
 * of state (e.g. `view` + `gtId` for "which sub-view, of which record") so
 * entering/leaving that state is a single history entry, not two.
 *
 * Always pushes (never `{ replace: true }`) so every change is a browser Back
 * stop. Params not named in `next` are left untouched.
 */
export function useUrlStateMulti(
  keys: readonly string[],
): [Record<string, string | null>, (next: Record<string, string | null>) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const values: Record<string, string | null> = {};
  for (const k of keys) values[k] = searchParams.get(k);

  const setValues = useCallback(
    (next: Record<string, string | null>) => {
      markInAppNavigation();
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v === null) params.delete(k);
          else params.set(k, v);
        }
        return params;
      });
    },
    [setSearchParams],
  );

  return [values, setValues];
}

/** Single-param convenience wrapper around `useUrlStateMulti`. */
export function useUrlState(key: string): [string | null, (value: string | null) => void] {
  const [values, setValues] = useUrlStateMulti([key]);
  const setValue = useCallback((value: string | null) => setValues({ [key]: value }), [
    setValues,
    key,
  ]);
  return [values[key], setValue];
}
```

- [ ] **Step 3: Create the close-overlay hook**

```ts
// apps/admin-web/src/hooks/use-close-overlay.ts
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasInAppNavigation } from './use-in-app-navigation';

/**
 * "Close" for any URL-tracked overlay (modal, drawer, sub-view, confirm
 * dialog). Calls real browser back so the physical Back button and the
 * overlay's own X/Cancel button produce the identical result — pushing a
 * "closed" state instead would leave a dead-end forward entry that reopens
 * the overlay on the next Back press.
 *
 * Falls back to replacing to `toParentUrl` when this tab has no prior in-app
 * push to go back to (a fresh load or refresh landing directly on a URL that
 * already has the overlay open) — otherwise browser back could exit the app.
 */
export function useCloseOverlay(toParentUrl: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    if (hasInAppNavigation()) {
      navigate(-1);
    } else {
      navigate(toParentUrl, { replace: true });
    }
  }, [navigate, toParentUrl]);
}
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @aivastra/admin build`
Expected: build succeeds with no TypeScript errors (these three files aren't imported anywhere yet, so this only confirms they're individually well-typed).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/hooks/use-in-app-navigation.ts apps/admin-web/src/hooks/use-url-state.ts apps/admin-web/src/hooks/use-close-overlay.ts
git commit -m "feat(admin): add push-based URL-state and close-overlay hooks"
```

---

### Task 2: Breadcrumb registry, wired into the existing trail

**Files:**
- Create: `apps/admin-web/src/context/BreadcrumbContext.tsx`
- Modify: `apps/admin-web/src/main.tsx`
- Modify: `apps/admin-web/src/App.tsx:1-2,210-215,232-238` (imports, trail construction, `Topbar` props)
- Modify: `apps/admin-web/src/components/Topbar.tsx` (whole file — prop types and render)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `Crumb` type (`{ label: string; href: string }`), `BreadcrumbProvider`, `useBreadcrumbContext(): { crumbs: Crumb[]; setCrumb: (depth: number, crumb: Crumb | null) => void }`, `useCrumb(depth: number, crumb: Crumb | null): void` — all from `BreadcrumbContext.tsx`. Later tasks call `useCrumb` directly.

- [ ] **Step 1: Create the breadcrumb registry**

```tsx
// apps/admin-web/src/context/BreadcrumbContext.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface Crumb {
  label: string;
  href: string;
}

interface BreadcrumbContextValue {
  crumbs: Crumb[];
  setCrumb: (depth: number, crumb: Crumb | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function useBreadcrumbContext(): BreadcrumbContextValue {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) throw new Error('useBreadcrumbContext must be used inside BreadcrumbProvider');
  return ctx;
}

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Record<number, Crumb>>({});

  const setCrumb = useCallback((depth: number, crumb: Crumb | null) => {
    setEntries((prev) => {
      if (crumb === null) {
        if (!(depth in prev)) return prev;
        const next = { ...prev };
        delete next[depth];
        return next;
      }
      const existing = prev[depth];
      if (existing && existing.label === crumb.label && existing.href === crumb.href) return prev;
      return { ...prev, [depth]: crumb };
    });
  }, []);

  const crumbs = useMemo(
    () =>
      Object.keys(entries)
        .map(Number)
        .sort((a, b) => a - b)
        .map((depth) => entries[depth]),
    [entries],
  );

  const value = useMemo(() => ({ crumbs, setCrumb }), [crumbs, setCrumb]);

  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/**
 * Registers a breadcrumb at a fixed `depth` (a level number the caller
 * chooses, not mount order) for as long as the calling component is mounted
 * with a non-null `crumb`; clears it on unmount or when `crumb` becomes null.
 * Using an explicit depth instead of mount-order keeps the trail correct
 * under React StrictMode's mount→unmount→mount double-invoke.
 */
export function useCrumb(depth: number, crumb: Crumb | null): void {
  const { setCrumb } = useBreadcrumbContext();
  const label = crumb?.label ?? null;
  const href = crumb?.href ?? null;
  useEffect(() => {
    setCrumb(depth, label !== null && href !== null ? { label, href } : null);
    return () => setCrumb(depth, null);
  }, [depth, label, href, setCrumb]);
}
```

- [ ] **Step 2: Wrap the app in the provider**

In `apps/admin-web/src/main.tsx`, add the import and wrap `<App />`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { BreadcrumbProvider } from './context/BreadcrumbContext.tsx';

// Admin now lives on its own subdomain (admin.aivastra.com), mounted at the
// domain root — no /panel path prefix needed anymore.
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BreadcrumbProvider>
          <App />
        </BreadcrumbProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 3: Update `Topbar` to take structured crumbs**

Replace the whole contents of `apps/admin-web/src/components/Topbar.tsx`:

```tsx
import { Fragment } from 'react';
import { useAuth } from '../context/AuthContext';
import type { Crumb } from '../context/BreadcrumbContext';
import { Icon } from './Icons';

interface TopbarProps {
  trail: Crumb[];
  onNavTrail: (href: string) => void;
  theme: 'light' | 'dark' | 'system';
  onToggleTheme: () => void;
  onOpenMobileNav: () => void;
}

export function Topbar({ trail, onNavTrail, theme, onToggleTheme, onOpenMobileNav }: TopbarProps) {
  const { email, role } = useAuth();
  const emailUser = email ? email.split('@')[0] : 'Admin';
  const initials = emailUser.slice(0, 2).toUpperCase();
  const displayEmail = email ?? '';

  return (
    <div className="topbar">
      <button
        type="button"
        className="mobile-only topbar-menu-btn"
        onClick={onOpenMobileNav}
        aria-label="Open navigation menu"
      >
        <Icon.Menu />
      </button>
      <div className="crumbs">
        {trail.map((crumb, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb trail has no stable id
          <Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {i < trail.length - 1 ? (
              <button className="crumb-link" onClick={() => onNavTrail(crumb.href)}>
                {crumb.label}
              </button>
            ) : (
              <b>{crumb.label}</b>
            )}
          </Fragment>
        ))}
      </div>
      <div className="topbar-tools">
        <button
          className="iconbtn"
          onClick={onToggleTheme}
          title={`Theme: ${theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'} (click to cycle)`}
          aria-label={`Theme: ${theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'}; click to cycle`}
        >
          {theme === 'system' ? <Icon.Monitor /> : theme === 'dark' ? <Icon.Moon /> : <Icon.Sun />}
        </button>
        <div className="topbar-user">
          <div className="who">
            <b>{emailUser}</b>
            <span className="role-pill">{role}</span>
          </div>
          <span className="avatar" title={displayEmail}>
            {initials}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build the full trail in `App.tsx` and update the `Topbar` call site**

In `apps/admin-web/src/App.tsx`, add the import:

```ts
import { useBreadcrumbContext } from './context/BreadcrumbContext';
```

**Call `useBreadcrumbContext()` above the component's early returns, not at the `trail` site.** `App`'s body has `if (isLoading) return ...;` and `if (!token) return <LoginPage />;` (currently around `App.tsx:188-209`) *before* the `trail` construction — calling a hook after those would make it conditional (skipped on the loading/logged-out renders), which is a Rules-of-Hooks violation this repo's biome lint (`useHookAtTopLevel`) rejects at commit time. Add it instead next to the component's other unconditional hooks, immediately after `const location = useLocation();` (currently `App.tsx:81`):

```ts
  const idRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  // Called unconditionally (not after the isLoading/!token early returns below) —
  // Rules of Hooks requires every hook to run in the same order on every render,
  // and the pre-commit lint (biome useHookAtTopLevel) enforces it.
  const { crumbs: registeredCrumbs } = useBreadcrumbContext();
```

Then replace this block (currently at `App.tsx:211-214`):

```ts
  const segment = location.pathname.slice(1).split('/')[0] || 'dashboard';
  const pageLabel = PATH_LABELS[segment] ?? 'Dashboard';
  const trail = ['Aivastra', pageLabel];
  const pageProps = { onNav: handleNavWithFilter, toast };
```

with (note: no second `useBreadcrumbContext()` call here — `registeredCrumbs` is already in scope from the hook call added above):

```ts
  const segment = location.pathname.slice(1).split('/')[0] || 'dashboard';
  const pageLabel = PATH_LABELS[segment] ?? 'Dashboard';
  const trail = [
    { label: 'Aivastra', href: '/dashboard' },
    { label: pageLabel, href: `/${segment}` },
    ...registeredCrumbs,
  ];
  const pageProps = { onNav: handleNavWithFilter, toast };
```

Replace the `Topbar` element (currently at `App.tsx:232-238`):

```tsx
        <Topbar
          trail={trail}
          onNavTrail={(i) => i === 0 && navigate('/dashboard')}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
```

with:

```tsx
        <Topbar
          trail={trail}
          onNavTrail={(href) => navigate(href)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
```

- [ ] **Step 5: Verify no regression**

Run: `pnpm --filter @aivastra/admin build`
Expected: build succeeds with no TypeScript errors.

Run: `pnpm --filter @aivastra/admin dev`, open the admin panel in a browser, log in.
Expected: the breadcrumb still reads "Aivastra / Dashboard" on load (or "Aivastra / Assets" etc. on other pages), and clicking "Aivastra" still navigates to `/dashboard` — identical to before this task, since no component registers a deeper crumb yet.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/context/BreadcrumbContext.tsx apps/admin-web/src/main.tsx apps/admin-web/src/App.tsx apps/admin-web/src/components/Topbar.tsx
git commit -m "feat(admin): add breadcrumb registry and wire it into Topbar"
```

---

### Task 3: Push (not replace) on tab switch

**Files:**
- Modify: `apps/admin-web/src/pages/assets/AssetsContext.tsx:1-2,70-77`

**Interfaces:**
- Consumes: `markInAppNavigation` from `apps/admin-web/src/hooks/use-in-app-navigation.ts` (Task 1).

- [ ] **Step 1: Import the flag helper**

In `apps/admin-web/src/pages/assets/AssetsContext.tsx`, change the top of the file from:

```ts
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../lib/data';
```

to:

```ts
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { markInAppNavigation } from '../../hooks/use-in-app-navigation';
import { apiFetch } from '../../lib/data';
```

- [ ] **Step 2: Push instead of replace, and drop the previous tab's params**

Replace (currently `AssetsContext.tsx:74-77`):

```ts
  const setActiveTab = useCallback(
    (tab: AssetTab) => setSearchParams({ tab }, { replace: true }),
    [setSearchParams],
  );
```

with:

```ts
  const setActiveTab = useCallback(
    (tab: AssetTab) => {
      // Full replacement, not a merge: switching tabs intentionally drops any
      // sub-view/modal/confirm params that belonged to the previous tab.
      // Pushed (not `{ replace: true }`) so every tab switch is its own
      // back-button stop.
      markInAppNavigation();
      setSearchParams({ tab });
    },
    [setSearchParams],
  );
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter @aivastra/admin build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Manual verification**

Run: `pnpm --filter @aivastra/admin dev`, open `/assets` in a browser.
Steps: click "Model Faces" tab, then "Backgrounds" tab, then "Garment Types" tab. Press the browser's physical Back button three times.
Expected: each Back press steps to the previous tab in order (Backgrounds → Model Faces → Garment Types → whatever page was open before `/assets`), never skipping one.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/pages/assets/AssetsContext.tsx
git commit -m "feat(admin): make Assets tab switches back-button stops"
```

---

### Task 4: `GarmentTypesTab` sub-view (`view`/`gtId`) as URL state, with breadcrumbs

**Files:**
- Modify: `apps/admin-web/src/pages/assets/GarmentTypesTab.tsx` (imports; `subView` state; the "Back to Garment Types" button; both `onClick`s that open the configs sub-view; breadcrumb registration)

**Interfaces:**
- Consumes: `useUrlStateMulti` (Task 1), `useCloseOverlay` (Task 1), `useCrumb` (Task 2).
- Produces: `subView: SubView` (same shape as before — `{ kind: 'list' }` or `{ kind: 'configs'; sub: GarmentType }`), now derived rather than stored, so every other reference to `subView` elsewhere in the file (`ShotTypeWorkflowsPanel`, `GarmentTemplateMappingPanel`, `PoseConfigsPanel` props, the `useEffect`s at lines 168-189) keeps working unchanged.

- [ ] **Step 1: Add imports**

In `apps/admin-web/src/pages/assets/GarmentTypesTab.tsx`, change:

```ts
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { EditDrawer } from '../../components/EditDrawer';
import { EditGarmentTypeModal } from '../../components/EditGarmentTypeModal';
import { Icon } from '../../components/Icons';
import { SearchableSelect } from '../../components/SearchableSelect';
import { Switch } from '../../components/Switch';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import { makeThumbnail } from '../../lib/thumbnail';
```

to:

```ts
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { EditDrawer } from '../../components/EditDrawer';
import { EditGarmentTypeModal } from '../../components/EditGarmentTypeModal';
import { Icon } from '../../components/Icons';
import { SearchableSelect } from '../../components/SearchableSelect';
import { Switch } from '../../components/Switch';
import { useCrumb } from '../../context/BreadcrumbContext';
import { useCloseOverlay } from '../../hooks/use-close-overlay';
import { useUrlStateMulti } from '../../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import { makeThumbnail } from '../../lib/thumbnail';
```

- [ ] **Step 2: Replace the `subView` state with URL-derived state**

Replace (currently `GarmentTypesTab.tsx:101`):

```ts
  const [subView, setSubView] = useState<SubView>({ kind: 'list' });
```

with:

```ts
  const tabHref = '/assets?tab=garment-types';
  const [{ view: viewParam, gtId }, setSubViewParams] = useUrlStateMulti(['view', 'gtId']);
  const subView: SubView = useMemo(() => {
    if (viewParam === 'configs' && gtId) {
      const sub = garmentTypes.find((g) => g.id === gtId);
      if (sub) return { kind: 'configs', sub };
    }
    return { kind: 'list' };
  }, [viewParam, gtId, garmentTypes]);
  const openConfigs = useCallback(
    (sub: GarmentType) => setSubViewParams({ view: 'configs', gtId: sub.id }),
    [setSubViewParams],
  );
  const closeConfigs = useCloseOverlay(tabHref);
```

(`garmentTypes` is already destructured from `useAssetsContext()` a few lines above this, at `GarmentTypesTab.tsx:91`, so it's in scope.)

- [ ] **Step 3: Point the two "open configs" click handlers at `openConfigs`**

Replace (currently `GarmentTypesTab.tsx:491`, the desktop table row):

```tsx
                    onClick={() => setSubView({ kind: 'configs', sub })}
```

with:

```tsx
                    onClick={() => openConfigs(sub)}
```

Replace (currently `GarmentTypesTab.tsx:835`, the mobile card's "Setup Poses" button):

```tsx
                        <button
                          className="btn sm ghost"
                          onClick={() => setSubView({ kind: 'configs', sub })}
                        >
                          Setup Poses
                        </button>
```

with:

```tsx
                        <button className="btn sm ghost" onClick={() => openConfigs(sub)}>
                          Setup Poses
                        </button>
```

- [ ] **Step 4: Point "Back to Garment Types" at `closeConfigs`**

Replace (currently `GarmentTypesTab.tsx:375-383`):

```tsx
          {subView.kind === 'configs' && (
            <button
              className="btn sm ghost"
              onClick={() => setSubView({ kind: 'list' })}
              style={{ padding: '2px 8px', fontSize: 13, marginBottom: 10 }}
            >
              <Icon.ArrowLeft /> Back to Garment Types
            </button>
          )}
```

with:

```tsx
          {subView.kind === 'configs' && (
            <button
              className="btn sm ghost"
              onClick={closeConfigs}
              style={{ padding: '2px 8px', fontSize: 13, marginBottom: 10 }}
            >
              <Icon.ArrowLeft /> Back to Garment Types
            </button>
          )}
```

- [ ] **Step 5: Update `saveDefaultPose`'s `setSubView` call**

`saveDefaultPose` (currently `GarmentTypesTab.tsx:242-267`) patches the in-memory `subView` object after a save so the configs panel reflects the new default pose immediately, without a refetch:

```ts
      setSubView((prev) =>
        prev.kind === 'configs' && prev.sub.id === garmentTypeId
          ? { kind: 'configs', sub: { ...prev.sub, defaultPoseId: poseAssetId } }
          : prev,
      );
```

Since `subView` is now derived (no setter), this patch instead needs to update the underlying `garmentTypes` list — `subView` will re-derive from it automatically via the `useMemo` in Step 2. Replace the block above with:

```ts
      setGarmentTypes((prev) =>
        prev.map((s) => (s.id === garmentTypeId ? { ...s, defaultPoseId: poseAssetId } : s)),
      );
```

Note this is now a **duplicate** of the `setGarmentTypes` call two lines above it in the same function (`GarmentTypesTab.tsx:249-251`) — both branches now do the same update, so the `defaultPoseId` update fires once via `setGarmentTypes` and the `setSubView` line is deleted outright rather than replaced. Confirm the surrounding function reads exactly:

```ts
  const saveDefaultPose = async (garmentTypeId: string, poseAssetId: string | null) => {
    setSavingDefaultPose(true);
    try {
      await apiFetch(`/admin/assets/garment-types/${garmentTypeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ defaultPoseId: poseAssetId }),
      });
      setGarmentTypes((prev) =>
        prev.map((s) => (s.id === garmentTypeId ? { ...s, defaultPoseId: poseAssetId } : s)),
      );
      toast({ title: 'Default pose updated' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update default pose',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSavingDefaultPose(false);
    }
  };
```

- [ ] **Step 6: Register breadcrumbs for the tab and the sub-view**

Add this after the `closeConfigs` line from Step 2:

```ts
  useCrumb(0, { label: 'Garment Types', href: tabHref });
  useCrumb(
    1,
    subView.kind === 'configs'
      ? { label: `Configs: ${subView.sub.label}`, href: `${tabHref}&view=configs&gtId=${subView.sub.id}` }
      : null,
  );
```

- [ ] **Step 7: Verify it compiles**

Run: `pnpm --filter @aivastra/admin build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 8: Manual verification**

Run: `pnpm --filter @aivastra/admin dev`, open `/assets?tab=garment-types`.
1. Click a garment type row to open its configs sub-view. Expected: URL becomes `/assets?tab=garment-types&view=configs&gtId=<id>`, and the breadcrumb reads "Aivastra / Assets / Garment Types / Configs: `<label>`".
2. Press the physical Back button. Expected: returns to the plain list view (`/assets?tab=garment-types`), breadcrumb shortens to "Aivastra / Assets / Garment Types".
3. Click a garment type again to re-open configs, then click "Back to Garment Types" (the in-page button, not the browser button). Expected: identical result to pressing physical Back — lands on the list view, and a subsequent physical Back press does **not** re-open the configs sub-view (proving the button used `navigate(-1)`, not a new push).
4. With a configs URL open, hard-refresh the page (F5). Expected: the configs sub-view reconstructs correctly (same garment type, same panels) rather than showing a blank page.
5. While the configs sub-view is open, click the "Garment Types" breadcrumb crumb (the one before "Configs: `<label>`", which is not itself clickable since it's the last/current crumb). Expected: navigates straight to the plain list view.

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web/src/pages/assets/GarmentTypesTab.tsx
git commit -m "feat(admin): make garment-types sub-view URL-driven with breadcrumbs"
```

---

### Task 5: Add/Edit garment-type modals as URL state

**Files:**
- Modify: `apps/admin-web/src/pages/assets/GarmentTypesTab.tsx` (`showSubcatModal`/`editingSubcat` state; both "open add modal" and "open edit modal" click handlers; the `EditDrawer`'s `onClose`/`onSave`; the `EditGarmentTypeModal`'s `onClose`; breadcrumb registration)

**Interfaces:**
- Consumes: `useUrlStateMulti`, `useCloseOverlay` (Task 1); `useCrumb` (Task 2); `tabHref` (Task 4, same file).
- Produces: `showSubcatModal: boolean`, `editingSubcat: GarmentType | null` (same shapes as before, now derived).

- [ ] **Step 1: Replace `showSubcatModal`/`editingSubcat` state**

Replace (currently `GarmentTypesTab.tsx:123` and `:136`):

```ts
  // Add garment type modal
  const [showSubcatModal, setShowSubcatModal] = useState(false);
  const [subcatForm, setSubcatForm] = useState({
    slug: '',
    label: '',
    genderSlug: 'men' as GenderSlug,
    requiresLowerUpload: false,
    requiresThirdUpload: false,
    sortOrder: 0,
  });
  const [subcatSaving, setSubcatSaving] = useState(false);
  const [subcatImageFile, setSubcatImageFile] = useState<File | null>(null);

  // Edit garment type modal
  const [editingSubcat, setEditingSubcat] = useState<GarmentType | null>(null);
```

with:

```ts
  // Add garment type modal — only "is it open" is URL state; the form's own
  // field values and the picked File (not serializable into a URL) stay local.
  const [{ modal: modalParam, editId }, setModalParams] = useUrlStateMulti(['modal', 'editId']);
  const showSubcatModal = modalParam === 'add-garment-type';
  const [subcatForm, setSubcatForm] = useState({
    slug: '',
    label: '',
    genderSlug: 'men' as GenderSlug,
    requiresLowerUpload: false,
    requiresThirdUpload: false,
    sortOrder: 0,
  });
  const [subcatSaving, setSubcatSaving] = useState(false);
  const [subcatImageFile, setSubcatImageFile] = useState<File | null>(null);
  const closeAddModal = useCloseOverlay(tabHref);

  // Edit garment type modal
  const editingSubcat: GarmentType | null =
    modalParam === 'edit-garment-type' && editId
      ? (garmentTypes.find((g) => g.id === editId) ?? null)
      : null;
  const openEditModal = useCallback(
    (sub: GarmentType) => setModalParams({ modal: 'edit-garment-type', editId: sub.id }),
    [setModalParams],
  );
  const closeEditModal = useCloseOverlay(tabHref);
```

- [ ] **Step 2: Point "Add garment type" at the URL setter**

Replace (currently `GarmentTypesTab.tsx:392-409`):

```tsx
          <div className="head-tools">
            <button
              className="btn"
              onClick={() => {
                setSubcatForm({
                  slug: '',
                  label: '',
                  genderSlug: 'men',
                  requiresLowerUpload: false,
                  requiresThirdUpload: false,
                  sortOrder: nextSortOrderFor('men'),
                });
                setShowSubcatModal(true);
              }}
            >
              <Icon.Add /> Add garment type
            </button>
          </div>
```

with:

```tsx
          <div className="head-tools">
            <button
              className="btn"
              onClick={() => {
                setSubcatForm({
                  slug: '',
                  label: '',
                  genderSlug: 'men',
                  requiresLowerUpload: false,
                  requiresThirdUpload: false,
                  sortOrder: nextSortOrderFor('men'),
                });
                setModalParams({ modal: 'add-garment-type', editId: null });
              }}
            >
              <Icon.Add /> Add garment type
            </button>
          </div>
```

- [ ] **Step 3: Point both "Edit" buttons at `openEditModal`**

Replace (currently `GarmentTypesTab.tsx:619`, desktop row):

```tsx
                        <button className="btn sm ghost" onClick={() => setEditingSubcat(sub)}>
                          <Icon.Edit />
                        </button>
```

with:

```tsx
                        <button className="btn sm ghost" onClick={() => openEditModal(sub)}>
                          <Icon.Edit />
                        </button>
```

Replace (currently `GarmentTypesTab.tsx:839`, mobile card):

```tsx
                        <button className="btn sm ghost" onClick={() => setEditingSubcat(sub)}>
                          <Icon.Edit /> Edit
                        </button>
```

with:

```tsx
                        <button className="btn sm ghost" onClick={() => openEditModal(sub)}>
                          <Icon.Edit /> Edit
                        </button>
```

- [ ] **Step 4: Update the `EditDrawer`'s close and save handlers**

Replace (currently `GarmentTypesTab.tsx:899-949`):

```tsx
      {showSubcatModal && (
        <EditDrawer
          onClose={() => {
            setShowSubcatModal(false);
            setSubcatImageFile(null);
          }}
          title="Add garment type"
          width="min(560px, calc(100vw - 60px))"
          saving={subcatSaving}
          saveDisabled={!subcatForm.label.trim() || !subcatForm.slug.trim()}
          saveLabel={subcatSaving ? 'Creating…' : 'Create'}
          onSave={async () => {
            setSubcatSaving(true);
            try {
              let thumbnailKey: string | undefined;
              if (subcatImageFile) {
                const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
                  '/admin/assets/garment-types/presign',
                  {
                    method: 'POST',
                    body: JSON.stringify({ contentType: subcatImageFile.type }),
                  },
                );
                const thumb = await makeThumbnail(subcatImageFile);
                await fetch(presign.uploadUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': thumb.type },
                  body: thumb,
                });
                thumbnailKey = presign.thumbnailKey;
              }
              const row = await apiFetch<GarmentType>('/admin/assets/garment-types', {
                method: 'POST',
                body: JSON.stringify({ ...subcatForm, thumbnailKey }),
              });
              // A collision at the chosen sortOrder shifts other rows of this
              // gender server-side - refetch instead of patching just this one.
              await loadGarmentTypes();
              toast({ title: `${row.label} created` });
              setShowSubcatModal(false);
              setSubcatImageFile(null);
            } catch (e) {
              toast({
                kind: 'error',
                title: 'Failed to create garment type',
                body: apiErrorMessage(e, 'Please try again.'),
              });
            } finally {
              setSubcatSaving(false);
            }
          }}
        >
```

with:

```tsx
      {showSubcatModal && (
        <EditDrawer
          onClose={() => {
            setSubcatImageFile(null);
            closeAddModal();
          }}
          title="Add garment type"
          width="min(560px, calc(100vw - 60px))"
          saving={subcatSaving}
          saveDisabled={!subcatForm.label.trim() || !subcatForm.slug.trim()}
          saveLabel={subcatSaving ? 'Creating…' : 'Create'}
          onSave={async () => {
            setSubcatSaving(true);
            try {
              let thumbnailKey: string | undefined;
              if (subcatImageFile) {
                const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
                  '/admin/assets/garment-types/presign',
                  {
                    method: 'POST',
                    body: JSON.stringify({ contentType: subcatImageFile.type }),
                  },
                );
                const thumb = await makeThumbnail(subcatImageFile);
                await fetch(presign.uploadUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': thumb.type },
                  body: thumb,
                });
                thumbnailKey = presign.thumbnailKey;
              }
              const row = await apiFetch<GarmentType>('/admin/assets/garment-types', {
                method: 'POST',
                body: JSON.stringify({ ...subcatForm, thumbnailKey }),
              });
              // A collision at the chosen sortOrder shifts other rows of this
              // gender server-side - refetch instead of patching just this one.
              await loadGarmentTypes();
              toast({ title: `${row.label} created` });
              setSubcatImageFile(null);
              closeAddModal();
            } catch (e) {
              toast({
                kind: 'error',
                title: 'Failed to create garment type',
                body: apiErrorMessage(e, 'Please try again.'),
              });
            } finally {
              setSubcatSaving(false);
            }
          }}
        >
```

- [ ] **Step 5: Update the `EditGarmentTypeModal`'s close handler**

Replace (currently `GarmentTypesTab.tsx:1103-1117`):

```tsx
      {editingSubcat && (
        <EditGarmentTypeModal
          garmentType={editingSubcat}
          catalogItems={catalogItems}
          tryonCategories={tryonCategories}
          workflows={workflows}
          onSaved={() => {
            // A sortOrder change shifts other rows of this gender server-side -
            // refetch instead of patching just the edited row.
            void loadGarmentTypes();
          }}
          onClose={() => setEditingSubcat(null)}
          toast={toast}
        />
      )}
```

with:

```tsx
      {editingSubcat && (
        <EditGarmentTypeModal
          garmentType={editingSubcat}
          catalogItems={catalogItems}
          tryonCategories={tryonCategories}
          workflows={workflows}
          onSaved={() => {
            // A sortOrder change shifts other rows of this gender server-side -
            // refetch instead of patching just the edited row.
            void loadGarmentTypes();
          }}
          onClose={closeEditModal}
          toast={toast}
        />
      )}
```

- [ ] **Step 6: Register a breadcrumb for whichever modal is open**

Add this after the breadcrumb registration block added in Task 4 Step 6:

```ts
  useCrumb(
    2,
    showSubcatModal
      ? { label: 'Add', href: `${tabHref}&modal=add-garment-type` }
      : editingSubcat
        ? { label: 'Edit', href: `${tabHref}&modal=edit-garment-type&editId=${editingSubcat.id}` }
        : null,
  );
```

- [ ] **Step 7: Verify it compiles**

Run: `pnpm --filter @aivastra/admin build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 8: Manual verification**

Run: `pnpm --filter @aivastra/admin dev`, open `/assets?tab=garment-types`.
1. Click "Add garment type". Expected: URL becomes `/assets?tab=garment-types&modal=add-garment-type`, drawer opens, breadcrumb reads "... / Garment Types / Add".
2. Press physical Back. Expected: drawer closes, URL returns to `/assets?tab=garment-types`.
3. Click "Add garment type" again, then click the drawer's own close (X) control. Expected: drawer closes. Then press physical Back. Expected: nothing reopens — Back takes you to whatever was open before you opened the drawer (proving the X button consumed the same history entry Back would have).
4. Click a row's Edit icon. Expected: URL becomes `/assets?tab=garment-types&modal=edit-garment-type&editId=<id>`, modal opens with that garment type's data, breadcrumb reads "... / Garment Types / Edit".
5. Fill in the Add form and click "Create". Expected: on success, the drawer closes the same way physical Back would (a `-1` navigation, not a fresh push) — verify by creating, then pressing Back once more and confirming it leaves `/assets` entirely rather than reopening the (now-closed) drawer.

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web/src/pages/assets/GarmentTypesTab.tsx
git commit -m "feat(admin): make add/edit garment-type modals URL-driven"
```

---

### Task 6: Confirm-delete dialog and accordion expand as URL state

**Files:**
- Modify: `apps/admin-web/src/pages/assets/GarmentTypesTab.tsx` (`confirmDelete`/`expandedGarmentTypeId` state; both "delete" click handlers; the confirm dialog's overlay/Cancel/Delete handlers; `doDelete`; the accordion toggle handler — unchanged signature; breadcrumb registration)

**Interfaces:**
- Consumes: `useUrlState`, `useUrlStateMulti`, `useCloseOverlay` (Task 1); `useCrumb` (Task 2); `tabHref` (Task 4, same file).
- Produces: `confirmDelete: ConfirmDeleteGT | null`, `expandedGarmentTypeId: string | null` (same shapes as before, now derived/URL-backed).

- [ ] **Step 1: Replace `confirmDelete` and `expandedGarmentTypeId` state**

Replace (currently `GarmentTypesTab.tsx:106` and `:108`):

```ts
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteGT | null>(null);
  const [tryonCategories, setTryonCategories] = useState<TryonCategory[]>([]);
  const [expandedGarmentTypeId, setExpandedGarmentTypeId] = useState<string | null>(null);
```

with:

```ts
  const [{ confirm: confirmParam, confirmId }, setConfirmParams] = useUrlStateMulti([
    'confirm',
    'confirmId',
  ]);
  const confirmDelete: ConfirmDeleteGT | null = useMemo(() => {
    if (confirmParam !== 'delete-garment-type' || !confirmId) return null;
    const sub = garmentTypes.find((g) => g.id === confirmId);
    return sub ? { type: 'garment-type', id: sub.id, label: sub.label } : null;
  }, [confirmParam, confirmId, garmentTypes]);
  const openConfirmDelete = useCallback(
    (sub: GarmentType) => setConfirmParams({ confirm: 'delete-garment-type', confirmId: sub.id }),
    [setConfirmParams],
  );
  const closeConfirmDelete = useCloseOverlay(tabHref);
  const [tryonCategories, setTryonCategories] = useState<TryonCategory[]>([]);
  const [expandedGarmentTypeId, setExpandedGarmentTypeId] = useUrlState('expanded');
```

(`useUrlState` needs adding to the import from Task 4/5's `'../../hooks/use-url-state'` line — change `import { useUrlStateMulti } from '../../hooks/use-url-state';` to `import { useUrlState, useUrlStateMulti } from '../../hooks/use-url-state';`.)

- [ ] **Step 2: Point both "Delete" buttons at `openConfirmDelete`**

Replace (currently `GarmentTypesTab.tsx:622-629`, desktop row):

```tsx
                        <button
                          className="btn sm ghost"
                          onClick={() =>
                            setConfirmDelete({ type: 'garment-type', id: sub.id, label: sub.label })
                          }
                        >
                          <Icon.Trash />
                        </button>
```

with:

```tsx
                        <button className="btn sm ghost" onClick={() => openConfirmDelete(sub)}>
                          <Icon.Trash />
                        </button>
```

Replace (currently `GarmentTypesTab.tsx:842-849`, mobile card):

```tsx
                        <button
                          className="btn sm ghost danger"
                          onClick={() =>
                            setConfirmDelete({ type: 'garment-type', id: sub.id, label: sub.label })
                          }
                        >
                          <Icon.Trash /> Delete
                        </button>
```

with:

```tsx
                        <button className="btn sm ghost danger" onClick={() => openConfirmDelete(sub)}>
                          <Icon.Trash /> Delete
                        </button>
```

- [ ] **Step 3: Update `doDelete` to close via `closeConfirmDelete`**

Replace (currently `GarmentTypesTab.tsx:343-365`):

```ts
  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id, label } = confirmDelete;
    setConfirmDelete(null);

    if (id.startsWith('gt_demo_')) {
      setGarmentTypes((prev) => prev.filter((s) => s.id !== id));
      toast({ title: `${label} deleted` });
      return;
    }

    try {
      await apiFetch(`/admin/assets/garment-types/${id}`, { method: 'DELETE' });
      setGarmentTypes((prev) => prev.filter((s) => s.id !== id));
      toast({ title: `${label} deleted` });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to delete garment type',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };
```

with:

```ts
  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id, label } = confirmDelete;
    closeConfirmDelete();

    if (id.startsWith('gt_demo_')) {
      setGarmentTypes((prev) => prev.filter((s) => s.id !== id));
      toast({ title: `${label} deleted` });
      return;
    }

    try {
      await apiFetch(`/admin/assets/garment-types/${id}`, { method: 'DELETE' });
      setGarmentTypes((prev) => prev.filter((s) => s.id !== id));
      toast({ title: `${label} deleted` });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to delete garment type',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };
```

- [ ] **Step 4: Update the confirm dialog's overlay-click and Cancel button**

Replace (currently `GarmentTypesTab.tsx:875-896`):

```tsx
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete garment type</h3>
            </div>
            <div className="modal-body">
              <p>
                Delete <strong>{confirmDelete.label}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="btn danger" onClick={doDelete}>
                <Icon.Trash /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
```

with:

```tsx
      {confirmDelete && (
        <div className="modal-overlay" onClick={closeConfirmDelete}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete garment type</h3>
            </div>
            <div className="modal-body">
              <p>
                Delete <strong>{confirmDelete.label}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={closeConfirmDelete}>
                Cancel
              </button>
              <button className="btn danger" onClick={doDelete}>
                <Icon.Trash /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Register a breadcrumb for the confirm dialog**

Add this after the breadcrumb registration block added in Task 5 Step 6:

```ts
  useCrumb(
    3,
    confirmDelete
      ? {
          label: 'Delete',
          href: `${tabHref}&confirm=delete-garment-type&confirmId=${confirmDelete.id}`,
        }
      : null,
  );
```

- [ ] **Step 6: Verify it compiles**

Run: `pnpm --filter @aivastra/admin build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Manual verification**

Run: `pnpm --filter @aivastra/admin dev`, open `/assets?tab=garment-types`.
1. Click a row's Delete icon. Expected: URL becomes `/assets?tab=garment-types&confirm=delete-garment-type&confirmId=<id>`, dialog opens, breadcrumb reads "... / Garment Types / Delete".
2. Press physical Back. Expected: dialog closes, URL returns to `/assets?tab=garment-types`.
3. Open it again, click "Cancel". Expected: dialog closes; a subsequent physical Back press does not reopen it (same parity check as Task 5's modal).
4. On a mobile-width viewport (or the browser's device toolbar), tap a garment type's accordion row to expand it. Expected: URL gains `&expanded=<id>`. Press physical Back. Expected: the accordion collapses.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/pages/assets/GarmentTypesTab.tsx
git commit -m "feat(admin): make confirm-delete and accordion expand URL-driven"
```

---

### Task 7: Full end-to-end verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full build one more time**

Run: `pnpm --filter @aivastra/admin build`
Expected: succeeds with no errors.

- [ ] **Step 2: Run lint**

Run: `pnpm --filter @aivastra/admin lint`
Expected: no new violations (in particular, confirm no unused imports were left behind from the removed `useState` calls — `useState` itself is still used elsewhere in the file for `subcatForm`/`subcatSaving`/`subcatImageFile`/`poseConfigs`/`configsLoading`/`savingConfigId`/`savingDefaultPose`/`tryonCategories`, so the import itself stays).

- [ ] **Step 3: Walk the full nested chain and un-nest it one Back press at a time**

Run: `pnpm --filter @aivastra/admin dev`, open `/assets`.
1. Click "Garment Types" tab.
2. Click a row to open its configs sub-view.
3. From the row (now visible again via "Back to Garment Types"... actually from the list, before entering configs) — click a different row's Edit icon to open the edit modal, then Cancel it, confirming the URL each time matches the pattern from Tasks 4-6.
4. Click a row's Delete icon to open the confirm dialog.
5. Press the physical Back button five times in a row, screenshotting or noting the URL after each press.
Expected: each press un-nests exactly one layer (confirm → edit intent already closed so this step lands on list → configs → list → whatever page preceded `/assets`), never skipping two layers at once and never reopening something already closed.

- [ ] **Step 4: Verify breadcrumb-jump behavior**

With the configs sub-view open, click the "Assets" breadcrumb crumb (not "Garment Types").
Expected: navigates to `/assets` with no `tab`/`view`/`gtId` params (or whatever `AssetsContext` defaults to), i.e. a plain jump to that ancestor level, not a step-by-step unwind.

- [ ] **Step 5: Verify hard-refresh reconstruction and the not-found fallback**

1. With the configs sub-view open, hard-refresh (F5). Expected: reconstructs correctly (Task 4 Step 8.4 already covered this — repeat here as part of the full chain).
2. Manually edit the URL to use a `gtId` that doesn't exist (e.g. `gtId=nonexistent`) and load it. Expected: falls back to the plain list view rather than crashing or showing a blank sub-view.

- [ ] **Step 6: Report**

No commit for this task (verification only). If any step fails, return to the relevant earlier task, fix, re-verify that task's own manual steps, then re-run this task from Step 3.
