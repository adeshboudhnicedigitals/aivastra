# Shopify credit packs: grant on approval, verify payment afterwards — design

**Date:** 2026-10-09
**Status:** design for review, not yet implemented
**Supersedes the direction of:** `2026-10-09-shopify-hold-until-paid-design.md`. That feature
(hold credits until the Partner API shows a sale) is built, merged and **dormant**
(`SHOPIFY_HOLD_UNTIL_PAID=false` in production since 2026-10-09 12:33Z). This design does not
remove it.

## Background

A one-time pack purchase has three moments:

1. **Approval** — the merchant approves the charge on Shopify's screen; the charge goes `ACTIVE`
   (invoiced, not paid).
2. **Payment** — Shopify collects the invoice. It can fail.
3. **Visibility** — the sale becomes readable through the Partner API (`AppOneTimeSale`).

Step 2 is invisible to us: the Admin API and webhooks stop at `ACTIVE`, and the only payment
signal is the sale at step 3. Measured on production on 2026-10-09 (charge `3321299185`): paid and
recorded by Shopify 11:15:22Z, **not yet visible at 11:51Z, visible by 12:01Z** — 36 to 46 minutes
after payment, one sample. Holding credits until step 3 therefore meant ~45 minutes of "pending"
for every purchase.

**Management decision (2026-10-09): do not hold credits.** Grant at step 1 as the original code
did. That leaves a known gap: a payment that fails after approval is neither noticed nor followed
up (the incident that started this work: charge `3321135345`, invoice Failed, 800 credits granted).

## Goal

Keep credits instant, and **close the visibility gap**: detect approved charges that Shopify never
collected, show them to admins, and let an admin record a decision. Credits are never taken back
automatically.

## Decisions

| Question | Decision |
|---|---|
| Credits | Granted at approval, as today. Never held, never clawed back by this feature. |
| Verification | After the grant, the Partner API is used to *confirm* a sale; absence after a window means "not received". |
| Window | 180 minutes by default (`SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES`, min 60), several times the observed 36–46 min lag. Tunable without a deploy because the evidence is one sample. |
| Admin | New all-stores "Pack purchases" page; admins can override the payment status (paid / not received) and add a note. |
| Permissions | List: `shopify_stores.read`. Any change: `credits.write` (the capability that already guards admin credit actions). |
| Consequences of "not received" | None automatic. Records and alerts only, until management defines a policy. |
| Merchant-facing banner | Not in this feature. |

## Status model

`shopify_credit_purchases.payment_status` (text) gains three values. The two existing "held"
values belong to the dormant hold feature and are unchanged.

| Value | Meaning | Credits granted? |
|---|---|---|
| `NOT_REQUIRED` | Not tracked: test charge, auto-refill, legacy row, or verification flag off. | per old behaviour |
| `UNVERIFIED` | Granted at approval; no sale seen yet. | yes |
| `PAID` | Sale seen, or an admin confirmed it. | yes |
| `NOT_RECEIVED` | Granted; no sale seen after the window. | yes |
| `AWAITING` / `UNPAID` | Held / parked by the dormant hold feature. | **no** |

```
approval (flag SHOPIFY_VERIFY_PAYMENTS on, hold off, real non-test manual charge)
   │  grant + mark, one transaction
   ▼
UNVERIFIED ──sale seen──▶ PAID
   │ age ≥ window, query succeeded, no sale
   ▼
NOT_RECEIVED ──sale seen later (checked daily up to 30 days)──▶ PAID
```

An admin override (`payment_status_source = 'MANUAL'`) can put a granted row into `PAID` or
`NOT_RECEIVED`; automatic checks then leave it alone until the override is cleared.

If `SHOPIFY_HOLD_UNTIL_PAID` and `SHOPIFY_VERIFY_PAYMENTS` are both `true`, the hold takes
precedence and nothing is verified (the hold already waits for the sale).

## Data model — migration `0220` (additive)

On `shopify_credit_purchases`:

| Column | Type | Meaning |
|---|---|---|
| `payment_status_source` | `text NOT NULL DEFAULT 'AUTO'` | `AUTO` or `MANUAL`. |
| `payment_note` | `text NULL` | Free text from the last admin review (max 500 chars). |
| `payment_flagged_by` | `uuid NULL REFERENCES users(id) ON DELETE SET NULL` | Admin who last reviewed. |
| `payment_flagged_at` | `timestamptz NULL` | When. |

Plus a partial index for the loop:
`(next_payment_check_at) WHERE payment_status IN ('UNVERIFIED','NOT_RECEIVED') AND payment_status_source = 'AUTO'`.

`paid_at` and `next_payment_check_at` (migration `0219`) are reused. Existing rows are untouched
and not backfilled; the 2026-10-09 test rows can be annotated by hand through the new admin page.

