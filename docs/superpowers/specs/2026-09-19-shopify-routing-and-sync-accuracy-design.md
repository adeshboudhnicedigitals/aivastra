# Shopify: routing-aware enablement + hardened full-sync accuracy

Status: proposed, not yet implemented. Written against `origin/dev` as of this
commit (PR #384 and #386 already merged into it — see "Already fixed upstream"
below for what that changed).

## Context

Two separate lines of investigation on the Shopify Manage page converged on
the same root cause: **"effectively enabled for Try-On" and "resolves to a
basket" are two independent gates, and three surfaces only check the first
one.** Separately, hardening the "Sync products" button's accuracy surfaced a
real (if narrow) race in how the full sync reconciles deletions.

## Finding 1 — storefront button and two enabled-counts ignore routing

`computeEffectiveEnabled` (activation mode, collections, exclusions) and
`resolveBasketFrom` (manual pin → store rule → global rule) are both required
for a Try-On attempt to actually succeed
(`apps/api/src/modules/shopify/customer.routes.ts` try-on creation path checks
both, in that order, before enqueueing). But three places only check the
first:

1. **`GET /v1/shopify/customer/products/:id/enabled`**
   (`customer.routes.ts`) — what `tryon-widget.js` polls on page load to
   un-hide the storefront button. A synced, "enabled" product with no
   resolvable basket still gets `enabled: true`; the button shows, and the
   customer's attempt dead-ends at submission with "not available for try-on
   right now."
2. **ManagePage "Try-On Enabled" stat** (`counts.tryonEnabledProducts`,
   `apps/api/src/modules/shopify/activation.routes.ts`'s `summaryCounts`,
   backed by `countEffectivelyEnabled` in `activation.ts`) — overcounts by
   the same margin.
3. **DashboardPage "Try-On Enabled" stat** (`me.stats.enabledProductCount`) —
   backed by `computeEnabledProductCount` in `me.routes.ts`, a **second,
   independently-duplicated** implementation of the same SQL as
   `countEffectivelyEnabled`, with the identical gap.

### Fix

