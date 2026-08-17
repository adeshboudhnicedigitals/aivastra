# Shopify credit top-up (one-time purchase) — design

**Date:** 2026-08-17
**Status:** approved, not yet implemented
**Branch:** `feature/shopify-credit-topup`

## Problem

Shopify merchants get credits once per billing cycle from their subscription
plan (starter / growth / pro, see `billing-plans.ts`). A merchant who burns
through a cycle's credits early has exactly two options today: wait for the
renewal, or upgrade to a bigger monthly plan they may not want year-round.
Neither converts a merchant who is actively trying to run more try-ons *right
now*, which is the moment they are most willing to pay.

Top-up adds a third: buy a one-off pack of credits without touching the
subscription.

## Approach

Shopify's Admin GraphQL exposes `appPurchaseOneTimeCreate`, a one-time charge
that is entirely independent of the App Pricing subscription. It returns a
`confirmationUrl` the merchant approves on Shopify's own page, exactly like the
plan picker does — so the shape of this feature is a near-copy of the existing
subscription confirm flow, and reuses every piece of it that already works:

- `grantStore(db, storeId, amount, reason, externalRef)` — already idempotent
  via the `external_ref` partial unique index on `shopify_credit_ledger`
  (migration 0150). No new locking, no new idempotency mechanism.
- The "redirect params are merchant-controllable, re-fetch the truth from
  Shopify" rule established in `billing.routes.ts`.
- The `SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS` gate. `AppPurchaseOneTime` carries the
  same `test` boolean as `AppSubscription`, and the abuse it guards against is
  identical in shape (free dev store → free credits → repeat), so it gets the
  same knob rather than a second one.

Shopify sends **no webhook** for a one-time purchase, same as App Pricing. The
merchant-facing confirm route is therefore the primary grant path, with the same
retry treatment `BillingCallbackPage.tsx` already gives the subscription case.

### Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Pricing shape | Fixed packs | Mirrors `DEFAULT_CREDITS_BY_PLAN_HANDLE`. A free-form dollar amount needs a credits-per-dollar rate that silently drifts out of line with plan pricing. |
| Eligibility | Active paid subscription only | Top-up is an add-on, not an alternative to subscribing. Keeps "a paying store" as the single precondition and stops top-up becoming a way to route around plans entirely. |
| UI surface | `apps/shopify` embedded admin | Where merchants already see plan and credit state. |
| Test-charge gate | Reuse `SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS` | Same risk, same environments, one knob. |

## Flow

```
apps/shopify (SPA)              apps/api                        Shopify Admin API
"Buy 500 credits" ──POST──▶ /v1/shopify/billing/topup
                             ├─ requireShopifySession
                             ├─ store.subscriptionStatus === 'active'?
                             ├─ resolve pack → credits + priceUsd (server-side)
                             ├─ INSERT shopify_topup_purchases (PENDING)
                             ├─ appPurchaseOneTimeCreate ─────────▶ confirmationUrl, purchase GID
                             ├─ UPDATE row with shopifyPurchaseId
                             └─ 200 { confirmationUrl }
navigateTopLevel(confirmationUrl) ────────────────────────────────▶ merchant approves on Shopify
                             ◀───────────────────── returnUrl: /shopify-admin/topup/callback?purchase=<our-uuid>
GET /v1/shopify/billing/topup/confirm?purchase=<our-uuid>
                             ├─ load row, assert row.storeId === session store
                             ├─ node(id: row.shopifyPurchaseId) → status, test
                             ├─ ACTIVE && test-gate passes → grantStore(externalRef)
                             ├─ UPDATE row.status
                             └─ 200 { status, creditsGranted, creditBalance }
```

The `purchase` query param is our own row UUID, never the Shopify GID, and it is
only ever used as a lookup key — the credits granted come from the row, and the
purchase's real state comes from Shopify. A merchant editing that param can at
worst point at another row, which the `storeId` check rejects.

## Data model

New migration adding `shopify_topup_purchases`. It is a separate table rather
than extra columns on `shopify_credit_ledger` because a purchase has state
*before* any credits exist — the ledger only ever records grants that happened.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | our key; the only id that appears in a URL |
| `store_id` | uuid fk → `shopify_stores` (cascade) | checked on confirm |
| `shopify_purchase_id` | text, nullable | the `AppPurchaseOneTime` GID; null between INSERT and the mutation returning |
| `pack_id` | text | e.g. `topup_500` |
| `credits` | integer | what to grant — authoritative, never re-derived from Shopify's response |
| `price_usd` | integer (cents) | what we asked Shopify to charge, for reconciliation |
| `status` | text | `PENDING` \| `ACTIVE` \| `DECLINED` \| `EXPIRED` — last status observed at Shopify — or `FAILED`, which is ours and means the charge was never created |
| `created_at` / `updated_at` | timestamptz | |

Index on `store_id`. Abandoned `PENDING` rows are harmless (no credits, no
charge) and are left alone; a sweep is out of scope.

## Components

### `apps/api/src/modules/shopify/topup-packs.ts` (new)

Mirrors `billing-plans.ts`: a `TOPUP_PACKS` record of pack id →
`{ credits, priceUsd, label }`, plus a lookup that returns `null` for an
unknown id. Unlike plan names, pack ids are ours end to end — Shopify never
echoes one back — so this needs no case-insensitive matching and no
Partner Dashboard coordination.

Credits per pack follow the `getShopifyPlanCredits` precedent: admin-overridable
from the `config:system` Redis key, falling back to the code default. **Price
does not** — price is sent to Shopify in the mutation and must come from code,
so that a bad admin edit cannot change what a merchant is charged.

