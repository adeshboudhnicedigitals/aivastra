# Merchant Insights screen (cart, lost demand, out-of-stock demand, try-on reliability)

**Spec:** `docs/superpowers/specs/2026-11-12-instore-crm-analytics-design.md` §7.2 (Cart and conversion,
Inventory, Operations and cost), §7.3 (role scoping: merchant admin all branches, staff their branch).
**Status:** built locally (T1–T7, T9), uncommitted. Answers: min tries 5, stale 14 days, server OOS event yes. T8 and the branch filter on the page remain.

## Goal

One screen a store owner or buying team acts on: where try-ons stop short of a sale, what is
wanted but not bought, what is wanted but out of stock, and whether the try-on itself is working.
Every number comes from data captured since phases 1–3; **no tablet or schema change** except the
one optional event in Q3.

## What the screen shows

| Section | Metric | Source | Definition |
|---|---|---|---|
| **Funnel** | Sessions → tried → added to cart → billed | `instore_sessions`, `session_items`, `carts`, `cart_lines` | Each step counts **sessions** that reached it, by the session's `started_at` (same rule as the dashboard). Cart = a session with at least one non-removed line; billed = a line with `billed_at` |
| | Cart abandonment | `carts` | Carts with lines that ended `abandoned` ÷ carts with lines that are `billed` or `abandoned`. Carts still `open` (under 24h) are shown as "still open", never counted as abandoned |
| **Lost demand** | Items tried often, rarely bought | `session_items` + `cart_lines` + `merchant_catalog_items` | Per item: tries, cart adds, units sold, try→sale rate. Listed only when tries ≥ a minimum (default 5) so one try never makes a "0% item". Price band from `offer_price_paise` |
| | By size / colour | `cart_lines` → `merchant_catalog_variants` | **Cart adds and sales only.** A try-on records no size (the variant is chosen later), so size and colour demand starts at the cart. Said on screen |
| **Out-of-stock demand** | What shoppers wanted that was out | `analytics_events` `oos_viewed` (device-reported) | Per item × size × branch: how many times the out-of-stock size was viewed. **Advisory**: the tablet says it happened (forgeable by nature, never a money figure). Q3 adds the harder number |
| | Stock staleness | `variant_branch_stock.updated_at` | Branches whose manual stock was last updated more than N days ago (default 14) |
| **Try-on reliability** | Failure rate, wait time | `jobs` (session-attributed) | Failed ÷ finished; wait = `completed_at − created_at`, median and 90th percentile, completed jobs only |
| **Cost** | Credits per try-on, credits per sale | `jobs`, `session_items` | Credits spent (net of refunds, existing definition) ÷ try-ons and ÷ units sold |

Filters: the existing date range and branch (admin); staff are forced to their own branch by the
existing `resolveScope`. Compare-with-previous-period is a separate follow-up (§7.3), not here.

## Decisions (with tradeoffs)

### D1. Where the numbers are computed

| Option | Developers | Users |
|---|---|---|
| **A. Source tables (`session_items`, `carts`, `jobs`)**, like the existing summary | Same definitions the dashboard already uses, so numbers cannot disagree with it. Queries are heavier than a rollup read, but every one is scoped by `merchant_id` and a date window | Always exact, up to the second |
| B. Add new event types to rollups and read buckets | New events, rollup changes, a parity test per metric. Buckets have no item or size dimension, so per-item tables are impossible without more columns | Trails live by about 2 minutes |

**Recommend A.** Spec decision D2 already keeps the existing dashboards on source tables for the
same reason; the per-item tables need `catalog_item_id`, which buckets do not carry. Revisit only
if a large merchant makes a query slow.

### D2. Where the screen lives

| Option | Developers | Users |
|---|---|---|
| **A. New "Insights" page in Merchant Web** (`/insights`, sidebar item) | One new page and route group, nothing existing is touched | A clear place to go; the dashboard stays quick and uncluttered |
| B. More cards on the existing dashboard | Fewer routes, but the dashboard page already holds the trend, funnel, heatmap and branch table | One long page; slower first load |

**Recommend A.** Staff see it too, scoped to their branch (they act on stock and conversion at the counter).

### D3. Item list size and privacy of per-staff data

The lost-demand and out-of-stock tables are **per item, not per person**: no staff names appear, so
there is no new personal-data exposure. Lists are capped (top 20) with a "show more" that pages by
cursor; sorted by the number that matters (lost demand: tries × (1 − sale rate)).

