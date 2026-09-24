# Shopify Mandatory Onboarding Wizard — Design

**Date:** 2026-09-24
**Branch:** `fix/routing-conditions-wrap-and-dev-reconciler-guard`
**Supersedes:** the Dashboard "Getting started" checklist card in
`apps/shopify/src/pages/DashboardPage.tsx` (including the "Customize the
button" row added in commit `52da3100`, which is relocated, not deleted).

## Motivation

Today a newly-installed Shopify merchant lands directly on the Dashboard,
which shows an optional, collapsible "Getting started" checklist (sync
products, enable try-on on a product, add the theme block) alongside normal
Dashboard content (balance, credit packs, stats). Nothing stops a merchant
from ignoring the checklist and wandering the rest of the admin app —
Manage, Pricing, Settings — with try-on not actually live on their storefront
yet.

This redesigns onboarding as a **mandatory, full-page wizard** shown before
any other part of the embedded admin app is reachable, replacing the checklist
column entirely.

## Gating mechanism

A new `/onboarding` route tree in `apps/shopify/src/App.tsx`:

| Route | Step |
|---|---|
| `/onboarding` | Intro |
| `/onboarding/products` | Product setup |
| `/onboarding/routing` | Routing setup |
| `/onboarding/theme` | Theme block |

`App.tsx` adds a redirect: while onboarding is incomplete, any non-`/onboarding*`
route redirects into the wizard at the **first incomplete step** (not always
the intro — see "Resuming" below). Once complete, `/onboarding*` itself
redirects to `/`. `AppNavMenu` (`apps/shopify/src/components/AppNavMenu.tsx`)
takes a new `onboardingComplete: boolean` prop and returns `null` while it's
false, in addition to its existing `!window.shopify` check — so the real
Shopify-rendered left nav doesn't appear mid-onboarding either.

## Completion state

A pure helper, `apps/shopify/src/lib/onboarding.ts`:

```ts
export type OnboardingStep = 'intro' | 'products' | 'routing' | 'theme';

export function getOnboardingStep(me: ShopifyMe): OnboardingStep | null {
  // null = onboarding complete
}
```

Step completion, reusing existing signals wherever they already exist:

- **Products** — done when `synced && enabled` (identical to today's checklist:
  `me.stats.syncedProductCount > 0` and `isTryOnEnabled(me)`). No new state.
  The step's own action is the same `syncProducts()` call as today's
  Dashboard, which also auto-enables global mode on first sync.
- **Routing** — done when `me.store.settings.onboardingRoutingConfirmed` is
  `true`. This is a **new** settings field — there is no existing signal for
  "the merchant has seen the routing step," since relying on the global
  default basket (no custom rule) is a perfectly valid, common end state.
- **Theme** — done when `me.store.settings.themeBlockConfirmed` is `true` —
  the exact existing flag, unchanged.
- **Intro** — has no persisted flag of its own. It is shown only when *none*
  of the above three are done yet (a genuinely fresh install). As soon as any
  one of them is done, `getOnboardingStep` skips straight to the first
  incomplete step among products/routing/theme.

`onboardingComplete = synced && enabled && onboardingRoutingConfirmed && themeBlockConfirmed`.

### Resuming mid-flow

`getOnboardingStep` is called on every load of `App.tsx` (it already has `me`
loaded before rendering routes). A merchant who synced products, closed the
tab, and came back later is redirected straight to `/onboarding/routing`, not
back through the intro. Each onboarding page also self-checks: if
`getOnboardingStep(me)` no longer matches its own step (e.g. the merchant
manually typed `/onboarding/theme` in the URL before finishing products), it
redirects to whatever the actual current step is — the wizard cannot be
replayed out of order in either direction.

## Pages

### Intro (`OnboardingIntroPage.tsx`)

Does **not** use `OnboardingLayout` — it has no persisted completion flag and
isn't one of the 3 steps that back the progress count, so a "Step N of 3"
indicator would misrepresent it. It's a standalone full-bleed welcome screen.

No API calls beyond the `me` already loaded by `App`. Three square image
containers in a row joined by "+" and "=":

`sample-photo.jpg` (person) **+** *garment photo* **=** `sample-result.jpg` (result)

`sample-photo.jpg` and `sample-result.jpg` already exist at
`apps/shopify/src/assets/` (orphaned from the removed Widget Design page —
same person, before/after). The middle garment image does not exist yet; it
will be added at `apps/shopify/src/assets/sample-garment.jpg` (or whatever
extension is supplied) before this page's implementation task runs. Headline
+ one line of subtext + a primary "Continue" button that navigates to
`/onboarding/products`. Purely presentational — no settings are written here.

### Products (`OnboardingProductsPage.tsx`)

Single `Card`: "Sync your products" button (same `syncProducts()` handler as
today's Dashboard, including its auto-enable-global-mode-on-first-sync
behavior), a status line once synced, "Continue" disabled until
`synced && enabled`, calling nothing extra on click (the step's completion is
already persisted by the sync/enable calls themselves) — just navigates to
`/onboarding/routing`.

### Routing (`OnboardingRoutingPage.tsx`)

Explains that products route to a default basket automatically. An optional
"Add a rule" button opens `RuleEditorModal` (already exported/self-contained
in `apps/shopify/src/pages/RoutingPage.tsx`, taking `baskets`,
`takenBasketIds`, `onClose`, `onSaved`) so a merchant who wants a custom rule
right away can add one without leaving the wizard — but it is never required.
"Continue" always works: it calls
`POST /v1/shopify/onboarding/confirm-routing`, then navigates to
`/onboarding/theme`. The full rule-management `IndexTable` (edit/delete
existing rules, global-rule toggles) is deliberately **not** embedded here —
that stays exclusive to the real Routing tab under Manage, reachable once
onboarding is complete.

### Theme (`OnboardingThemePage.tsx`)

The exact content and handlers of today's third Dashboard checklist row:
`openThemeEditor()` / `confirmThemeBlock()`, "Open theme editor" and "I've
added it" buttons. Restyled as a full step page. On confirm, `themeBlockDone`
becomes true, which makes `getOnboardingStep` return `null` — the next render
of `App.tsx`'s guard sends the merchant to `/`.

## Backend changes

- `packages/db/src/schema/shopify.ts` — add `onboardingRoutingConfirmed?: boolean`
  to the `ShopifyStoreSettings` interface (next to `themeBlockConfirmed`).
  Pure JSONB field; no migration.
- `apps/api/src/modules/shopify/onboarding.routes.ts` — new route
  `POST /v1/shopify/onboarding/confirm-routing`, structurally identical to
  the existing `confirm-theme-block` handler (merge
  `{ onboardingRoutingConfirmed: true }` into settings via
  `mergeStoreSettingsObject`, return `{ settings: updated.settings }`).
- `GET /v1/shopify/me` needs no change — `me.routes.ts` already returns
  `store.settings` verbatim, so the new field is visible to the frontend
  automatically once written.
- `apps/shopify/src/types.ts` — mirror the new field on the frontend's
  `ShopifyStoreSettings` interface (this app doesn't import the backend's
  `@aivastra/db` types; it keeps its own parallel interface, same as
  `themeBlockConfirmed` already does).

## Dashboard changes

`DashboardPage.tsx`'s entire "Getting started" `Card` is deleted: the
`StepRow` component, `doneCount`/`allDone`/`collapsed`/`expanded` state, the
`ProgressBar`, and all three `StepRow`s — a merchant can only reach Dashboard
once all three are already done, so this becomes dead code. It is replaced by
one small, always-visible `Card` carrying the same copy/link as the
"Customize the button" row from commit `52da3100`: "Change the button's text,
colors, promo message, or position by clicking the block in the theme
editor," with an "Open theme editor" button reusing `openThemeEditor()`. No
badge, no progress framing — there's nothing left to track.

## File structure

New:
- `apps/shopify/src/pages/OnboardingIntroPage.tsx`
- `apps/shopify/src/pages/OnboardingProductsPage.tsx`
- `apps/shopify/src/pages/OnboardingRoutingPage.tsx`
- `apps/shopify/src/pages/OnboardingThemePage.tsx`
- `apps/shopify/src/components/OnboardingLayout.tsx` — shared "Step N of 3"
  indicator (Products=1, Routing=2, Theme=3 — Intro is not counted, see below)
  + Continue/Back row, wraps the body of those three step pages only
- `apps/shopify/src/lib/onboarding.ts` — `getOnboardingStep`
- `apps/shopify/src/lib/onboarding.test.ts` — unit tests for the step matrix
- `apps/shopify/src/assets/sample-garment.jpg` (or supplied extension) — new
  asset, provided by the user before/during implementation

Modified:
- `apps/shopify/src/App.tsx` — 4 new routes + redirect guard
- `apps/shopify/src/components/AppNavMenu.tsx` — new `onboardingComplete` prop
- `apps/shopify/src/pages/DashboardPage.tsx` — checklist card removed,
  replaced with the small customize-tip card
- `apps/api/src/modules/shopify/onboarding.routes.ts` — new confirm-routing route
- `apps/api/test/shopify-onboarding.test.ts` — new tests for confirm-routing
- `packages/db/src/schema/shopify.ts` — new settings field
- `apps/shopify/src/types.ts` — new settings field (frontend mirror)

## Testing & verification

- `POST /v1/shopify/onboarding/confirm-routing` gets a real integration test,
  mirroring the existing `confirm-theme-block` describe block (sets the flag,
  idempotent on repeat calls) in `shopify-onboarding.test.ts`.
- `getOnboardingStep` is a pure function with no I/O — real TDD unit tests in
  `onboarding.test.ts`, matching how `activationTabState.test.ts` and
  `analyticsRange.test.ts` already test other pure `lib/` helpers in this app.
  Covers: fresh install → `'intro'`; products done only → `'routing'`; all
  three done → `null`; each individual step done/not-done combination.
- Page/route components and the nav-menu change: this app has no
  component-render test harness (established in the prior "Customize the
  button" task and still true) — verified via `typecheck`/`lint`/`build` plus
  manual reasoning through the redirect matrix: fresh install lands on intro;
  a mid-progress reload resumes at the correct step; manually navigating
  forward/backward in the URL bar bounces to the correct step; nav menu is
  absent until `onboardingComplete`; completing the last step lands on `/`.

## Out of scope

- No changes to the real Manage/Routing pages' own functionality — this only
  reuses `RuleEditorModal` from `RoutingPage.tsx` as-is.
- No "skip onboarding" escape hatch — this is a hard gate by design (see
  brainstorming Q&A).
- No changes to how `themeBlockConfirmed` or activation mode are computed —
  only where their corresponding UI lives.
