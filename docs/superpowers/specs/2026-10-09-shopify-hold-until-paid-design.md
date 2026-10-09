# Shopify credit packs: hold credits until paid — design

**Date:** 2026-10-09
**Status:** approved design, not yet implemented
**Scope:** manual one-time credit-pack purchases (`appPurchaseOneTimeCreate`) only

## Problem

`grantForPurchase` (`apps/api/src/modules/shopify/purchase.ts`) grants a pack's credits as
soon as Shopify reports the charge `ACTIVE`. For a one-time charge `ACTIVE` means *approved
and invoiced*, not *paid*: Shopify invoices at approval and collects afterwards, and
collection can fail.

Observed on production, 2026-10-09 ($1 Silver test on our own store, see `docs/progress.md`):
charges `3321135345` and `3321168113` both reached `ACTIVE` and both granted 800 credits. The
first one's invoice is **Failed**, the second's **Paid**. Nothing in the system could tell
them apart.

The Admin API exposes no payment state, and no webhook fires on collection. The only
programmatic signal is the **Partner API** `transactions` query: an `AppOneTimeSale` carrying
the charge id is recorded once the merchant has paid. Verified with
`pnpm check:partner-transactions`: `3321168113` has a sale recorded at 06:39:29Z, about 1–2
minutes after its 06:38Z approval; `3321135345` has none.

Exposure today: up to 800 / 2,250 / 10,000 credits per unpaid $10 / $25 / $100 pack.

## Decisions

| Question | Decision |
|---|---|
| Scope | One-time packs only. Auto-refill is excluded — see *Out of scope*. |
| Merchant experience while unpaid | The return page waits about 3 min, then hands off to a persistent banner. A background loop grants whenever payment lands. |
| How long to keep checking | Back off, and park as `UNPAID` after 30 days. A manual "Check payment" can still settle it later. |
| Partner API unavailable | Fail closed: purchases stay pending, and an alert fires. |
| Where payment state lives | A new `payment_status` column, separate from `status`. |
| What counts as paid | An `AppOneTimeSale` whose charge id matches ours, compared on the numeric id. |

Test charges (development stores) are unaffected: Shopify records no sale for them, so they
keep granting on `ACTIVE`, bounded by `TEST_GRANT_LIMIT`.

## Data model

Migration `0219` adds to `shopify_credit_purchases`:

| Column | Type | Meaning |
|---|---|---|
| `payment_status` | `text NOT NULL DEFAULT 'NOT_REQUIRED'` | `NOT_REQUIRED`: test charge, auto-refill, or a row from before this change. `AWAITING`: `ACTIVE` at Shopify, no sale seen yet. `PAID`: sale found and credits granted. `UNPAID`: still no sale after 30 days. |
| `paid_at` | `timestamptz NULL` | The sale's `createdAt` from the Partner API. |
| `next_payment_check_at` | `timestamptz NULL` | When the loop next checks this row. Non-null only while `AWAITING`. |

There is also a partial index on `(next_payment_check_at) WHERE payment_status = 'AWAITING'`.

`status` keeps its documented meaning, Shopify's charge state. Existing rows default to
`NOT_REQUIRED` and are never re-examined.

```
status PENDING ──approve──▶ status ACTIVE, payment_status AWAITING   (no credits)
                                  │ AppOneTimeSale with our charge id
                                  ▼
                            payment_status PAID + paid_at + grant   (one transaction)
AWAITING ≥ 30 days, successful query, no sale ──▶ UNPAID
UNPAID ──sale found by a manual check──▶ PAID + grant
```

`PAID` and the grant are written in one Postgres transaction.

## Components

| File (`apps/api/src/modules/shopify/`) | Responsibility |
|---|---|
| `partner-api.ts` | `fetchOneTimeSales({ since, shop? })` returns a `Map<numericChargeId, { paidAt }>`. It pages through results, stays under the Partner API's 4 req/s per client, and throws a typed `PartnerApiError` (`reason`: `missing_config`, `http`, `graphql`, `rate_limited`). It reads `SHOPIFY_PARTNER_API_TOKEN` and `SHOPIFY_PARTNER_ORG_ID`. |
| `payment-settlement.ts` | `settlePaid(db, row, paidAt)`: a conditional `UPDATE … SET payment_status='PAID', paid_at=$2, next_payment_check_at=NULL WHERE id=$1 AND payment_status IN ('AWAITING','UNPAID') RETURNING`, then `grantStore(…, 'SHOPIFY_PACK', 'shopify_pack:{chargeId}')`, both in one transaction, and the grant runs only if the update returned a row. `nextCheckAt(createdAt, now)`. `checkPurchases(app, rows, deps)`: one query, then for each row settle, reschedule or park. |
| `payment-settlement-scheduler.ts` | `startPaymentSettlementScheduler(app)` (60 s `setInterval` plus a re-entrancy guard, started in `apps/api/src/main.ts` after `listen`) and an exported `tick`, following `autorefill-reconciler.ts`. |

