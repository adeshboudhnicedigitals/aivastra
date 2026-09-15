# Shopify Funnel Rule "Product Title" Condition — Design

**Goal:** add `title` as a fifth selectable field for Shopify funnel-rule
conditions, alongside the existing `product_type`, `tags`, `vendor`,
`collections`, usable identically in both merchant store rules and
admin-authored global rules.

## Background

A funnel rule (`shopify_funnel_rules.conditions`, type
`FunnelRuleCondition[]`) is a list of `{ field, operator, value }` triples.
`resolveBasketFrom` (`apps/api/src/modules/shopify/funnel-resolution.ts`)
matches a product against a rule's conditions to decide which basket
(workflow template) a try-on request uses. Today `field` is one of
`'product_type' | 'tags' | 'vendor' | 'collections'`, and both text fields
(`product_type`, `vendor`) and list fields (`tags`, `collections`) route
through two small generic helpers, `matchesText` and `matchesList`, that
compare case-insensitively with `equals`/`contains` operators.

`shopify_product_garments.title` (the synced Shopify product title) already
exists as a column and is already populated by product sync for every store
— it's just never been a matchable condition field.

## Approach

`title` is a plain string field, structurally identical to `vendor`. It
needs no new operator and no new matching logic — it reuses
`matchesText(target.title, operator, needle)` exactly as `vendor` does today.
A bespoke title matcher (fuzzy/prefix matching, etc.) was considered and
rejected: there's no stated need for it, and it would be new, untested
matching behavior for no benefit over the existing `contains` operator.

Both operators (`is` / `contains`) are supported, matching how every other
field works — no field-conditional branching in the operator dropdown.

In the field picker, `Product title` is listed **first**, ahead of `Product
type`. The other four keep their relative order.

## Sites that change

The 4-field union (`'product_type' | 'tags' | 'vendor' | 'collections'`) is
hardcoded in six places (found via `Grep`, not inferred). Each needs the
literal `'title'` added; item 4 also needs a query change:

1. **`packages/db/src/schema/shopify.ts:82-86`** — `FunnelRuleCondition.field`
   union gains `'title'`.
2. **`apps/api/src/modules/shopify/funnel-resolution.ts`** —
   `BasketMatchTarget` (lines 8-14) gains `title: string | null`;
   `matchesCondition`'s switch (lines 79-90) gains
   `case 'title': return matchesText(target.title, condition.operator, needle);`
3. **`apps/api/src/modules/shopify/funnel-rules.routes.ts:15`** (merchant-facing
   Zod `Condition.field` enum) gains `'title'`.
4. **`apps/api/src/modules/shopify/funnel-rules.routes.ts:132-138`** (the counts
   query that powers `unrouted`/`unroutedEnabled`) — **must add
   `title: schema.shopifyProductGarments.title` to its `select`**. This is the
   one call site that doesn't already select `title`; `products.routes.ts`
   and `customer.routes.ts` already select it (for display), so their rows
   cast to `BasketMatchTarget` already carry it with no change needed there.
5. **`apps/api/src/modules/admin/shopify-funnel-rules.routes.ts:10`**
   (admin-facing Zod `Condition.field` enum, used when an admin creates a
   global rule) gains `'title'`.
6. **`apps/shopify/src/pages/RoutingPage.tsx`** — `Condition['field']` union
   (line 23), `FIELD_LABEL` (lines 56-61) gains `title: 'Product title'`
   positioned first, `FIELD_OPTIONS` (lines 63-66) reorders accordingly.
   `emptyCondition()` (line 93-95) is unchanged — new conditions still default
   to `product_type`.
7. **`apps/admin-web/src/pages/ShopifyFunnelsPage.tsx`** — same shape of
   change as #6, for the admin-authored global-rule editor.

No database migration: `conditions` is untyped `jsonb`, so the field union
only exists in TypeScript/Zod, not in the schema itself.

## Data

`shopify_product_garments.title` is already populated by product sync for
every store today. There is no backfill: every already-synced product is
immediately matchable on title as soon as this ships, with zero sync-side
work.

## Testing

- `apps/api/test/shopify-funnel-resolution.test.ts` — add a `title` case to
  the existing `matchesCondition`/`resolveBasketFrom` coverage (both
  operators, case-insensitivity, matching the existing `vendor` test shape).
- The integration test covering `funnel-rules.routes.ts`'s counts endpoint
  gets a title-condition case, specifically to guard site #4's select-list
  change — a regression here would silently break the counts query (title
  would read as `undefined`, so a `title` condition would ineffectually never
  match) without any type error, since the cast to `BasketMatchTarget` at
  that call site hides the missing field from the compiler.

## Out of scope

- No new operators (no `not_equals`/`not_contains`/`starts_with`).
- No changes to `product_type`, `tags`, `vendor`, or `collections` matching.
- No changes to the free-text product search (`funnel-rules` unrelated `q`
  param in `products.routes.ts`) — that already searches title via `ilike`
  and is a different feature (product list search, not rule conditions).