- Extract the per-product routing loop already living in
  `funnel-rules.routes.ts` (it already computes `unroutedEnabled` for the
  Routing tab's summary) into a shared helper in `funnel-resolution.ts`.
  `funnel-rules.routes.ts` switches to calling it instead of inlining the
  loop — this also resolves the pre-existing duplication the user flagged
  ("we have duplicate code as well, migrate that to helper").
- Leave `countEffectivelyEnabled` (activation.ts) untouched — it has its own
  integration test asserting bit-for-bit parity with `computeEffectiveEnabled`,
  and there's no reason to disturb that guarantee. Instead, at both call sites
  (`activation.routes.ts`, `me.routes.ts`), subtract the shared helper's
  `unroutedEnabledCount` from the existing SQL count.
- In `customer.routes.ts`'s `/enabled` route: once `resolveEffectiveEnabled`
  returns true, if the garment has actually been synced (a row exists),
  additionally require `resolveBasket(...)` to resolve — otherwise flip to
  `enabled: false`. If the product has **never been synced** (no garment
  row), skip the routing check and keep today's behavior: that path already
  re-queues a sync and tells the shopper to check back, rather than promising
  a working button for a product we have no data on yet.
- Catalogs over the existing 10,000-product cap
  (`COUNTS_PRODUCT_CAP` in `funnel-rules.routes.ts`) fall back to the
  uncorrected count, same degradation already used for the Routing tab's
  `countsOmitted`.
- No frontend code changes required — both stat cards already render
  whatever the API returns. Tweak ManagePage's caption under the stat
  ("Enabled individually or via a collection, minus exclusions.") to mention
  routing so the definition stays accurate.

**Alternative considered and rejected:** rewrite `countEffectivelyEnabled`
itself to fold in routing (one unified loop instead of SQL-count-minus-JS-loop).
Rejected because it means retiring/rewriting the purpose-built parity test and
losing the cheap pure-SQL path for stores that don't need routing precision,
for no benefit over subtracting at the call site.

## Finding 2 — full sync's deletion reconciliation can be resurrected by a race

`syncOneTask`'s `full` branch (`apps/api/src/modules/shopify/products.sync.ts`)
pages through the catalog 25 products at a time (throttled 500ms/page), and at
the end calls `reconcileDeletedProducts(app, store.id, liveProductIds)` where
`liveProductIds` is the list accumulated **during** that (possibly
minutes-long) pagination.

The `products/delete` webhook writes directly to Postgres
(`status = 'deleted'`), immediately, outside the sync queue entirely
(`webhook.routes.ts`). If a product is deleted *during* a full sync's run,
*after* the page containing it was already fetched, the full sync's own
per-product `syncProduct()` upsert (which unconditionally writes
`status: 'active'` on success, regardless of the row's current status) will
still run for that product moments later — silently overwriting the webhook's
deletion. Today this only self-corrects on the next hourly `reconcile` tick
(up to ~an hour of a phantom "active" product feeding every count above).

### Fix

Replace the stale in-pass `liveProductIds` reconciliation with a **fresh,
final id-only pagination pass** — reusing the exact `PRODUCT_IDS_PAGE` query
`reconcile` mode already uses (250/page, no images) — run *after* the main
detailed pass completes, and reconcile against that instead. This:

- Keeps the full sync's existing synchronous contract ("when `syncOneTask`
  returns, the DB matches Shopify") — the snapshot it reconciles against is
  just as fresh as `reconcile` mode's own, rather than a possibly-stale one
  collected minutes earlier.
- Additionally self-heals any product id present in that fresh final pass but
  **missed** by the main detailed pass (i.e. created while the sync was
  running) by enqueueing an individual `product`-mode sync for it — the same
  mechanism `reconcile` mode already uses for newly-discovered products.
- Cost: one extra cheap id-only pagination pass per full sync. Small relative
  to the main pass (10x the page size, no image downloads).

**Not fixing** (flagged, not in scope): rapid double-clicks of "Sync products"
enqueue redundant `full` tasks, but `shopify:sync` has a single serial
consumer in this deployment (`docker-compose.prod.yml` runs one `api`
replica, no horizontal scaling), so redundant tasks run back-to-back, not
concurrently — wasteful, not a correctness bug.

## Already fixed upstream (do not re-implement)

`feature/admin-url-routing` (the branch this investigation started on) was
cut before PR #384 merged to `dev`. PR #384 already:

- Added the `products/create` Shopify webhook (`webhook.routes.ts`), handled
  identically to `products/update`.
- Extended `reconcile`-mode sync (`products.sync.ts`) to diff live Shopify
  product ids against every id this store has **any** row for (including
  `deleted` ones, since Shopify never reuses product ids) and fetch full data
  for any id that's genuinely new — not just mark deletions.
- Added a one-off backfill script
  (`apps/api/scripts/backfill-shopify-products-create-webhook.mts`) to
  register the new webhook for already-installed stores.
- Reorganized the Manage/Routing/Settings/Analytics pages (Routing tab now
  precedes Eligibility; "Where your products land" moved from the Routing tab
  onto the main Manage page).

Confirmed via `git show origin/dev:...` against the three files this design
touches (`webhook.routes.ts`, `products.sync.ts`, `customer.routes.ts`,
`activation.routes.ts`) before writing this doc — Finding 2's race and
Finding 1 are both still present on `dev` as described above; nothing here
duplicates PR #384.

## Test impact

- `apps/api/test/shopify-sync.test.ts` — the full-sync pagination test
  asserts exactly 2 GraphQL calls and checks DB state synchronously right
  after `syncOneTask` returns. It needs updating to expect the extra
  id-only pagination calls from the new final reconcile pass.
- `apps/api/test/shopify-activation-routes.test.ts` and
  `apps/api/test/shopify-me.test.ts` — both seed "enabled" products with no
  funnel-rule pin and assert a count that will now exclude them. Update the
  seeds (pin a basket where the test's intent is "activation says enabled")
  and add new cases for "enabled but unrouted → not counted."
- `apps/api/test/integration/shopify-customer.test.ts` — the `/enabled`
  block's "individually enabled" test (product 904) needs a basket pin to
  keep testing what it intends; add a new case for "synced, enabled,
  unrouted → disabled," and confirm the existing "never synced, global mode"
  case still passes unchanged (it should — the routing check only applies
  once a garment row exists).

## Deferred (separate follow-up, not in this design)

A "Not routed" link on the Manage/Routing pages opening a popup listing the
actual unrouted product names/titles. Agreed with the user to revisit this
once the count itself is accurate and the storefront button is correctly
hidden — no point building a browse UI for a number that's about to change.