`fetchOneTimeSales` is injected (`deps`) the way `fetchPurchase` already is, so tests never
call Shopify.

### Backoff (`nextCheckAt`, measured from `createdAt`)

| Purchase age | Check every |
|---|---|
| < 15 min | 1 min |
| 15 min – 24 h | 15 min |
| 24 h – 7 days | 1 h |
| 7 – 30 days | 24 h |
| ≥ 30 days | park as `UNPAID` (only after a successful query found no sale) |

## Flows

**`grantForPurchase`**, when `SHOPIFY_HOLD_UNTIL_PAID === true`:

- **Non-test `ACTIVE` charge, row `NOT_REQUIRED`:** set `payment_status='AWAITING'` and
  `next_payment_check_at=now()`, and return 0.
- **Row already `AWAITING`, `PAID` or `UNPAID`:** return 0 without changing it. A replayed
  webhook is a no-op.
- **Test charge:** unchanged.

The confirm route and the `app_purchases_one_time_update` webhook both go through this, so
neither path can grant a real charge any more. With the flag off, behaviour is exactly
today's.

**Loop tick:**

1. Select up to 200 `AWAITING` rows with a non-null charge id and
   `next_payment_check_at <= now()`.
2. Make one `fetchOneTimeSales({ since: min(createdAt) - 1h })` call.
3. For each row:
   - **Sale matches:** call `settlePaid`.
   - **No sale, row ≥ 30 days old:** set `UNPAID` and clear `next_payment_check_at`.
   - **No sale otherwise:** reschedule with `nextCheckAt`.

The loop runs regardless of the flag, so rows already `AWAITING` still settle after a
rollback.

**Confirm route (on-demand check):** if the row is `AWAITING`, run `checkPurchases` for that
row only, filtered by `shop` and `since: createdAt - 1h`. Throttle it to one Partner API call
per purchase every 10 s using a Redis key `shopify:paycheck:{purchaseId}`. When throttled,
return the stored state. The response adds `paymentStatus`.

**Race safety:** the conditional update in `settlePaid` lets exactly one of the loop, confirm
or the admin check grant. `grantStore`'s `external_ref` idempotency remains as a second guard.

## API

- **`GET /v1/shopify/billing/purchase/confirm`:** adds `paymentStatus` to the response, and
  also acts as the merchant's "Check payment".
- **`GET /v1/shopify/billing/purchases/pending` (new, session-authed):** returns the store's
  `AWAITING` and `UNPAID` purchases (`id`, pack label, `credits`, `createdAt`,
  `paymentStatus`). It is deliberately not added to `/v1/shopify/me`.
- **`POST /admin/shopify/purchases/:id/check-payment` (new):** guarded by
  `requirePermission('credits.write')`, the capability that already guards admin credit
  grants. There is no `shopify_stores.write`; that module only has `.read` and `.delete`, and
  this action can grant credits. It runs `checkPurchases` for that row,
  and when it grants, writes `recordAudit(tx, …)` in the settlement transaction (fail-closed,
  per the admin-mutation invariant). The response is the resulting `paymentStatus`.

## Shopify SPA

- **`BillingCallbackPage`:**
  - Calls confirm every 5 s for up to 3 min, showing "Confirming your payment with Shopify…".
  - `PAID` or `NOT_REQUIRED` goes to the dashboard with the toast "N credits added".
  - Still `AWAITING` after 3 min goes to the dashboard, where the banner takes over. This is
    not an error.
  - The `DECLINED`/`EXPIRED` handling and the error banner are unchanged.
  - The file's comment claiming there is no background reconciler is rewritten.
- **`PendingPaymentBanner` (new):** fed by `/purchases/pending`, built from Polaris `Banner`.
  - **`AWAITING`:** shown on the Dashboard and Pricing pages, tone `warning`. Copy: "Payment
    pending: N credits (Pack) will be added as soon as Shopify collects your payment."
  - **`UNPAID`:** shown on Pricing only, tone `critical`. Copy: "We haven't received payment
    for your Pack pack. Pay the outstanding invoice in Shopify billing, then check again."
  - **Actions (both states):** **Check payment** calls confirm and shows the outcome. **Open
    Shopify billing** is a top-level link to the store's Settings → Billing.
