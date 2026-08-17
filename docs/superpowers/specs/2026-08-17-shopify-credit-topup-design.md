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
| Pack set | Fixed three, ids and prices in code | Mirrors `planCredits`. A fourth pack is a deploy, which is the right friction for something that changes what a merchant is billed. |
| Who tunes credits | Admin panel, per pack | Lets pack generosity be tuned against real GPU cost without a deploy — the same reason `planCredits` is already admin-tunable. |
| Who tunes price | Nobody, code only | The price is the number sent to Shopify in the charge mutation. Config that can change what a merchant is charged is a different risk class from config that changes what they receive. |

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
| `credits` | integer | what to grant, snapshotted from config at purchase time — see "Credits are snapshotted" below |
| `price_usd` | integer (cents) | what we asked Shopify to charge, for reconciliation |
| `status` | text | `PENDING` \| `ACTIVE` \| `DECLINED` \| `EXPIRED` — last status observed at Shopify — or `FAILED`, which is ours and means the charge was never created |
| `created_at` / `updated_at` | timestamptz | |

Index on `store_id`. Abandoned `PENDING` rows are harmless (no credits, no
charge) and are left alone; a sweep is out of scope.

### Credits are snapshotted, not re-read

`credits` is written at INSERT, before the merchant ever sees Shopify's
confirmation page, and the grant reads **that column** — never the config, and
never anything in Shopify's response (Shopify knows the price, not the credits).

This is load-bearing because credits are admin-editable while a purchase can sit
unconfirmed indefinitely: the merchant may approve the charge a second later or
leave the tab open for an hour. Re-reading config at confirm time would mean an
admin editing a pack silently changes what an already-paying merchant receives,
with no record of the number they were shown when they agreed to pay. The row is
that record.

The price is snapshotted for the same reason, though the exposure is smaller —
price only changes on deploy.

## Components

### `apps/api/src/modules/shopify/topup-packs.ts` (new)

Mirrors `billing-plans.ts`: a `TOPUP_PACKS` record of pack id →
`{ credits, priceUsd, label }`, plus a lookup that returns `null` for an
unknown id. Unlike plan names, pack ids are ours end to end — Shopify never
echoes one back — so this needs no case-insensitive matching and no
Partner Dashboard coordination.

Credits per pack follow the `getShopifyPlanCredits` precedent exactly — a new
`getShopifyTopupCredits(app, packId)` in `resolution-config.ts` reads
`shopify.topupCredits[packId]` from the `config:system` Redis key and falls back
to the code default for a known pack, returning `null` for an unknown one.
**Price has no such override** — it is sent to Shopify in the charge mutation, so
it comes from code and only from code.

Default packs (credits chosen to sit above the plan tiers on a per-credit basis,
so a top-up is convenience-priced and never undercuts subscribing):

| Pack | Price | Credits | ¢/credit |
|---|---|---|---|
| `topup_500` | $12 | 500 | 2.40 |
| `topup_1500` | $32 | 1500 | 2.13 |
| `topup_4000` | $79 | 4000 | 1.98 |

For reference, the plans run 1.51 (starter), 1.18 (growth) and 1.04 (pro)
¢/credit — every pack is deliberately more expensive per credit than every plan.

Shopify rejects an application charge under $0.50 USD, so every pack must stay
above that floor — a constraint worth a comment rather than a runtime check,
since prices are static and none is close.

### `apps/admin-web/src/pages/settings/ShopifyCreditsTab.tsx` (extended)

Three more number inputs, below the existing per-plan ones, in the tab that
already edits `trialCredits` and `planCredits`. Same `PATCH /admin/config`
(SUPER_ADMIN only), same Redis key, same save button — `shopify.topupCredits`
sits alongside `shopify.planCredits` in the payload, and `GET /admin/config`
merges it over `DEFAULT_TOPUP_CREDITS` the way it already does for
`DEFAULT_CREDITS_BY_PLAN_HANDLE`. `SystemConfigBody` in `packages/types/src/admin.ts`
gains the matching optional object.

Each pack row shows its fixed price as static text (it is not editable and must
not look editable) and a live-computed **¢/credit** next to the input.

**Cannibalization warning.** Because price is fixed and credits float, an admin
raising a pack's credits far enough makes it cheaper per credit than subscribing
— at which point the rational merchant buys top-ups forever and never takes a
plan. The tab computes every pack's ¢/credit against the cheapest plan's and
shows an amber inline warning when a pack undercuts it, naming the plan it beats.

The warning does **not** block the save: promotional pricing and deliberate
testing are legitimate, and a hard block would need an override escape hatch
that is itself another way to get this wrong. Making the consequence visible at
the moment of the edit is the whole goal — today the number can be changed with
no signal at all that it crossed a line that matters.

This is presentation-layer only. It is not a security control and the API does
not re-check it; it guards against an honest mistake by a SUPER_ADMIN who
already has full authority over these values.

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
  floor, and every default pack priced above every plan on a ¢/credit basis (a
  regression test on the pricing intent, not just the mechanics). Mirrors
  `billing-plans.test.ts`.
- `getShopifyTopupCredits` — admin override wins, code default when unset,
  `null` for an unknown pack, code default when the stored value is malformed
  (matching `getShopifyPlanCredits`'s try/catch behaviour).

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
- confirm: an admin changing the pack's configured credits **after** the row was
  written still grants the snapshotted amount, not the new one — the guarantee
  in "Credits are snapshotted" is the one thing here a future refactor could
  quietly undo

## Out of scope

- Auto-top-up / low-balance auto-recharge. Needs stored consent and a recurring
  authorization; a separate design.
- Refunding a top-up. Handled manually through Shopify's own partner tooling.
- Sweeping abandoned `PENDING` rows.
- Top-up for non-Shopify users — `apps/api/src/modules/payments/` (Razorpay)
  already covers that path and is untouched here.
