# Shopify Onboarding — Product Selection and Basket Assignment — Design

**Date:** 2026-09-25
**Branch:** `fix/routing-conditions-wrap-and-dev-reconciler-guard`
**Amends:** `2026-09-24-shopify-mandatory-onboarding-design.md`. That spec's
Products page ("Sync your products", auto global mode) and Routing page
("Add a rule", optional) are replaced by the two-stage page described here.
The Intro page, Theme page, gating mechanism, and resume behaviour are unchanged.

## Motivation

Onboarding today enables try-on for a store's whole catalogue in one click: the
first sync also switches the store to global activation mode. The merchant never
chooses which products get try-on, and routing is a separate optional page that
most merchants skip.

Since the default basket was removed
(`2026-09-15-shopify-manage-routing-merge-design.md`), a product with no pin and
no matching rule is *unrouted* and refuses try-on. Choosing a basket is therefore
no longer optional polish — an enabled product without one simply doesn't work.

Page 2 of the wizard becomes two stages: pick the products, then pick their
baskets.

## Confirmed decisions

- **The Routing page is removed.** The wizard becomes Intro → Page 2 → Theme.
  Rules remain available later under Manage.
- **Basket assignment is "one basket for all, overridable per product":** an
  "Apply to all" control plus a per-row dropdown. Assigning by filter group
  (e.g. type = Saree → saree basket) is out of scope.
- **Filters:** title search, product type, vendor, tags, collection, status, and
  Shopify's product **category** (the standard taxonomy, not the free-text
  product type).
- **Persistence:** a new bulk endpoint (approach B in the design discussion).
  Rejected: looping the existing per-product `PATCH` from the client (N requests,
  partial failure, no "select all matching"), and driving activation through
  collections/rules (cannot express a hand-picked set).

## Flow and completion

No new settings flag. Both new completion signals are derived from live data.

```
Intro  →  Page 2, stage 1: Select products  →  Page 2, stage 2: Choose baskets  →  Theme
```

`apps/shopify/src/lib/onboarding.ts`:

- `OnboardingStep` becomes `'intro' | 'products' | 'theme'`. `'products'` covers
  both stages of page 2.
- **selectionDone** — the store has synced products and at least one is enabled:
  `syncedProductCount > 0 && (activation.mode === 'global' || enabledProductCount + (unroutedEnabledCount ?? 0) > 0)`.
- **basketsDone** — `selectionDone`, no enabled product is unrouted
  (`(unroutedEnabledCount ?? 0) === 0`), and `enabledProductCount > 0`.
- **themeDone** — `themeBlockConfirmed`, unchanged.
- `getOnboardingStep`: `'intro'` when nothing has started (no synced products and
  the theme block not confirmed); otherwise `'products'` until `basketsDone`,
  then `'theme'` until `themeDone`, then `null`.
- `getOnboardingProgress` keeps the formula `(1 + completed) / 4`, where
  `completed` now counts `[selectionDone, basketsDone, themeDone]`. It reads
  25% → 50% → 75% → 100%, and the bar advances when stage 1 finishes, not only
  when the whole page does.
- `onboardingRoutingConfirmed` is no longer read by the wizard. The
  `POST /v1/shopify/onboarding/confirm-routing` route and the settings field stay
  in place (unused) so nothing breaks; removing them is a separate cleanup.

**Backwards compatibility.** A store that had already confirmed routing but has
unrouted enabled products now derives `basketsDone = false`. That is correct —
those products don't offer try-on — and stores that have completed onboarding
once are already exempt from the gate (`onboardingCompletedOnce`, see
`App.tsx`), so no established merchant is pushed back into the wizard.

## Backend

### Product list: filters and richer rows

`GET /v1/shopify/products` (`apps/api/src/modules/shopify/products.routes.ts`)
gains query filters next to the existing `q`, `enabled`, `excluded`, `status`:

| Param | Matches |
|---|---|
| `productType` | `product_type` equals any given value |
| `vendor` | `vendor` equals any given value |
| `tag` | `tags` overlaps the given values |
| `collection` | `collections` overlaps the given values |
| `category` | `category` equals any given value |

Multiple values within one filter are OR; different filters are AND. The filter
conditions move into one shared builder, `buildProductFilter(storeId, query)`,
used by both the list route and the bulk route so "select all matching" always
means exactly what the list showed.

