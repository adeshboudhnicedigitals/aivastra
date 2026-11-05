# Merchant analytics dashboard — design

Date: 2026-11-05
Status: Approved; implemented on feat/merchant-analytics (uncommitted)

## Purpose

Merchants who run the `virtual_tryon_android` kiosk have no view of what their
customers try on. This adds an Analytics page to the merchant web dashboard
(`apps/catalogues-web`) showing try-on volume, popular garments and products,
and (in step 2) customer data. Design source: the "Ai Vastra Analytics -
Desktop" canvas (Overview cards, category donut, Top 10 products, Customer
Data table). The canvas is drawn at 1440px; **we build for 1920px** and the
layout must scale down to ~1280px without horizontal scroll.

## Scope

Two steps, each its own plan and release.

**Step 1 (this spec): product and try-on analytics.** No new tables, no
kiosk release.

**Step 2 (separate spec): customer data.** Optional phone capture on the
kiosk, a `merchant_customers` table, the Customers block switched on. Listed
here only so step 1 leaves a clean slot for it.

Out of scope: per-job drill-down, CSV export, per-device breakdown (jobs carry
`merchant_id`, not a device id — same as `tryon/history`), WordPress and
Shopify merchants (Shopify has its own Analytics page).

## What is shown in step 1

| Design element | Source |
|---|---|
| Total Virtual Try-Ons + "% vs previous 30 days" | count of merchant jobs in range vs the equal-length range before it |
| Most Tried Garment (type) | jobs grouped by garment type |
| Most Tried Dress / Least Tried Product | jobs grouped by catalog item, ranked by count |
| Most Tried Garment Category (donut) | jobs grouped by category, with percentage share |
| Top 10 Popular Products | same grouping as above, top 10 |
| Total Customers, Phone Numbers Collected, Repeat/New, Avg Try-Ons, table | **not available** — rendered as a "Coming soon" state until step 2 |

Only `COMPLETED` jobs count as try-ons. A failed or cancelled job was
refunded and the customer never saw a result, so counting it would inflate
popularity.

## Data

### The gap

`jobs` rows for merchant try-ons do not record which catalog item was tried.
`createMerchantTryonJob` writes only `workflowTemplateId` and
`dispatchTemplateVersion` into `job_inputs.params`. Only the two-step saree
path records `merchantCatalogItemId`. Without it, per-product ranking is
impossible.

### The fix

Add `merchantCatalogItemId` to `job_inputs.params` in **both** merchant
try-on paths (`createMerchantTryonJob` and the existing two-step one), written
from `tryon.routes.ts`, which already has the id in hand. Demo items assigned
by an admin share the id namespace, so the id is recorded for them too and
resolved to a label from whichever table owns it.

Jobs created before this ships have no item id. They still count toward
**Total Try-Ons** and its period comparison (those need no item) but are
excluded from every product, category and garment ranking. The page shows
a small note: "Product breakdown covers try-ons since {date}", where the date
is the merchant's earliest job that has the id. No backfill: it cannot be done
without guessing.

### Aggregation

All queries filter `jobs.merchant_id = :merchantId` first; the existing
`jobs_merchant_created_idx (merchant_id, created_at)` serves the range scan.
Item id is extracted from `job_inputs.params->>'merchantCatalogItemId'` after
the jobs are narrowed, the same pattern `shopify/analytics.ts` uses for
`shopifyProductId` (no expression index needed). Item labels, subcategory and
category are then fetched only for the ids that appear in range.

Ranking ties break on label ascending so results are stable between loads.
"Least tried" ranks only items that had at least one try-on in range;
an untried item would otherwise always win and say nothing useful.

## API

`GET /v1/merchant/analytics?range=7d|30d|90d` (default `30d`)

- `preHandler: app.requireMerchant`; merchant id is `req.merchantClientId`,
  never read from the query. This is the tenant boundary.
- Query validated with Zod in `@aivastra/types` (`MerchantAnalyticsQuery`,
  response schema alongside), per repo convention.