## Flows

### Grant (changes `grantForPurchase`, `apps/api/src/modules/shopify/purchase.ts`)

With `SHOPIFY_VERIFY_PAYMENTS === true`, hold off, a real (`!observed.test`) `ACTIVE` charge and a
row still `NOT_REQUIRED`, in **one transaction**:

1. `UPDATE … SET payment_status = 'UNVERIFIED', next_payment_check_at = now() + 15 min
   WHERE id = $1 AND payment_status = 'NOT_REQUIRED' RETURNING`
2. if a row came back, `grantStore(tx, storeId, row.credits, 'SHOPIFY_PACK', 'shopify_pack:<chargeId>')`.

Same transaction, so a crash can never leave "marked but not granted" (the existing early return
`paymentStatus !== 'NOT_REQUIRED'` would then block any retry) or "granted but untracked". The
`external_ref` idempotency still covers replays and the confirm/webhook race. Test charges,
auto-refill and flag-off behaviour are unchanged.

### Verification loop (extends `startPaymentSettlementScheduler`)

A second pass in the existing 60 s tick. Rows: `payment_status IN ('UNVERIFIED','NOT_RECEIVED')`,
`payment_status_source = 'AUTO'`, `next_payment_check_at <= now()`, up to 200. One Partner API
query for all of them (the same `fetchOneTimeSales`, `since` = oldest `createdAt` − 1 h). Per row:

- **sale found:** `UPDATE … SET payment_status='PAID', paid_at=<sale time>, next_payment_check_at=NULL
  WHERE id=$1 AND payment_status IN ('UNVERIFIED','NOT_RECEIVED') AND payment_status_source='AUTO'`.
  No grant — credits were given at approval.
- **no sale, UNVERIFIED, age < window:** reschedule in 15 min.
- **no sale, UNVERIFIED, age ≥ window:** `NOT_RECEIVED`, next check in 24 h.
- **no sale, NOT_RECEIVED:** next check in 24 h until the row is 30 days old, then stop.

**Fail closed:** if the query fails, nothing changes — in particular a row is **never** marked
`NOT_RECEIVED` on a failed query, because absence is only meaningful after a successful one.

Implemented as its own module (`payment-verification.ts`) beside `payment-settlement.ts`, sharing
the Partner API client and, where sensible, the "fetch sales since the oldest row" step.

### Admin review

`POST /admin/shopify/purchases/:id/payment-review`, body `{ status?: 'PAID' | 'NOT_RECEIVED' | 'AUTO', note: string (3–500) }`:

- `PAID` / `NOT_RECEIVED`: set the status, `payment_status_source='MANUAL'`, note, `flagged_by`, `flagged_at`.
- `AUTO`: clear the override — source back to `AUTO`, status back to `UNVERIFIED`, `next_payment_check_at = now()` so the loop re-evaluates; note kept.
- `status` omitted: note only.
- Rows in `AWAITING` / `UNPAID` (held, ungranted) → **409**; they have their own flow.
- **Never touches the ledger or any balance.**
- Writes `recordAudit(tx, …)` in the same transaction (`shopify_purchase.payment_review`, with before/after status); fail-closed like every admin mutation.

The existing `POST …/check-payment` is extended to `UNVERIFIED` / `NOT_RECEIVED` rows (verify only,
no grant); on a `MANUAL` row it returns **409** ("clear the override first").

## API

- `GET /admin/shopify/purchases` (`shopify_stores.read`): all stores, newest first, cursor on
  `createdAt`, limit 50. Filters: `paymentStatus` (multi), `storeId`, `from`, `to`,
  `needsAttention=true` (= `NOT_RECEIVED`, or `UNVERIFIED` older than the window, or any row with a
  note). Returns store domain, pack, credits, price, charge status, payment status and source,
  `paid_at`, note, reviewer name/email, `flagged_at`, `created_at`, charge id.
- `POST …/payment-review` and the extended `…/check-payment` as above (`credits.write`).
- `GET /admin/shopify-stores/:id/purchases` (existing) now includes the new fields.
- `GET /v1/shopify/billing/purchases/pending` (merchant) is **unchanged**: it lists only
  `AWAITING`/`UNPAID`, so merchants never see a banner from this feature.

## Admin UI (`apps/admin-web`)

- New page `ShopifyPurchasesPage.tsx`, route `/shopify-purchases` in `App.tsx`, sidebar entry next
  to "Shopify Dashboard" in `Sidebar.tsx`. Table of the columns above; default view "Needs
  attention"; filters are local state, the open purchase/dialog is a URL param, closed through
  `useCloseOverlay` (per `docs/admin-url-routing-standard.md`). Dropdowns use `SearchableSelect`,
  never a raw `<select>`.