Draft packs (credits chosen to sit slightly below plan-tier per-credit value, so
top-up never undercuts subscribing):

| Pack | Price | Credits |
|---|---|---|
| `topup_500` | $12 | 500 |
| `topup_1500` | $32 | 1500 |
| `topup_4000` | $79 | 4000 |

Shopify rejects an application charge under $0.50 USD, so every pack must stay
above that floor — a constraint worth a comment rather than a runtime check,
since the values are static.

### `apps/api/src/modules/shopify/topup.ts` (new)

Business logic, `deps`-injectable exactly like `syncStoreSubscription`:

- `createTopupPurchase(app, store, packId, deps?)` → `{ confirmationUrl }`
- `confirmTopupPurchase(app, store, rowId, deps?)` → `{ status, creditsGranted }`

Both talk to Shopify through `shopifyGraphQL` with `getValidAccessToken`, same
as `subscription-client.ts`.

**Validated GraphQL** (checked against the schema; repo targets `2026-07`, both
operations validated clean against `2026-04` and are long-stable):

```graphql
mutation CreateTopupPurchase($name: String!, $price: MoneyInput!, $returnUrl: URL!, $test: Boolean!) {
  appPurchaseOneTimeCreate(name: $name, price: $price, returnUrl: $returnUrl, test: $test) {
    confirmationUrl
    appPurchaseOneTime {
      id
      status
      test
    }
    userErrors {
      field
      message
    }
  }
}
```

```graphql
query TopupPurchaseStatus($id: ID!) {
  node(id: $id) {
    ... on AppPurchaseOneTime {
      id
      status
      test
      name
      price {
        amount
        currencyCode
      }
    }
  }
}
```

`node(id:)` is used rather than paginating
`currentAppInstallation.oneTimePurchases` — `AppPurchaseOneTime` implements
`Node`, so a store with a long purchase history costs one lookup, not a page
walk.

The external ref is `shopify_topup:<shopifyPurchaseId>`, keyed on Shopify's own
id so a double confirm, a refresh, or a retry after a timeout all collapse to
one grant through the existing unique index.

### `apps/api/src/modules/shopify/topup.routes.ts` (new)

- `POST /v1/shopify/billing/topup` — body `{ packId }`, `requireShopifySession`.
- `GET /v1/shopify/billing/topup/confirm` — query `{ purchase }`,
  `requireShopifySession`.

Registered from `modules/shopify/routes.ts` alongside `shopifyBillingRoutes`.
Request/response shapes go in `packages/types` per the repo's Zod convention.

### `apps/shopify` (frontend)

- `src/lib/topupPacks.ts` — display copy only, mirroring `planFeatures.ts` and
  carrying the same comment about why display copy is deliberately separate from
  the credit-granting source of truth.
- `PricingPage.tsx` — a "Need more credits?" card below the plan grid, one
  button per pack. Buttons disabled with an explanatory note when
  `me.store.subscriptionStatus !== 'active'`, so the eligibility rule is visible
  rather than a surprise 4xx.
- `TopupCallbackPage.tsx` — new route `/topup/callback`, a near-copy of
  `BillingCallbackPage.tsx` including its retry loop and its refusal to fail
  silently. Distinct copy: a declined purchase is a normal outcome here and must
  read as "no charge was made", not as an error.

## Error handling

| Case | Behaviour |
|---|---|
| Unknown `packId` | 400, no row inserted |
| `subscriptionStatus !== 'active'` | 403 `TOPUP_REQUIRES_PLAN`, no row inserted |
| `userErrors` from the mutation | 502, row marked `FAILED`, message surfaced to the SPA. Deliberately not `DECLINED` — that word means the merchant saw the charge and said no, and conflating it with "Shopify never accepted our request" would make the two indistinguishable when reconciling later |
| Confirm sees `PENDING` | Not an error. Merchant closed the tab; return status, grant nothing, do not log at error level |
| Confirm sees `DECLINED` / `EXPIRED` | Same — record status, grant nothing |
| `test: true` and gate off | `app.log.warn` mirroring `billing.ts`'s wording, no grant |
| Row's `storeId` ≠ session store | 404, not 403 — do not confirm the existence of another store's row |
| Double confirm | Idempotent via `external_ref`; second call reports `creditsGranted: 0` with the same final balance |
| Subscription cancelled between purchase and confirm | Grant proceeds. The merchant paid; retroactively refusing the credits would be worse than the inconsistency. Matches how `syncStoreSubscription` already tolerates state moving under it |

## Testing

Unit:
- `topup-packs.test.ts` — lookup, unknown id → null, every pack above the $0.50
  floor. Mirrors `billing-plans.test.ts`.

Integration (`apps/api/test/integration/`), `deps`-injected Shopify client so no
network is touched:
- create: happy path writes a `PENDING` row and returns the confirmation URL
- create: blocked when the store has no active subscription
- create: unknown pack id rejected, no row written
- confirm: `ACTIVE` grants once and increments `shopify_store_credits`
- confirm: a second call grants nothing and leaves the balance unchanged
- confirm: `PENDING` / `DECLINED` grant nothing
- confirm: `test: true` with the gate off warns and grants nothing
- confirm: another store's row id returns 404

## Out of scope

- Auto-top-up / low-balance auto-recharge. Needs stored consent and a recurring
  authorization; a separate design.
- Refunding a top-up. Handled manually through Shopify's own partner tooling.
- Sweeping abandoned `PENDING` rows.
- Top-up for non-Shopify users — `apps/api/src/modules/payments/` (Razorpay)
  already covers that path and is untouched here.