Each returned item additionally carries `productType`, `vendor`, `tags`,
`collections` and `category` (the columns are already selected by the query
except `category`).

**Collection filter caveat.** It matches `shopify_product_garments.collections`,
a list of collection *titles* capped at 25 per product and only as fresh as the
last sync (`products.sync.ts` documents the cap). It is the only column that
covers every collection; `shopify_collection_products` is populated only for
collections already enabled or excluded.

### Filter facets

`GET /v1/shopify/products/facets` returns the distinct values that populate the
filter dropdowns, scoped to the calling store and excluding deleted products:

```json
{ "productTypes": { "values": [], "truncated": false }, "vendors": { "values": [], "truncated": false }, "tags": { "values": [], "truncated": false }, "collections": { "values": [], "truncated": false }, "categories": { "values": [], "truncated": false } }
```

Each list is sorted and capped at 200 values; each list carries its own
`truncated` flag saying when the cap cut it off, so the UI can fall back to text
search. `categories` is
empty until a sync has populated the column.

### Bulk update

`POST /v1/shopify/products/bulk` (`requireShopifySession`):

```ts
{
  target:
    | { ids: number[] }                                   // max 5000
    | { filter: ProductFilter; excludeIds?: number[] },   // same shape as the list query
  enabled?: true,
  funnelTemplateId?: string /* uuid */ | null,
}
```

At least one of `enabled` / `funnelTemplateId` is required.

- Runs as **one Postgres transaction** with a single scoped `UPDATE`, always
  constrained to the caller's `store_id`. Ids belonging to other stores match
  nothing.
- `enabled: true` updates only products whose `status = 'active'` and
  `excluded = false`. Everything else in the target is counted as skipped, with a
  reason (`not_active`, `excluded`), rather than failing the call — mirroring the
  single-product rule that an inactive product cannot be enabled
  (`products.routes.ts`).
- `funnelTemplateId` must reference an **active** basket
  (`shopify_funnel_templates.is_active`), otherwise `404 basket not found` — the
  same response the single-product `PATCH` gives. A uuid sets
  `funnel_assignment_source = 'manual'`; `null` clears the pin and the source.
  Both match the single-product `PATCH`, so the two paths can't disagree about how
  a pin was made.
- Response: `{ updated: number, skipped: { notActive: number, excluded: number } }`.
- Only enabling is supported, not disabling — the wizard never needs to disable,
  and Manage already handles that per product.

### Category column

- `packages/db/src/schema/shopify.ts` — add `category: text('category')`
  (nullable) to `shopifyProductGarments`, storing Shopify's `fullName` (e.g.
  `Apparel & Accessories > Clothing > Dresses`).
- **Migration** — generated locally with `pnpm db:generate` and shipped through
  push → CI → `db:migrate:prod`. Never generated or applied against production
  (see CLAUDE.md, "Production safety"). Adding a nullable column is
  backwards-compatible with the currently deployed API.
- **Sync** — `PRODUCT_FIELDS` in `products.sync.ts` adds
  `category { fullName }`, and `toShopifyProduct` / the upsert map it to the new
  column. The store's Admin API version (`2026-07`) exposes this field and the
  existing `read_products` scope covers it.
- **Backfill** — none. Existing rows get a category on their next sync.
  Consequently the category filter is hidden while the facet list is empty, and
  page 2 runs a sync on entry when nothing is synced yet.

### `/me`

`GET /v1/shopify/me` (`me.routes.ts`) already computes
`countUnroutedProducts` when any product is enabled. It additionally returns
`stats.unroutedEnabledCount: number | null` (`null` when the routing scan is
omitted above `COUNTS_PRODUCT_CAP`, which the client treats as 0). No extra
query cost — the value is already in hand there.
`apps/shopify/src/types.ts` mirrors the field.

### Wizard sync

The wizard's sync call stops switching the store to global mode. Merchants who
never had a wizard sync are unaffected; global mode remains available in Manage.

## Frontend — page 2

`OnboardingProductsPage.tsx`, inside `OnboardingShell` so the footer (progress
bar and Continue) is unchanged. Following CLAUDE.md, dropdowns use Polaris
`Select`, never a raw `<select>`.

**Which stage shows.** The stage is derived entirely from `/me` data
(`selectionDone` → baskets stage), so a reload lands on the right stage with no
URL state. There is no Back control between the stages — the
selection is committed when the merchant leaves stage 1, and adjusting it
afterwards happens in Manage.