- Detail drawer: timeline (created → approved → sale time), whether the status is automatic or
  manual, the note, who and when, and the matching ledger row.
- "Review" dialog: status choice (Mark paid / Mark not received / Clear override) and a required
  note; "Check payment" button. Both gated on `hasPermission('credits.write')`.
- The per-store purchases card shows the new statuses and links to the page.

## Changes to existing code

- `me.routes.ts` (`hasPurchasedPack` / current pack): the "store has paid for a pack" check uses
  `payment_status IN ('NOT_REQUIRED','PAID')`. Add `UNVERIFIED` and `NOT_RECEIVED`: credits were
  delivered, so the free-credits tile should stay hidden and the pack shown.
- `grantForPurchase`: the transactional mark+grant above.
- `env.ts` and the three `.env*.example` files: `SHOPIFY_VERIFY_PAYMENTS` (literal `'true'`, `=== true`),
  `SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES` (default 180, min 60).

## Observability

New gauges (`@aivastra/observability`): `shopify_purchases_unverified`,
`shopify_purchases_not_received`, `shopify_purchases_overdue_verification` (automatic rows whose
`next_payment_check_at` is more than 1 h in the past). Existing failure counter and
last-success gauge are reused.

Alerts (Grafana, outside the repo — record in `docs/progress.md` when created):
- `shopify_purchases_not_received > 0` → someone should look at the admin page.
- `shopify_purchases_overdue_verification > 0` for 30 min → the loop or the Partner API is unhealthy.
  (This replaces alerting on the last-success timestamp, which goes stale on healthy systems
  whenever no row is due — the flaw found in the hold feature's review.)

## Failure handling

| Failure | Behaviour |
|---|---|
| Partner API / token / network error | Rows unchanged, retried next tick, failure metric; never marks `NOT_RECEIVED`. |
| Token or org id missing | One error log per tick; verification idle; credits unaffected. |
| Grant transaction fails | Whole transaction rolls back (row stays `NOT_REQUIRED`); confirm retries as today. |
| Admin audit write fails | Review rolls back; request returns an error. |
| Admin overrides a row the loop is checking | Source flips to `MANUAL` inside the update; the loop's conditional update then matches no row. |

## Rollout

1. Deploy with `SHOPIFY_VERIFY_PAYMENTS` unset; behaviour unchanged. Migration `0220` runs via CI.
2. Set `SHOPIFY_VERIFY_PAYMENTS=true`, restart the API. Buy Silver ($10) on the real store: credits
   instantly, row `UNVERIFIED`, `PAID` roughly an hour later (the loop polls every 15 minutes, so
   the visible lag is the Shopify delay plus up to 15 minutes).
3. Exercise the admin page: mark one row `NOT_RECEIVED` with a note, confirm the audit row and that
   the loop leaves it alone, clear the override.
4. Create the two Grafana alerts.

**Rollback:** flag off. Existing `UNVERIFIED` rows simply stop being checked; no credits change.

## Testing

- **Unit:** the schedule function (15 min / daily / stop at 30 days, window boundary).
- **Integration:** grant marks `UNVERIFIED` and writes exactly one ledger row in one transaction,
  including a replay and a confirm+webhook race; pre-existing ledger entry still ends `UNVERIFIED`;
  test charge and auto-refill stay `NOT_REQUIRED`; verification outcomes (sale → `PAID` without a
  grant, no sale before/after the window, later sale rescues `NOT_RECEIVED`); a Partner API failure
  leaves a past-window row untouched; manual override sets source/note/reviewer and writes an audit
  row, rolls back when the audit fails, is skipped by the loop, and `AUTO` clears it; held rows →
  409; permissions (403 without `credits.write`); list filters, `needsAttention`, pagination;
  `/me` treats `UNVERIFIED`/`NOT_RECEIVED` as purchased.
- **Admin UI:** no component-test harness; verify the page build and walk the rollout steps by hand.
- Test output must be pristine; stub expected error logs.

## Out of scope

- Clawback or blocking purchases for unpaid stores (needs a policy first).
- Any merchant-facing banner or email about a failed payment.
- Auto-refill (usage records bill on the cycle invoice).
- Backfilling pre-existing purchases.
- Removing the dormant hold feature.

## Known limits and open questions

- **Evidence is thin:** the 36–46 minute visibility lag is one sample, and the rule "a sale exists
  only after payment" comes from Shopify staff on the developer forum, not the API reference.
  Hence the tunable window and the manual override.
- **Management to decide later:** what happens to a `NOT_RECEIVED` store (contact, block, claw
  back), and whether merchants should be told.
- A merchant who pays a late invoice after 30 days is not auto-detected; an admin can mark it paid.