- Range boundaries use UTC dates, matching `tryon/history`.
- Response (all counts are integers):

```
{
  range: { from, to, previousFrom },
  totalTryOns, previousTryOns,
  breakdownSince: ISO date | null,
  topGarmentType: { name, tryOns } | null,
  mostTriedProduct: { name, tryOns } | null,
  leastTriedProduct: { name, tryOns } | null,
  categories: [{ name, tryOns, pct }],
  topProducts: [{ rank, itemId, name, tryOns }]   // max 10
}
```

`null` fields mean "no data in range", which the UI renders as an empty
state rather than zeros. Categories are capped at the top 6 with the rest
folded into "Other" so the donut stays readable. `pct` is computed on the
server so the legend and donut cannot disagree.

New module file `apps/api/src/modules/merchant/analytics.ts` (pure queries,
takes `db`) plus `analytics.routes.ts`, registered in `server.ts` beside the
other merchant routes. The pure/route split mirrors `shopify/analytics.ts` and
lets the queries be tested directly.

## Web page

- Route `apps/catalogues-web/src/app/(app)/analytics/page.tsx`, inside the
  protected `(app)` group; add a nav entry where the other merchant pages are
  linked.
- Styling uses the `C` tokens from `src/components/tokens.ts`; no raw hex.
  Range picker uses `PremiumSelect` (never a raw `<select>`).
- Layout at 1920: content max-width ~1680px centered, Overview as a row of
  cards (design order), donut and legend side by side, Top 10 as a ranked
  list. Below ~1280px cards wrap two-up. Verified at 1920, 1440 and 1280.
- Donut is inline SVG (no chart dependency added for one chart).
- States: loading skeleton, empty ("No try-ons yet" with a pointer to the
  kiosk app), error with retry. The Customers block renders the design's
  card shapes in a muted "Coming soon" state.
- Data fetched through `src/lib/api.ts`; the change vs previous period shows
  as `+18%` / `-4%`, and "New" (no baseline) when `previousTryOns` is 0
  instead of dividing by zero.

## Privacy

Step 1 stores and shows no personal data: item ids and counts only. Phone
numbers (step 2) are PII and need consent text, a retention rule and erasure
handling; that belongs in the step 2 spec.

## Testing

- Integration test for the route (`apps/api/test/integration`, run with the
  integration config):
  - **tenant isolation**: merchant B's jobs never appear in merchant A's
    response;
  - previous-period math, including the zero-baseline case;
  - only `COMPLETED` jobs counted; legacy jobs without an item id counted in
    totals but absent from rankings; `breakdownSince` correct;
  - ties, "Other" folding, top-10 cap, empty range returns nulls.
- Unit test that both try-on creation paths write `merchantCatalogItemId`.
- Web: render test for the empty, loaded and error states; manual check at
  the three widths above.

## Risks

- Product ranking starts empty for existing merchants and fills as new
  try-ons arrive. The "since" note sets that expectation honestly.
- `params->>` extraction scans the narrowed job set; fine at current volume,
  and if a single merchant's range grows large the fix is a column, not a
  cache. Not built now.

## Implementation notes (deviations from the text above)

- "Least tried" is `null` when fewer than two products ranked, so one product is never both most and least tried.
- Items deleted after a try-on no longer resolve and are left out of every breakdown (still counted in totals). Non-UUID values in `params` are ignored.
- Ranges are rolling windows (`now - N days`), not UTC calendar-date boundaries.
- `breakdownSince` is computed only over single-step jobs. The two-step saree path already recorded the item id before this feature, so including it would make the "since" date wrong.
- When try-ons exist but no product breakdown does, the page shows one "Product breakdown starts with new try-ons" card instead of empty panels.
- The Customers block is a single muted "coming soon" card, not the design's card shapes.
- No web render test: `apps/catalogues-web` has no test runner. Verified by typecheck and lint only; the browser pass at 1920/1440/1280 has not been run.