## API

All under `/v1/merchant/insights/*`, guarded by `requireMerchantMember`, scope from
`resolveScope` (staff → own branch, foreign ids 403), window from `resolveWindow`. Every query
carries `merchant_id`. Pure query functions in `merchant/insights/queries.ts`, thin routes, shared
handlers so the team console can later reuse them per account (same pattern as analytics phase 2).

| Route | Returns |
|---|---|
| `GET …/insights/funnel` | `{ window, sessions, tried, carted, billed, carts: { billed, abandoned, open } }` |
| `GET …/insights/lost-demand` | `{ items: [{ catalogItemId, name, pricePaise, tried, carted, sold, rate }], bySize, byColour }` |
| `GET …/insights/out-of-stock` | `{ rows: [{ catalogItemId, name, size, branchId, branchName, views }], stale: [{ branchId, branchName, variants, oldestUpdate }] }` |
| `GET …/insights/reliability` | `{ finished, failed, failureRate, waitMs: { p50, p90 }, creditsPerTryon, creditsPerSale }` |

Types live in `packages/types` (Zod query, interfaces for responses), beside `merchant-analytics.ts`.

## Tasks

- [x] **T1 Types.** Query and response types in `packages/types/src/merchant-insights.ts`; unit test the query schema (defaults, bad dates).
- [x] **T2 Funnel + cart queries** and route. Hand-computed fixture test (as `merchant-analytics.test.ts`): sessions with/without cart, billed, abandoned, open, a removed line, a voided sale. Assert the funnel `sessions` and `tried` equal the existing summary for the same window (parity).
- [x] **T3 Lost-demand queries.** Fixture: one item tried 6× and sold 0 (listed), one tried 2× (below the minimum, absent), one with sales. Size/colour from cart lines only.
- [x] **T4 Out-of-stock + staleness queries.** Fixture: `oos_viewed` events across two branches, a feed-owned and a manual stock row, one stale row. Staff scope test: another branch's rows never appear.
- [x] **T5 Reliability + cost queries.** Fixture: completed, failed, refunded and unfinished jobs; percentile of a known set; zero-division guards (no try-ons, no sales).
- [x] **T6 Scope and isolation tests** for all four routes: staff forced to own branch (403 on another), other merchants' rows never leak, unauthenticated 401.
- [x] **T7 Merchant Web page `/insights`.** KPI cards (funnel steps with step-to-step %), two tables with mobile cards, stale-stock list, reliability cards. Loading, error with retry, empty ("No try-ons in this range"), and an honest note where a number is device-reported or starts at the cart. Reuse `RangePicker`, `KpiCard`, `ListState`. Dark-mode safe tokens only.
- [ ] **T8 Console reuse (optional, later).** `GET /admin/accounts/:id/insights/*` over the same handlers plus a section on the account page.
- [x] **T9 Docs.** `docs/progress.md` entry; spec §7.2 ticked for the metrics built.

Order: T1 → T2 → (T3, T4, T5 in parallel) → T6 → T7 → T9.

## Not in scope

Date compare; drill-down to session; CSV export; scheduled reports; revenue and average order
value (cart × price estimate, own plan); customer and WhatsApp analytics; alerts; anything needing
a POS.

## Risks

- **`oos_viewed` is device-reported.** Labelled "views on the tablet", never "lost sales". If the owner needs a hard number, take Q3.
- **Per-item queries on a large merchant.** Window-bounded and merchant-scoped; add an `EXPLAIN` on a 500k-session fixture in T3 (as analytics phase 1 did) before shipping.
- **No browser check yet** for any Merchant Web page; T7 is verified by tests and typecheck only until the browser pass.

## Questions for the user

1. **Minimum tries** before an item appears in lost demand: 5 (recommended) or another number?
2. **Staleness threshold:** 14 days (recommended)?
3. **Hard out-of-stock number.** The server already refuses a cart add with `OUT_OF_STOCK` (`cart/routes.ts:234`) but records nothing. Add one server event (`cart_refused_oos`, written in the same code path, allowlist + rollup untouched) so out-of-stock demand has a number the tablet cannot forge? Recommended yes: tiny change, adds one server event name to `ANALYTICS_SERVER_EVENTS`.