**Entry.** If `syncedProductCount === 0`, the page shows a spinner and runs
`POST /v1/shopify/products/sync`, then refreshes `me`. A failure shows the shared
`ErrorBanner` with a retry.

### Stage 1 — Select products

- Polaris `Filters` bar: title search, plus filters for product type, vendor,
  tags, collection, category and status, populated from the facets endpoint.
  Applied filters show as removable chips.
- Polaris `IndexTable` with a checkbox per row: thumbnail, title, type, vendor,
  status. Server-side pagination (page size 20).
- Polaris's select-all pattern: selecting every row on the page offers "Select all
  N matching". That switches the selection to `{ filter, excludeIds: [] }`;
  unchecking a row afterwards adds it to `excludeIds` instead of dropping the
  selection, so a partly-deselected "all matching" stays correct across pages.
  A plain selection sends `{ ids }`.
- Footer Continue is disabled until at least one product is selected. On click it
  calls the bulk endpoint with `enabled: true`, then refreshes `me` and moves to
  stage 2. If the response reports skips, the banner says how many were skipped and
  why. A failed call keeps the merchant on stage 1.

### Stage 2 — Choose baskets

- Lists the store's enabled, non-excluded products (`enabled=true&excluded=false`),
  paginated.
- Top control: a basket `Select` plus an **Apply to all** button, worded to say it
  applies to all N enabled products and replaces any basket they already have.
  It calls the bulk endpoint with `target.filter = { enabled: true, excluded: false }`
  and `funnelTemplateId`.
- Each row has its own basket `Select` (value = the resolved basket, placeholder
  "Choose a basket" when unrouted). Changing it saves immediately through the
  existing `PATCH /v1/shopify/products/:id`, with a per-row busy state so one row's
  save doesn't disable the table — the same approach as Manage's Individual
  Products tab.
- Footer Continue is disabled until `basketsDone` (nothing unrouted), then goes to
  `/onboarding/theme`. After each save the page refreshes `me`, which recomputes
  `unroutedEnabledCount`.

### Removals and redirects

- `OnboardingRoutingPage.tsx` is deleted. `App.tsx` maps `/onboarding/routing` to a
  redirect to `/onboarding/products` for bookmarks. The `RuleEditorModal` export
  in `RoutingPage.tsx` keeps its other users.
- `onboardingPath` drops the `routing` step.

## Error handling

- Every API failure goes through `classifyError` and the shared `ErrorBanner`,
  as elsewhere in the wizard. No silent toasts.
- Bulk calls are atomic: on failure nothing changed, so retry is always safe. The
  operation is idempotent — repeating it yields the same end state.
- A stale filter (a facet value that no longer exists) simply returns no rows.

## Testing

- **API integration tests** (`apps/api/test/integration`, run with
  `pnpm --filter @aivastra/api test:integration`, Docker up): each filter and
  filter combination; facets scoping to the calling store and excluding deleted
  rows; bulk by ids and by filter, including `excludeIds`; skip counting for
  inactive and excluded products; rejection (404) of an inactive or unknown basket; and
  isolation — ids and filters can never touch another store's rows.
- **Sync test** — the category is written from the GraphQL node and tolerates a
  null category.
- **Unit tests** (`apps/shopify`, Vitest): `getOnboardingStep` and
  `getOnboardingProgress` across the new derivation, including global mode, the
  omitted-counts case (`unroutedEnabledCount: null`), and a legacy store with
  `onboardingRoutingConfirmed` set. The existing routing-step cases are updated
  or removed.
- **Manual check in a dev store** — the embedded app only renders inside the
  Shopify admin iframe, so the page-2 layout and the footer at real window sizes
  need a browser pass.

## Risks and deferred work

- **Apply to all overwrites pins** on the products it covers. Harmless for a fresh
  store; the button copy says so.
- **Category and the collection filter are stale until re-sync**, as described above.
- **Large catalogues.** Above `COUNTS_PRODUCT_CAP` (10,000 products) the unrouted
  count is omitted, so stage 2's Continue relies on `enabledProductCount > 0`
  rather than an exact unrouted count.
- **Deferred:** assigning baskets by filter group, a Back control between stages,
  and removing the unused `confirm-routing` route and `onboardingRoutingConfirmed`
  field.