- **Buying while a purchase is pending stays allowed.** A failed payment followed by a
  successful retry is a real pattern (the 2026-10-09 test), and each charge grants only once
  it is paid, so a second purchase cannot over-grant.

## Admin web

The Shopify Stores page shows each purchase's `payment_status` and `paid_at`, with a **Check
payment** button calling the admin route.

## Config

| Var | Notes |
|---|---|
| `SHOPIFY_HOLD_UNTIL_PAID` | Accepts only the literal `'true'`; compared `=== true`. Off by default. |
| `SHOPIFY_PARTNER_API_TOKEN` | A secret. A Partner API client with **View financials** only. Use a separate client per environment (staging vs production), because the rate limit is per client. |
| `SHOPIFY_PARTNER_ORG_ID` | Not secret. |

All three are added to `apps/api/src/env.ts` (optional) and to `.env.production.example` with
comments. They are runtime vars, so a restart applies them and no rebuild is needed.

## Failure handling

| Failure | Behaviour |
|---|---|
| Token or org id missing | One error log per tick; nothing is checked or granted, and confirm returns `AWAITING`. |
| HTTP, GraphQL or timeout error | Due rows are not rescheduled and retry next tick. Nothing is parked because of our own outage. |
| 429 | As above; the client waits before its next page. |
| One row's settlement fails | Logged and skipped; the rest of the tick continues. |
| Row has no charge id | Skipped. |
| Store uninstalled while `AWAITING` | Still settled — the merchant paid. |

**Metrics** (`@aivastra/observability`):

- `shopify_payment_check_failures_total{reason}`
- `shopify_payment_check_last_success_timestamp`
- `shopify_purchases_awaiting_payment`

The Grafana alert ("no successful check for over 15 min while rows are awaiting") is
configured outside the repo, so record it in `docs/progress.md` when it is created.

## Rollout

1. Deploy the migration and code with the flag off. Behaviour is unchanged.
2. Add `SHOPIFY_PARTNER_API_TOKEN` and `SHOPIFY_PARTNER_ORG_ID` to `.env.production`, then
   run `pnpm check:partner-transactions -- 3321168113` on the VPS to prove the token works
   from there.
3. Set `SHOPIFY_HOLD_UNTIL_PAID=true` and restart the api.
4. Buy a real Silver pack on our store and confirm it goes `AWAITING` → `PAID`, the banner
   behaves, and the credits land once.

**Rollback:** turn the flag off. Rows already `AWAITING` keep settling through the loop.

## Testing

- **Unit:**
  - `nextCheckAt` boundaries.
  - Numeric charge-id matching (bare id vs gid).
  - `partner-api` with a mocked `fetch`: pagination, GraphQL error, HTTP error, 429, missing
    config.
- **Integration** (existing harness; `fetchOneTimeSales` and `fetchPurchase` injected):
  - With the flag on, a non-test `ACTIVE` charge becomes `AWAITING` and writes no ledger row.
  - With the flag off, behaviour is unchanged.
  - A test charge still grants.
  - A tick with a matching sale gives `PAID`, `paid_at`, and exactly one ledger row.
  - The loop and confirm racing grant exactly once.
  - A replayed webhook after `PAID` is a no-op.
  - 30 days with no sale gives `UNPAID`; a later sale then settles it.
  - A Partner API outage leaves the row `AWAITING`, unparked, and increments the failure
    metric.
  - The confirm throttle holds.
  - The admin check is permission-gated and writes the audit row.
- **SPA:** no component-test harness exists; verify the callback page and banner by hand in
  rollout step 4.

## Out of scope

- **Auto-refill.** Usage records are billed on the subscription's cycle invoice, so holding
  until paid could delay a refill by weeks, which defeats it. It stays protected by the
  merchant-approved spend ceiling and Shopify's subscription freeze. The billing timing for
  usage records was not verified in this design.
- **Refunds and chargebacks** after a sale (later adjustment/credit transactions). An
  `AppOneTimeSale` is treated as final for granting.
- **Re-checking purchases granted before this ships**, including the 2026-10-09 test
  charges.

## Known limits of the evidence

The "a sale exists only after payment" rule comes from Shopify staff on community.shopify.dev
plus our own two-charge observation. It is not written as a contract in the Partner API
reference. Before enabling the flag, run `check:partner-transactions` against a few more real
purchases, ideally including a card payment, to confirm paid charges keep appearing within
minutes.
