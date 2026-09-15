# Shopify Manage + Routing Merge, and Removing the Default Basket — Design

## Problem

`apps/shopify` (the embedded merchant admin) has two separate pages that a
merchant must both visit to fully configure Try-On for a product:

- **Manage** (`/manage`) — turns Try-On on/off per product, via collections,
  individual products, or a global "everything" mode, plus exclusions.
- **Routing** (`/routing`) — decides *which basket* (workflow/style) an
  eligible product uses, via the merchant's own condition-based rules and
  Aivastra's global rules.

These are two facets of one merchant task ("get this product offering
Try-On, correctly"), split across two pages, two nav entries, and two "Sync
products" buttons. `ManagePage`'s Individual Products tab already lets a
merchant pin one product to a basket inline — that overlap is the clearest
sign the split doesn't match how merchants think about the task.

Separately, basket resolution
(`apps/api/src/modules/shopify/funnel-resolution.ts`) has a catch-all
**default basket**: one `shopify_funnel_templates` row an admin marks
`isDefault`, silently used for any product that matches no pin and no rule.
This is being removed — routing becomes fully explicit (manual pin, or a
matching rule), never a silent admin-wide fallback.

## Confirmed decisions

- **Remove only the default basket, not global rules.** Aivastra's
  condition-based global rules (`shopify_funnel_rules` with `storeId IS
  NULL`) stay exactly as they are — they still auto-route a product that
  matches a known pattern. What goes away is the *unconditional* catch-all:
  the single admin-designated basket every unmatched product silently fell
  into. New precedence: manual pin → store's own rules → Aivastra global
  rules → **unrouted** (try-on refused, same refusal path that already
  exists for a fully-unconfigured product today).
- **Hard cutover, no backfill migration.** No script reproduces today's
  default-basket assignments as explicit rules before the fallback is
  removed. Any store currently relying on the default for some products will
  see those products stop offering Try-On the moment this ships, with no
  advance warning banner and no grace period. Accepted tradeoff for shipping
  simplicity over migration safety.
- **Enforcement is "warn but allow," not a hard gate.** Enabling a product or
  collection in Manage never blocks on whether it resolves to a basket. The
  merged page instead surfaces the existing `unrouted` count
  (`/v1/shopify/funnel-rules` already computes this — every synced,
  non-deleted product with no resolvable basket) as a persistent banner. No
  new resolution logic needed for this; it's already computed server-side,
  just not currently surfaced outside the Routing page.
- **One merged page, two tabs, reusing today's page components almost
  unchanged.** Rejected a single unified product-table (deepest merge of the
  mental model, but needs a new bulk per-product basket-resolution endpoint —
  today's individual-basket display only covers individually-pinned
  products) and a single long scrolling page (loses the compactness tabs
  give today) in favor of keeping `ManagePage`'s and `RoutingPage`'s existing
  internals intact as two tab panes under one parent. Lowest risk, reuses
  the most code, and still solves the actual complaint (duplicate nav entry,
  duplicate Sync button, no shared view of eligibility + routing).

## Design

### 1. Backend — remove the default basket

**`apps/api/src/modules/shopify/funnel-resolution.ts`**
- `BasketRuleSet.defaultBasketId` field removed.
- `loadRuleSet` stops selecting/tracking `isDefault`.
- `resolveBasketFrom`'s final fallback block (the `const fallback =
  activeBasket(ruleSet, ruleSet.defaultBasketId); return fallback ? ... :
  null;`) is deleted — the loop over `storeRules`/`globalRules` falling
  through to `return null` is the new end of the function.
- `BasketSource` narrows from `'manual' | 'rule' | 'default'` to `'manual' |
  'rule'`. `source` is computed fresh on every read (`products.routes.ts`'s
  product-list response is its only consumer) and never persisted to a
  table or event payload, so there's no historical `'default'` data to
  account for — the variant can simply be deleted, along with
  `BASKET_SOURCE_LABEL`/`BASKET_SOURCE_TONE`'s `'default'` entries in
  `apps/shopify/src/pages/ManagePage.tsx`.

**`packages/db/src/schema/shopify.ts`**
- Drop `isDefault` from `shopifyFunnelTemplates`. New Drizzle migration via
  `pnpm db:generate` + `pnpm db:migrate` (local/staging only, shipped to prod
  through the normal push → CI/CD → `db:migrate:prod` path — never hand-run
  against `tryon_prod`).

**`apps/api/src/modules/admin/shopify-funnels.routes.ts`**
- Remove `isDefault` from the create/patch request schemas and from the list
  response shape.
- Remove `hasDefault` from the list response.
- Remove the `PATCH .../:id` branch that flips `isDefault` (today's
  `makeDefault` handler's server side).

**`apps/admin-web/src/pages/ShopifyFunnelsPage.tsx`**
- Remove the "Default" table column and its "Set default" button
  (`makeDefault`, `togglingId` usage tied to it).
- Remove the `!hasDefault` warning banner ("Every Shopify try-on is refused
  until one template here is set as the default").
- Global rules card is untouched.

**Tests to update** (all reference `isDefault` today and need their
default-basket setup/assertions removed or rewritten to expect refusal
instead of a default-routed result):
`apps/api/test/shopify-funnel-templates-admin.test.ts`,
`apps/api/test/integration/shopify-limits.test.ts`,
`apps/api/test/integration/shopify-merchant-funnel-rules.test.ts`,
`apps/api/test/integration/shopify-customer.test.ts`,
`apps/api/test/integration/shopify-funnel-loader.test.ts`,
`apps/api/test/integration/shopify-basket-routing.test.ts`,
`apps/api/test/shopify-refusal-events.test.ts`.

### 2. Frontend — merge Manage + Routing

**Routing** (`apps/shopify/src/App.tsx`)
- `/manage` keeps its existing route (it's already the canonical URL —
  `/products` redirects here) and now renders a page with two tabs.
- `/routing` becomes a `<Navigate to="/manage" replace />`, following the
  same pattern as the existing `/widget-design` and `/products` redirects,
  for merchants with it bookmarked or pinned in Shopify admin's nav history.

**Nav** (`apps/shopify/src/components/AppNavMenu.tsx`)
- `NAV_ITEMS` loses the separate `{ path: '/routing', label: 'Routing',
  icon: AutomationIcon }` entry. `/manage`'s entry stays as-is (label
  "Manage", `ProductIcon`).

**Page structure** — `ManagePage.tsx` becomes the container:
- Everything above the tabs stays: the activation-mode `Checkbox` card, the
  4-card stats `InlineGrid`, `ContextualSaveBar` for eligibility changes.
- New: an `unrouted`-count banner in the shared header area, visible under
  either tab (see §3).
- The existing eligibility `Tabs` (Collections / Individual Products /
  Exclusion) becomes the content of a new outer tab, **"Eligibility."**
- A second outer tab, **"Routing,"** renders `RoutingPage`'s content
  (minus its own `Page`/header chrome, minus its own redundant "Sync
  products" button — the outer page's Sync button covers both tabs) as a
  plain component. Rename its "Default rules (from AiVastra)" card heading
  to **"Global rules (from AiVastra)"** — "default" is no longer a concept
  in this system, and "global" is already the term admin's own UI
  (`ShopifyFunnelsPage.tsx`) uses for the same rules.
- `RoutingPage.tsx` and its internals (`RuleEditorModal`, condition editor,
  rule tables, the "Where your products land" summary) are otherwise
  unchanged — it stops being routed directly and becomes a component the
  merged page renders inside its second tab.
- Outer tab switching is plain local `useState`, independent of
  `ManagePage`'s existing inner `Tabs` state (`selectedTab` for
  Collections/Individual/Exclusion) — no interaction between the two tab
  levels beyond both being visible under the same page.

**Save-bar scope stays exactly as today.** `RoutingPage`'s actions (rule
create/edit/delete, global-rule toggle) remain immediate/unstaged — they are
not folded into `ManagePage`'s `ContextualSaveBar`/draft-list system. The two
tabs keep their existing, different save models; only the page chrome around
them merges.

### 3. "Warn but allow" banner

`/v1/shopify/funnel-rules`'s response already includes `unrouted: number |
null` (null when `countsOmitted`, i.e. catalog too large to scan) — this is
computed once per page load today by `RoutingPage`'s own `load()`. The
merged page hoists that same fetch to the container level (`ManagePage`) so
both tabs and the shared banner read from one `rules` state, avoiding a
duplicate fetch when the merchant is on the Eligibility tab.

Banner copy, shown whenever `rules !== null && unrouted !== null && unrouted
> 0`, in the shared header area above the tabs:

> "**N products have no basket assigned** — Try-On won't work for them until
> you add a routing rule or pin them individually. [View routing →]" (jumps
> to the Routing tab)

Suppressed when `unrouted === null` (`countsOmitted`) or `unrouted === 0`.
No new backend endpoint or computation — purely surfacing an existing number
in a new place.

## Out of scope

- No change to `resolveBasketFrom`'s manual-pin-falls-through-to-rule
  behavior (an admin-deactivated pinned basket already falls through rather
  than refusing — untouched).
- No change to how individually-pinned products display their basket in
  Manage's Individual Products tab.
- No backfill/migration tooling for stores currently relying on the default
  basket (explicitly rejected above).
- No hard save-time gate blocking enablement of unrouted products (explicitly
  rejected above — warn but allow).
- Admin's basket (funnel-template) CRUD itself — create/edit/delete/move/
  reassign — is unchanged beyond removing the `isDefault` field.
