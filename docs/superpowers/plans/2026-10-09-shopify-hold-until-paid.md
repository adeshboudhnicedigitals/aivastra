# Shopify Hold-Until-Paid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grant Shopify credit-pack credits only once the Partner API records an `AppOneTimeSale` for the charge, instead of as soon as the charge is `ACTIVE` (which means invoiced, not paid).

**Architecture:** A new `payment_status` column on `shopify_credit_purchases` tracks collection separately from Shopify's charge `status`. With `SHOPIFY_HOLD_UNTIL_PAID` on, `grantForPurchase` parks a real `ACTIVE` charge as `AWAITING` instead of granting. A settlement module queries the Partner API and atomically marks a purchase `PAID` and grants it. It is called from a 60 s api loop, from the merchant's confirm route (throttled), and from an admin action. The Shopify SPA waits up to 3 min on the return page, then shows a pending banner.

**Tech Stack:** Fastify 5, Drizzle ORM / Postgres 16, Redis (ioredis via `app.redis`), Vitest, React + Polaris (Shopify SPA), React (admin-web), prom-client via `@aivastra/observability`.

**Spec:** `docs/superpowers/specs/2026-10-09-shopify-hold-until-paid-design.md`

## Global Constraints

- **Scope:** manual one-time packs only (`source = 'manual'`). Auto-refill (`source = 'autorefill'`) behaviour must not change.
- **Test charges:** a charge with `observed.test === true` keeps today's grant-on-`ACTIVE` path, bounded by `TEST_GRANT_LIMIT`.
- **Feature flag:** `SHOPIFY_HOLD_UNTIL_PAID` accepts only the literal `'true'` (`z.preprocess((v) => v === 'true', z.boolean()).default(false)`), and every gate compares `=== true`. With it off, `grantForPurchase` behaves exactly as today.
- **`payment_status` values:** `'NOT_REQUIRED' | 'AWAITING' | 'PAID' | 'UNPAID'`, default `'NOT_REQUIRED'`.
- **Matching:** a sale matches a purchase when the numeric suffix of `AppOneTimeSale.chargeId` equals the numeric suffix of `shopify_credit_purchases.shopify_charge_id`.
- **Backoff, measured from `createdAt`:** under 15 min, check every 1 min; 15 min–24 h, 15 min; 24 h–7 days, 1 h; 7–30 days, 24 h; 30 days or more, park as `UNPAID`. Parking happens only after a successful query found no sale.
- **Fail closed:** a Partner API failure never grants, never parks, and never advances `next_payment_check_at`.
- **Partner API:** endpoint `https://partners.shopify.com/{SHOPIFY_PARTNER_ORG_ID}/api/2026-10/graphql.json`, header `X-Shopify-Access-Token`, 4 req/s per client. Never log or print the token.
- **Grant:** `grantStore(db, storeId, row.credits, 'SHOPIFY_PACK', 'shopify_pack:' + row.shopifyChargeId)`, in the same transaction as the `PAID` update.
- **Confirm throttle:** at most one Partner API call per purchase per 10 s, via Redis key `shopify:paycheck:{purchaseId}`.
- **Return-page timing:** poll every 5 s for at most 3 min.
- **Admin action:** `requirePermission('credits.write')`; `recordAudit(tx, …)` inside the settlement transaction.
- **Code rules:** no `console.log` in `src/` (use `app.log`); comment the *why*; Polaris components only in `apps/shopify`; no raw `<select>`; no npm/yarn lockfiles.
- **Production safety:** `pnpm db:generate` and `pnpm db:migrate` run **locally only**. Production receives the migration through CI's `db:migrate:prod`.
- **Tests:** unit tests run with `pnpm --filter @aivastra/api test`. Integration tests need `pnpm docker:up` and run from `apps/api` with `npx vitest run --config vitest.integration.config.ts <pattern>`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/db/src/schema/shopify.ts` | modify | three columns plus the partial index on `shopifyCreditPurchases` |
| `packages/db/src/migrations/0219_*.sql` (+ meta) | generate | the migration |
| `packages/observability/src/metrics.ts` | modify | three payment-check metrics |
| `apps/api/src/env.ts` | modify | the flag and the Partner API config |
| `.env.production.example`, `.env.example` | modify | document the new vars |
| `apps/api/src/modules/shopify/partner-api.ts` | create | Partner API client: `fetchOneTimeSales`, `numericChargeId`, `PartnerApiError` |
| `apps/api/src/modules/shopify/payment-settlement.ts` | create | `nextCheckAt`, `settlePaid`, `checkPurchases` |
| `apps/api/src/modules/shopify/payment-settlement-scheduler.ts` | create | `runPaymentSettlementTick`, `startPaymentSettlementScheduler` |
| `apps/api/src/main.ts` | modify | start the scheduler |
| `apps/api/src/modules/shopify/purchase.ts` | modify | hold in `grantForPurchase`; on-demand check plus `paymentStatus` in `confirmPurchase` |
| `apps/api/src/modules/shopify/purchase.routes.ts` | modify | `GET /v1/shopify/billing/purchases/pending` |
| `apps/api/src/modules/admin/shopify-stores.routes.ts` | modify | purchase list and admin check-payment routes |
| `apps/admin-web/src/components/StorePurchasesCard.tsx` | create | per-store purchases table with a Check payment button |
| `apps/admin-web/src/pages/ShopifyStoresPage.tsx` | modify | render the card in both layouts |
| `apps/admin-web/src/types.ts` | modify | `StorePurchase` type |
| `apps/shopify/src/types.ts` | modify | `PurchaseConfirmResponse`, `PendingPurchase` |
| `apps/shopify/src/pages/BillingCallbackPage.tsx` | modify | poll, then hand off |
| `apps/shopify/src/components/PendingPaymentBanner.tsx` | create | the pending/unpaid banner |
| `apps/shopify/src/pages/DashboardPage.tsx`, `PricingPage.tsx` | modify | render the banner; "credits added" toast |
| `apps/api/test/shopify-partner-api.test.ts` | create | unit tests for the client |
| `apps/api/test/shopify-payment-schedule.test.ts` | create | unit tests for `nextCheckAt` |
| `apps/api/test/integration/shopify-payment-settlement.test.ts` | create | integration tests for settlement, the tick, confirm, routes |
| `CLAUDE.md`, `docs/progress.md` | modify | loop table, env table, rollout record |

---

### Task 1: Schema, migration, env and metrics

**Files:**
- Modify: `packages/db/src/schema/shopify.ts:243-270`
- Generate: `packages/db/src/migrations/0219_<generated>.sql` and `meta/0219_snapshot.json`, `meta/_journal.json`
- Modify: `apps/api/src/env.ts:93`
- Modify: `packages/observability/src/metrics.ts` (end of the "API metrics" section)
- Modify: `.env.production.example:191`, `.env.example`

**Interfaces:**
- Produces:
  - `schema.shopifyCreditPurchases.paymentStatus` (`string`, default `'NOT_REQUIRED'`)
  - `.paidAt` (`Date | null`)
  - `.nextPaymentCheckAt` (`Date | null`)
  - `Env.SHOPIFY_HOLD_UNTIL_PAID: boolean`
  - `Env.SHOPIFY_PARTNER_API_TOKEN?: string`
  - `Env.SHOPIFY_PARTNER_ORG_ID?: string`
  - metrics `shopifyPaymentCheckFailuresTotal` (Counter, label `reason`), `shopifyPaymentCheckLastSuccess` (Gauge), `shopifyPurchasesAwaitingPayment` (Gauge)

- [ ] **Step 1: Add the columns and partial index to the schema**

In `packages/db/src/schema/shopify.ts`, inside `shopifyCreditPurchases`, add after the `status` column:

```ts
    // Ours, not Shopify's — `status` above mirrors the charge, this tracks
    // whether the money was actually collected. ACTIVE means invoiced, not
    // paid: on 2026-10-09 two ACTIVE $1 charges both granted while one invoice
    // had Failed. 'NOT_REQUIRED' | 'AWAITING' | 'PAID' | 'UNPAID'. Only a
    // manual, non-test charge under SHOPIFY_HOLD_UNTIL_PAID ever leaves
    // NOT_REQUIRED; see payment-settlement.ts.
    paymentStatus: text('payment_status').notNull().default('NOT_REQUIRED'),
    // The Partner API AppOneTimeSale's createdAt — when Shopify recorded payment.
    paidAt: timestamp('paid_at', { withTimezone: true }),
    // Next settlement-loop check. Non-null only while AWAITING.
    nextPaymentCheckAt: timestamp('next_payment_check_at', { withTimezone: true }),
```

and in the table's index callback, add after `storeIdx`:

```ts
    // Partial: the settlement loop only ever asks "which AWAITING rows are due",
    // and AWAITING rows are a vanishing fraction of purchase history.
    awaitingPaymentIdx: index('shopify_credit_purchases_awaiting_payment_idx')
      .on(table.nextPaymentCheckAt)
      .where(sql`${table.paymentStatus} = 'AWAITING'`),
```

`sql` is already imported at the top of this file (`import { sql } from 'drizzle-orm';`).

- [ ] **Step 2: Generate the migration (local only)**

Run: `pnpm db:generate`
Expected: a new `packages/db/src/migrations/0219_<name>.sql` containing three `ALTER TABLE "shopify_credit_purchases" ADD COLUMN …` statements and
`CREATE INDEX IF NOT EXISTS "shopify_credit_purchases_awaiting_payment_idx" ON "shopify_credit_purchases" USING btree ("next_payment_check_at") WHERE "shopify_credit_purchases"."payment_status" = 'AWAITING';`.
Open the file and confirm it contains nothing else. If it does, stop and investigate rather than editing the snapshot.

- [ ] **Step 3: Apply it locally**

Run: `pnpm db:migrate`
Expected: `Applied 0219_<name>` and `Done: 1 applied`.

- [ ] **Step 4: Add the env vars**

In `apps/api/src/env.ts`, after the `SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS` line (93), add:

```ts
  // Grant credit packs only once the Partner API shows the charge was PAID,
  // not when it goes ACTIVE (= invoiced). Same literal-'true' pattern as
  // SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS: it gates revenue, so anything but the
  // exact string stays off. See docs/superpowers/specs/2026-10-09-shopify-hold-until-paid-design.md.
  SHOPIFY_HOLD_UNTIL_PAID: z.preprocess((v) => v === 'true', z.boolean()).default(false),
  // Partner API client token ("View financials" only) — org-scoped, a secret.
  // Use a separate client per environment: the 4 req/s limit is per client.
  SHOPIFY_PARTNER_API_TOKEN: z.string().min(1).optional(),
  // Numeric Partner org id from partners.shopify.com/<ORG_ID>/… — not secret.
  SHOPIFY_PARTNER_ORG_ID: z.string().regex(/^\d+$/).optional(),
```

- [ ] **Step 5: Document them**

In `.env.production.example`, after `SHOPIFY_ALLOW_TEST_SUBSCRIPTIONS=` (line 191), add:

```
# Grant credit packs only once Shopify has actually COLLECTED payment (Partner API
# AppOneTimeSale), not when the charge goes ACTIVE (invoiced). Only the literal 'true'
# enables it. Needs both SHOPIFY_PARTNER_* below; without them purchases stay pending.
SHOPIFY_HOLD_UNTIL_PAID=
# Partner Dashboard → Settings → Partner API clients, permission "View financials" only.
# Secret. One client per environment (rate limit is per client).
SHOPIFY_PARTNER_API_TOKEN=
SHOPIFY_PARTNER_ORG_ID=           # number in partners.shopify.com/<ORG_ID>/…
```

Append the same three lines, without the comments, to the Shopify section of `.env.example`.

- [ ] **Step 6: Add the metrics**

In `packages/observability/src/metrics.ts`, after `auditLogWriteFailuresTotal`, add:

```ts
export const shopifyPaymentCheckFailuresTotal = new Counter({
  name: 'shopify_payment_check_failures_total',
  help: 'Partner API payment checks that failed, by reason (missing_config/http/graphql/rate_limited)',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const shopifyPaymentCheckLastSuccess = new Gauge({
  name: 'shopify_payment_check_last_success_timestamp',
  help: 'Unix seconds of the last successful Partner API payment check',
  registers: [register],
});

export const shopifyPurchasesAwaitingPayment = new Gauge({
  name: 'shopify_purchases_awaiting_payment',
  help: 'Credit-pack purchases ACTIVE at Shopify but not yet seen as paid',
  registers: [register],
});
```

- [ ] **Step 7: Build and typecheck**

Run: `pnpm --filter @aivastra/db --filter @aivastra/observability build && pnpm --filter @aivastra/api typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/shopify.ts packages/db/src/migrations packages/observability/src/metrics.ts apps/api/src/env.ts .env.production.example .env.example
git commit -m "feat(shopify): payment_status columns, hold-until-paid env and metrics"
```

---

### Task 2: Partner API client

**Files:**
- Create: `apps/api/src/modules/shopify/partner-api.ts`
- Test: `apps/api/test/shopify-partner-api.test.ts`

**Interfaces:**
- Consumes: `Env` fields from Task 1.
- Produces:
  ```ts
  export type PartnerApiFailure = 'missing_config' | 'http' | 'graphql' | 'rate_limited';
  export class PartnerApiError extends Error { readonly reason: PartnerApiFailure }
  export interface OneTimeSale { paidAt: Date }
  export type PartnerApiEnv = Pick<Env, 'SHOPIFY_PARTNER_API_TOKEN' | 'SHOPIFY_PARTNER_ORG_ID'>;
  export type FetchOneTimeSales = (env: PartnerApiEnv, args: { since: Date; shop?: string }) => Promise<Map<string, OneTimeSale>>;
  export function numericChargeId(id: string): string;
  export const fetchOneTimeSales: FetchOneTimeSales;
  ```
  The map key is the numeric charge id.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/shopify-partner-api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOneTimeSales,
  numericChargeId,
  PartnerApiError,
} from '../src/modules/shopify/partner-api.js';

const env = { SHOPIFY_PARTNER_API_TOKEN: 'tok', SHOPIFY_PARTNER_ORG_ID: '1234567' };
const since = new Date('2026-10-08T00:00:00Z');

function page(nodes: unknown[], hasNextPage = false) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        transactions: {
          edges: nodes.map((node, i) => ({ cursor: `c${i}`, node })),
          pageInfo: { hasNextPage },
        },
      },
    }),
    text: async () => '',
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('numericChargeId', () => {
  it('strips a gid down to its number', () => {
    expect(numericChargeId('gid://shopify/AppPurchaseOneTime/3321168113')).toBe('3321168113');
  });
  it('leaves a bare number alone', () => {
    expect(numericChargeId('3321168113')).toBe('3321168113');
  });
});

describe('fetchOneTimeSales', () => {
  it('throws missing_config without a token or org id, and never calls fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      fetchOneTimeSales({ SHOPIFY_PARTNER_API_TOKEN: undefined, SHOPIFY_PARTNER_ORG_ID: '1' }, { since }),
    ).rejects.toMatchObject({ reason: 'missing_config' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps sales by numeric charge id and sends the token header to the org endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      page([
        { id: 't1', createdAt: '2026-10-09T06:39:29Z', chargeId: 'gid://shopify/AppPurchaseOneTime/3321168113' },
        { id: 't2', createdAt: '2026-10-09T07:00:00Z', chargeId: null },
      ]),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const sales = await fetchOneTimeSales(env, { since, shop: 'x.myshopify.com' });

    expect(sales.get('3321168113')?.paidAt.toISOString()).toBe('2026-10-09T06:39:29.000Z');
    expect(sales.size).toBe(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://partners.shopify.com/1234567/api/2026-10/graphql.json');
    expect(init.headers['X-Shopify-Access-Token']).toBe('tok');
    const body = JSON.parse(init.body);
    expect(body.variables).toMatchObject({
      types: ['APP_ONE_TIME_SALE'],
      shop: 'x.myshopify.com',
      since: '2026-10-08T00:00:00.000Z',
    });
  });

  it('follows pagination with the last cursor', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: 'a', createdAt: '2026-10-09T00:00:00Z', chargeId: '1' }], true))
      .mockResolvedValueOnce(page([{ id: 'b', createdAt: '2026-10-09T00:00:00Z', chargeId: '2' }]));
    vi.stubGlobal('fetch', fetchSpy);

    const sales = await fetchOneTimeSales(env, { since });

    expect([...sales.keys()].sort()).toEqual(['1', '2']);
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).variables.after).toBe('c0');
  });

  it('throws rate_limited on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
    await expect(fetchOneTimeSales(env, { since })).rejects.toMatchObject({ reason: 'rate_limited' });
  });

  it('throws http on other non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'nope' }));
    await expect(fetchOneTimeSales(env, { since })).rejects.toMatchObject({ reason: 'http' });
  });

  it('throws http when fetch itself rejects (network/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(fetchOneTimeSales(env, { since })).rejects.toBeInstanceOf(PartnerApiError);
  });

  it('throws graphql on a GraphQL errors array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ errors: [{ message: 'Access denied' }] }),
        text: async () => '',
      }),
    );
    await expect(fetchOneTimeSales(env, { since })).rejects.toMatchObject({ reason: 'graphql' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-partner-api.test.ts`
Expected: FAIL, because `../src/modules/shopify/partner-api.js` cannot be resolved.

- [ ] **Step 3: Implement the client**

Create `apps/api/src/modules/shopify/partner-api.ts`:

```ts
import type { Env } from '../../env.js';

/**
 * The only programmatic signal that Shopify actually COLLECTED a one-time
 * charge. The Admin API's AppPurchaseOneTime.status stops at ACTIVE, which
 * means "approved and invoiced" — collection happens afterwards and can fail
 * (seen on production 2026-10-09). An AppOneTimeSale transaction is recorded
 * only once the merchant has paid, and carries the charge id.
 *
 * Partner API, not Admin API: org-scoped token ("View financials" only),
 * 4 req/s per client. The token is never logged.
 */

const API_VERSION = '2026-10';
const PAGE_DELAY_MS = 300;
const TIMEOUT_MS = 15_000;

export type PartnerApiFailure = 'missing_config' | 'http' | 'graphql' | 'rate_limited';

export class PartnerApiError extends Error {
  constructor(
    readonly reason: PartnerApiFailure,
    message: string,
  ) {
    super(message);
    this.name = 'PartnerApiError';
  }
}

export interface OneTimeSale {
  paidAt: Date;
}

export type PartnerApiEnv = Pick<Env, 'SHOPIFY_PARTNER_API_TOKEN' | 'SHOPIFY_PARTNER_ORG_ID'>;

export type FetchOneTimeSales = (
  env: PartnerApiEnv,
  args: { since: Date; shop?: string },
) => Promise<Map<string, OneTimeSale>>;

/**
 * The Admin API hands us a gid (gid://shopify/AppPurchaseOneTime/N) and the
 * Partner API may format the same charge differently, so both sides are
 * compared on the trailing number only.
 */
export function numericChargeId(id: string): string {
  return id.split('/').pop() ?? id;
}

const QUERY = `
  query OneTimeSales($types: [TransactionType!], $shop: String, $since: DateTime, $after: String) {
    transactions(first: 100, types: $types, myshopifyDomain: $shop, createdAtMin: $since, after: $after) {
      edges {
        cursor
        node {
          id
          createdAt
          ... on AppOneTimeSale { chargeId }
        }
      }
      pageInfo { hasNextPage }
    }
  }
`;

interface SaleNode {
  id: string;
  createdAt: string;
  chargeId?: string | null;
}

export const fetchOneTimeSales: FetchOneTimeSales = async (env, { since, shop }) => {
  const token = env.SHOPIFY_PARTNER_API_TOKEN;
  const orgId = env.SHOPIFY_PARTNER_ORG_ID;
  if (!token || !orgId) {
    throw new PartnerApiError(
      'missing_config',
      'SHOPIFY_PARTNER_API_TOKEN and SHOPIFY_PARTNER_ORG_ID must both be set',
    );
  }

  const endpoint = `https://partners.shopify.com/${orgId}/api/${API_VERSION}/graphql.json`;
  const sales = new Map<string, OneTimeSale>();
  let after: string | undefined;

  for (;;) {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({
          query: QUERY,
          variables: { types: ['APP_ONE_TIME_SALE'], shop, since: since.toISOString(), after },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new PartnerApiError('http', `Partner API request failed: ${(err as Error).message}`);
    }
    if (res.status === 429) throw new PartnerApiError('rate_limited', 'Partner API rate limited');
    if (!res.ok) {
      // Shopify's error text, never our token.
      throw new PartnerApiError('http', `Partner API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const body = (await res.json()) as {
      data?: {
        transactions: {
          edges: Array<{ cursor: string; node: SaleNode }>;
          pageInfo: { hasNextPage: boolean };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length || !body.data) {
      throw new PartnerApiError(
        'graphql',
        `Partner API errors: ${(body.errors ?? []).map((e) => e.message).join('; ') || 'no data'}`,
      );
    }

    const { edges, pageInfo } = body.data.transactions;
    for (const { node } of edges) {
      // chargeId is null for sales before September 2020 — nothing to match.
      if (node.chargeId) {
        sales.set(numericChargeId(node.chargeId), { paidAt: new Date(node.createdAt) });
      }
    }
    if (!pageInfo.hasNextPage || edges.length === 0) break;
    after = edges[edges.length - 1].cursor;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  return sales;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-partner-api.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shopify/partner-api.ts apps/api/test/shopify-partner-api.test.ts
git commit -m "feat(shopify): Partner API client for one-time sale lookups"
```

---

### Task 3: Settlement module

**Files:**
- Create: `apps/api/src/modules/shopify/payment-settlement.ts`
- Test: `apps/api/test/shopify-payment-schedule.test.ts` (unit)
- Test: `apps/api/test/integration/shopify-payment-settlement.test.ts` (integration; later tasks append to this file)

**Interfaces:**
- Consumes: `fetchOneTimeSales`, `FetchOneTimeSales`, `numericChargeId`, `PartnerApiError` (Task 2); `grantStore(db, storeId, amount, reason, externalRef)` from `../credits/shopify-ledger.js`; the metrics from Task 1.
- Produces:
  ```ts
  export type PaymentStatus = 'NOT_REQUIRED' | 'AWAITING' | 'PAID' | 'UNPAID';
  export const PARK_AFTER_MS: number; // 30 days
  export function nextCheckAt(createdAt: Date, now: Date): Date | null; // null = park
  export async function settlePaid(db: DB, row: PurchaseRow, paidAt: Date,
    onSettled?: (tx: DbTransaction, row: PurchaseRow) => Promise<void>): Promise<boolean>;
  export interface CheckOptions { shop?: string; fetchSales?: FetchOneTimeSales; now?: Date;
    onSettled?: (tx: DbTransaction, row: PurchaseRow) => Promise<void> }
  export async function checkPurchases(app: FastifyInstance, rows: PurchaseRow[],
    opts?: CheckOptions): Promise<Map<string, PaymentStatus>>; // keyed by purchase id; throws PartnerApiError
  ```

- [ ] **Step 1: Write the failing unit tests for `nextCheckAt`**

Create `apps/api/test/shopify-payment-schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nextCheckAt } from '../src/modules/shopify/payment-settlement.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const created = new Date('2026-10-01T00:00:00Z');
const at = (ms: number) => new Date(created.getTime() + ms);

describe('nextCheckAt', () => {
  it('checks every minute for the first 15 minutes', () => {
    expect(nextCheckAt(created, at(14 * MIN))?.getTime()).toBe(at(15 * MIN).getTime());
  });
  it('checks every 15 minutes until 24 hours', () => {
    expect(nextCheckAt(created, at(15 * MIN))?.getTime()).toBe(at(30 * MIN).getTime());
    expect(nextCheckAt(created, at(23 * HOUR))?.getTime()).toBe(at(23 * HOUR + 15 * MIN).getTime());
  });
  it('checks hourly from 24 hours to 7 days', () => {
    expect(nextCheckAt(created, at(DAY))?.getTime()).toBe(at(DAY + HOUR).getTime());
  });
  it('checks daily from 7 to 30 days', () => {
    expect(nextCheckAt(created, at(7 * DAY))?.getTime()).toBe(at(8 * DAY).getTime());
  });
  it('returns null (park) at 30 days', () => {
    expect(nextCheckAt(created, at(30 * DAY))).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-payment-schedule.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement the settlement module**

Create `apps/api/src/modules/shopify/payment-settlement.ts`:

```ts
import { type DB, type DbTransaction, schema } from '@aivastra/db';
import {
  shopifyPaymentCheckFailuresTotal,
  shopifyPaymentCheckLastSuccess,
} from '@aivastra/observability';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { grantStore } from '../credits/shopify-ledger.js';
import {
  type FetchOneTimeSales,
  fetchOneTimeSales,
  numericChargeId,
  PartnerApiError,
} from './partner-api.js';

/**
 * Hold-until-paid settlement: turns an AWAITING purchase into PAID + credits
 * once the Partner API shows Shopify collected the money. Shared by the 60 s
 * loop, the merchant's confirm route and the admin "Check payment" action.
 * Spec: docs/superpowers/specs/2026-10-09-shopify-hold-until-paid-design.md.
 */

type PurchaseRow = typeof schema.shopifyCreditPurchases.$inferSelect;
export type PaymentStatus = 'NOT_REQUIRED' | 'AWAITING' | 'PAID' | 'UNPAID';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const PARK_AFTER_MS = 30 * DAY;

/** Slack on `since` so clock skew between us and Shopify can't hide a sale. */
const SINCE_SLACK_MS = HOUR;

/**
 * Backoff measured from the purchase's createdAt: most payments land within
 * minutes, a failed one may be paid days later from the merchant's billing
 * page. Returns null once the purchase is 30 days old — the caller parks it.
 */
export function nextCheckAt(createdAt: Date, now: Date): Date | null {
  const age = now.getTime() - createdAt.getTime();
  if (age >= PARK_AFTER_MS) return null;
  const step = age < 15 * MIN ? MIN : age < DAY ? 15 * MIN : age < 7 * DAY ? HOUR : DAY;
  return new Date(now.getTime() + step);
}

/**
 * Marks the purchase PAID and grants its snapshotted credits in ONE
 * transaction. The conditional UPDATE is the race guard: whichever of loop,
 * confirm or admin gets there first flips the row and grants; everyone else
 * gets zero rows back and grants nothing. grantStore's external_ref
 * idempotency stays underneath as the second guard.
 */
export async function settlePaid(
  db: DB,
  row: PurchaseRow,
  paidAt: Date,
  onSettled?: (tx: DbTransaction, row: PurchaseRow) => Promise<void>,
): Promise<boolean> {
  if (!row.shopifyChargeId) return false;
  const chargeId = row.shopifyChargeId;
  return db.transaction(async (tx) => {
    const flipped = await tx
      .update(schema.shopifyCreditPurchases)
      .set({ paymentStatus: 'PAID', paidAt, nextPaymentCheckAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.shopifyCreditPurchases.id, row.id),
          inArray(schema.shopifyCreditPurchases.paymentStatus, ['AWAITING', 'UNPAID']),
        ),
      )
      .returning({ id: schema.shopifyCreditPurchases.id });
    if (flipped.length === 0) return false;

    // Same reason and ref the grant-on-ACTIVE path always used, so a purchase
    // reads identically in the ledger whichever path granted it.
    await grantStore(tx as never, row.storeId, row.credits, 'SHOPIFY_PACK', `shopify_pack:${chargeId}`);
    if (onSettled) await onSettled(tx as never, row);
    return true;
  });
}

export interface CheckOptions {
  /** Narrows the Partner API query to one store — used by single-purchase checks. */
  shop?: string;
  fetchSales?: FetchOneTimeSales;
  now?: Date;
  onSettled?: (tx: DbTransaction, row: PurchaseRow) => Promise<void>;
}

/**
 * One Partner API query for all `rows`, then settle / reschedule / park each.
 * Throws PartnerApiError on any API failure WITHOUT touching a row — fail
 * closed: our outage must never grant, park, or push a check later.
 */
export async function checkPurchases(
  app: FastifyInstance,
  rows: PurchaseRow[],
  opts: CheckOptions = {},
): Promise<Map<string, PaymentStatus>> {
  const outcome = new Map<string, PaymentStatus>();
  const checkable = rows.filter((r) => r.shopifyChargeId);
  if (checkable.length === 0) return outcome;

  const now = opts.now ?? new Date();
  const fetchSales = opts.fetchSales ?? fetchOneTimeSales;
  const oldest = Math.min(...checkable.map((r) => r.createdAt.getTime()));

  let sales: Awaited<ReturnType<FetchOneTimeSales>>;
  try {
    sales = await fetchSales(app.env, {
      since: new Date(oldest - SINCE_SLACK_MS),
      shop: opts.shop,
    });
  } catch (err) {
    const reason = err instanceof PartnerApiError ? err.reason : 'http';
    shopifyPaymentCheckFailuresTotal.inc({ reason });
    throw err instanceof PartnerApiError ? err : new PartnerApiError('http', String(err));
  }
  shopifyPaymentCheckLastSuccess.set(Math.floor(now.getTime() / 1000));

  for (const row of checkable) {
    try {
      const sale = sales.get(numericChargeId(row.shopifyChargeId as string));
      if (sale) {
        await settlePaid(app.db, row, sale.paidAt, opts.onSettled);
        outcome.set(row.id, 'PAID');
        continue;
      }
      // An UNPAID row stays UNPAID until a sale appears — no rescheduling.
      if (row.paymentStatus === 'UNPAID') {
        outcome.set(row.id, 'UNPAID');
        continue;
      }
      const next = nextCheckAt(row.createdAt, now);
      await app.db
        .update(schema.shopifyCreditPurchases)
        .set(
          next
            ? { nextPaymentCheckAt: next, updatedAt: now }
            : { paymentStatus: 'UNPAID', nextPaymentCheckAt: null, updatedAt: now },
        )
        .where(
          and(
            eq(schema.shopifyCreditPurchases.id, row.id),
            eq(schema.shopifyCreditPurchases.paymentStatus, 'AWAITING'),
          ),
        );
      outcome.set(row.id, next ? 'AWAITING' : 'UNPAID');
    } catch (err) {
      // One row's DB failure must not abandon the rest of the batch.
      app.log.error({ err, purchaseId: row.id }, 'payment settlement failed for purchase');
    }
  }
  return outcome;
}
```

If `DB` or `DbTransaction` is not exported by `@aivastra/db`, run `grep -n "export type DB\|DbTransaction" packages/db/src/index.ts` and import from where it actually lives. `shopify-ledger.ts` already imports `type DB` from `@aivastra/db`, and `admin/audit.ts` imports `type DbTransaction` from it.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-payment-schedule.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing integration tests**

Create `apps/api/test/integration/shopify-payment-settlement.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PartnerApiError } from '../../src/modules/shopify/partner-api.js';
import { checkPurchases, settlePaid } from '../../src/modules/shopify/payment-settlement.js';
import { buildTestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

let ctx: Containers;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let store: typeof schema.shopifyStores.$inferSelect;
let seq = 0;

type Row = typeof schema.shopifyCreditPurchases.$inferSelect;

async function awaitingPurchase(overrides: Partial<Row> = {}): Promise<Row> {
  seq += 1;
  const [row] = await app.db
    .insert(schema.shopifyCreditPurchases)
    .values({
      storeId: store.id,
      packId: 'pack_10',
      credits: 800,
      priceUsdCents: 1000,
      status: 'ACTIVE',
      shopifyChargeId: `gid://shopify/AppPurchaseOneTime/${9000 + seq}`,
      paymentStatus: 'AWAITING',
      nextPaymentCheckAt: new Date(),
      ...overrides,
    })
    .returning();
  return row;
}

async function ledgerFor(row: Row) {
  return app.db
    .select()
    .from(schema.shopifyCreditLedger)
    .where(
      and(
        eq(schema.shopifyCreditLedger.storeId, store.id),
        eq(schema.shopifyCreditLedger.externalRef, `shopify_pack:${row.shopifyChargeId}`),
      ),
    );
}

async function reload(row: Row): Promise<Row> {
  const [fresh] = await app.db
    .select()
    .from(schema.shopifyCreditPurchases)
    .where(eq(schema.shopifyCreditPurchases.id, row.id));
  return fresh;
}

const saleFor = (row: Row, paidAt = new Date('2026-10-09T06:39:29Z')) => async () =>
  new Map([[(row.shopifyChargeId as string).split('/').pop() as string, { paidAt }]]);
const noSales = async () => new Map();

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
  [store] = await app.db
    .insert(schema.shopifyStores)
    .values({
      shopDomain: 'settle-test.myshopify.com',
      shopifyShopId: 555000111,
      accessToken: 'enc:token',
      scope: 'read_products',
    })
    .returning();
}, 60000);

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('payment settlement', () => {
  it('a matching sale marks PAID, sets paid_at and grants exactly once', async () => {
    const row = await awaitingPurchase();
    const result = await checkPurchases(app, [row], { fetchSales: saleFor(row) });

    expect(result.get(row.id)).toBe('PAID');
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('PAID');
    expect(fresh.paidAt?.toISOString()).toBe('2026-10-09T06:39:29.000Z');
    expect(fresh.nextPaymentCheckAt).toBeNull();
    const ledger = await ledgerFor(row);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 800, reason: 'SHOPIFY_PACK' });
  });

  it('two concurrent settlements grant once', async () => {
    const row = await awaitingPurchase();
    const results = await Promise.all([
      settlePaid(app.db, row, new Date()),
      settlePaid(app.db, row, new Date()),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await ledgerFor(row)).toHaveLength(1);
  });

  it('no sale reschedules a young purchase and grants nothing', async () => {
    const row = await awaitingPurchase();
    const now = new Date(row.createdAt.getTime() + 60_000);
    const result = await checkPurchases(app, [row], { fetchSales: noSales, now });

    expect(result.get(row.id)).toBe('AWAITING');
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('AWAITING');
    expect(fresh.nextPaymentCheckAt?.getTime()).toBe(now.getTime() + 60_000);
    expect(await ledgerFor(row)).toHaveLength(0);
  });

  it('no sale after 30 days parks the purchase as UNPAID', async () => {
    const row = await awaitingPurchase({ createdAt: new Date(Date.now() - 31 * 86_400_000) });
    const result = await checkPurchases(app, [row], { fetchSales: noSales });

    expect(result.get(row.id)).toBe('UNPAID');
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('UNPAID');
    expect(fresh.nextPaymentCheckAt).toBeNull();
  });

  it('a parked UNPAID purchase still settles when a sale appears later', async () => {
    const row = await awaitingPurchase({ paymentStatus: 'UNPAID', nextPaymentCheckAt: null });
    await checkPurchases(app, [row], { fetchSales: saleFor(row) });
    expect((await reload(row)).paymentStatus).toBe('PAID');
    expect(await ledgerFor(row)).toHaveLength(1);
  });

  it('a Partner API failure leaves the row untouched (fail closed) and rethrows', async () => {
    const row = await awaitingPurchase({ createdAt: new Date(Date.now() - 31 * 86_400_000) });
    const before = await reload(row);
    await expect(
      checkPurchases(app, [row], {
        fetchSales: async () => {
          throw new PartnerApiError('http', 'down');
        },
      }),
    ).rejects.toBeInstanceOf(PartnerApiError);

    const after = await reload(row);
    expect(after.paymentStatus).toBe('AWAITING'); // not parked despite age
    expect(after.nextPaymentCheckAt?.getTime()).toBe(before.nextPaymentCheckAt?.getTime());
    expect(await ledgerFor(row)).toHaveLength(0);
  });

  it('missing Partner config fails closed', async () => {
    // buildTestApp sets no SHOPIFY_PARTNER_*, so the real client throws missing_config.
    const row = await awaitingPurchase();
    await expect(checkPurchases(app, [row])).rejects.toMatchObject({ reason: 'missing_config' });
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
  });
});
```

- [ ] **Step 6: Run the integration tests**

Run (from `apps/api`, with `pnpm docker:up` running): `npx vitest run --config vitest.integration.config.ts shopify-payment-settlement`
Expected: PASS (7 tests). If the test DB template predates migration 0219, rerun after `pnpm db:migrate`, since the harness migrates fresh databases itself.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/shopify/payment-settlement.ts apps/api/test/shopify-payment-schedule.test.ts apps/api/test/integration/shopify-payment-settlement.test.ts
git commit -m "feat(shopify): settle credit-pack purchases against Partner API sales"
```

---

### Task 4: Hold in `grantForPurchase`

**Files:**
- Modify: `apps/api/src/modules/shopify/purchase.ts:243-326`
- Test: `apps/api/test/integration/shopify-payment-settlement.test.ts` (append)

**Interfaces:**
- Consumes: `paymentStatus` and `nextPaymentCheckAt` columns (Task 1); `Env.SHOPIFY_HOLD_UNTIL_PAID`.
- Produces: `grantForPurchase(app, store, purchaseRow, observed)` — same signature.
  - With the flag on and a non-test `ACTIVE` charge, it returns `0` and leaves the row `AWAITING`, with `nextPaymentCheckAt = now`.
  - Whatever the flag, a row whose `paymentStatus` is not `'NOT_REQUIRED'` is never granted here.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/integration/shopify-payment-settlement.test.ts`. Add `grantForPurchase` to the imports at the top: `import { grantForPurchase } from '../../src/modules/shopify/purchase.js';`.

```ts
describe('grantForPurchase with SHOPIFY_HOLD_UNTIL_PAID', () => {
  const active = (row: Row, test = false) => ({
    id: row.shopifyChargeId as string,
    status: 'ACTIVE',
    test,
  });

  async function freshRow(): Promise<Row> {
    return awaitingPurchase({ paymentStatus: 'NOT_REQUIRED', nextPaymentCheckAt: null });
  }

  it('flag on: a real ACTIVE charge becomes AWAITING and grants nothing', async () => {
    const holdApp = Object.assign(Object.create(app), {
      env: { ...app.env, SHOPIFY_HOLD_UNTIL_PAID: true },
    });
    const row = await freshRow();
    const granted = await grantForPurchase(holdApp, store, row, active(row));

    expect(granted).toBe(0);
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('AWAITING');
    expect(fresh.nextPaymentCheckAt).not.toBeNull();
    expect(await ledgerFor(row)).toHaveLength(0);
  });

  it('flag on: a replay on an already-PAID row is a no-op', async () => {
    const holdApp = Object.assign(Object.create(app), {
      env: { ...app.env, SHOPIFY_HOLD_UNTIL_PAID: true },
    });
    const row = await awaitingPurchase({ paymentStatus: 'PAID', nextPaymentCheckAt: null });
    expect(await grantForPurchase(holdApp, store, row, active(row))).toBe(0);
    expect((await reload(row)).paymentStatus).toBe('PAID');
  });

  it('flag on: a row already granted before the flag stays NOT_REQUIRED', async () => {
    const row = await freshRow();
    // Granted under the old behaviour (flag off) first…
    expect(await grantForPurchase(app, store, row, active(row))).toBe(800);
    const holdApp = Object.assign(Object.create(app), {
      env: { ...app.env, SHOPIFY_HOLD_UNTIL_PAID: true },
    });
    // …then a confirm revisit after the flag flipped must not pull it into AWAITING.
    expect(await grantForPurchase(holdApp, store, row, active(row))).toBe(0);
    expect((await reload(row)).paymentStatus).toBe('NOT_REQUIRED');
  });

  it('flag off: behaviour is unchanged — grants on ACTIVE', async () => {
    const row = await freshRow();
    expect(await grantForPurchase(app, store, row, active(row))).toBe(800);
    expect((await reload(row)).paymentStatus).toBe('NOT_REQUIRED');
  });

  it('flag off (rollback): a row already AWAITING is never granted on ACTIVE', async () => {
    const row = await awaitingPurchase();
    expect(await grantForPurchase(app, store, row, active(row))).toBe(0);
    expect(await ledgerFor(row)).toHaveLength(0);
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
  });
});
```

`Object.create(app)` gives a prototype-linked app whose `env` is overridden while `db` and `log` resolve to the real app. `grantForPurchase` reads only `app.env`, `app.db` and `app.log`.

- [ ] **Step 2: Run them to verify the first test fails**

Run: `npx vitest run --config vitest.integration.config.ts shopify-payment-settlement -t "grantForPurchase"`
Expected: "flag on: a real ACTIVE charge becomes AWAITING" FAILS, because `granted` is 800 rather than 0.

- [ ] **Step 3: Implement the hold**

In `apps/api/src/modules/shopify/purchase.ts` (which already imports `and`, `eq` and `sql` from drizzle-orm), directly after the line `if (observed.status !== 'ACTIVE') return 0;` (line 278), insert:

```ts
  // Hold-until-paid: ACTIVE on a one-time charge means invoiced, not paid —
  // Shopify collects afterwards and collection can fail (2026-10-09: two
  // ACTIVE charges, one invoice Failed, both granted). So a real charge is
  // parked AWAITING here and granted by payment-settlement.ts once the Partner
  // API shows the sale. Test charges never produce a sale, so they keep the
  // grant-on-ACTIVE path below. `=== true`: a revenue gate must read as off
  // for anything but explicit true (tests cast Env and leave it undefined).
  // Once held, always held — independent of the flag. Turning the flag off is
  // the rollback, and without this a confirm revisit on an AWAITING row would
  // fall through to grant-on-ACTIVE below and hand out unpaid credits. Rows
  // already held settle only through payment-settlement.ts.
  if (purchaseRow.paymentStatus !== 'NOT_REQUIRED') return 0;

  if (!observed.test && app.env.SHOPIFY_HOLD_UNTIL_PAID === true) {
    // A purchase already granted before the flag flipped (confirm revisited,
    // webhook replayed) must not be pulled into AWAITING — it would show a
    // pending banner for credits the merchant already has.
    const [already] = await app.db
      .select({ id: schema.shopifyCreditLedger.id })
      .from(schema.shopifyCreditLedger)
      .where(eq(schema.shopifyCreditLedger.externalRef, `shopify_pack:${observed.id}`))
      .limit(1);
    if (already) return 0;

    // Conditional on NOT_REQUIRED, so a replayed webhook can never drag a
    // PAID or UNPAID row back to AWAITING.
    await app.db
      .update(schema.shopifyCreditPurchases)
      .set({ paymentStatus: 'AWAITING', nextPaymentCheckAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.shopifyCreditPurchases.id, purchaseRow.id),
          eq(schema.shopifyCreditPurchases.paymentStatus, 'NOT_REQUIRED'),
        ),
      );
    return 0;
  }
```

Then update the function's docstring first line from `Grants credits for a purchase Shopify says is ACTIVE.` to:

```ts
 * Grants credits for a purchase Shopify says is ACTIVE — or, under
 * SHOPIFY_HOLD_UNTIL_PAID, parks a real (non-test) one as AWAITING payment.
```

- [ ] **Step 4: Run all purchase tests**

Run: `npx vitest run --config vitest.integration.config.ts shopify-payment-settlement shopify-purchase`
Expected: PASS. The existing `shopify-purchase.test.ts` tests run with the flag unset and must remain green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shopify/purchase.ts apps/api/test/integration/shopify-payment-settlement.test.ts
git commit -m "feat(shopify): hold real credit-pack grants as AWAITING under SHOPIFY_HOLD_UNTIL_PAID"
```

---

### Task 5: Settlement loop

**Files:**
- Create: `apps/api/src/modules/shopify/payment-settlement-scheduler.ts`
- Modify: `apps/api/src/main.ts:9-40`
- Modify: `CLAUDE.md` (the "Background loops in the api process" table)
- Test: `apps/api/test/integration/shopify-payment-settlement.test.ts` (append)

**Interfaces:**
- Consumes: `checkPurchases`, `CheckOptions` (Task 3); `shopifyPurchasesAwaitingPayment` (Task 1).
- Produces: `runPaymentSettlementTick(app, opts?: { fetchSales?: FetchOneTimeSales; now?: Date }): Promise<void>` and `startPaymentSettlementScheduler(app, intervalMs?): () => void`.

- [ ] **Step 1: Write the failing tests**

Append to the integration test file, and add `import { runPaymentSettlementTick } from '../../src/modules/shopify/payment-settlement-scheduler.js';` at the top:

```ts
describe('payment settlement tick', () => {
  it('settles due AWAITING rows and skips ones not yet due', async () => {
    const due = await awaitingPurchase({ nextPaymentCheckAt: new Date(Date.now() - 1000) });
    const later = await awaitingPurchase({ nextPaymentCheckAt: new Date(Date.now() + 3_600_000) });
    const sales = new Map(
      [due, later].map((r) => [
        (r.shopifyChargeId as string).split('/').pop() as string,
        { paidAt: new Date() },
      ]),
    );

    await runPaymentSettlementTick(app, { fetchSales: async () => sales });

    expect((await reload(due)).paymentStatus).toBe('PAID');
    expect((await reload(later)).paymentStatus).toBe('AWAITING');
  });

  it('a Partner API outage does not throw out of the tick', async () => {
    await awaitingPurchase({ nextPaymentCheckAt: new Date(Date.now() - 1000) });
    await expect(
      runPaymentSettlementTick(app, {
        fetchSales: async () => {
          throw new PartnerApiError('http', 'down');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --config vitest.integration.config.ts shopify-payment-settlement -t "tick"`
Expected: FAIL, because the scheduler module cannot be resolved.

- [ ] **Step 3: Implement the scheduler**

Create `apps/api/src/modules/shopify/payment-settlement-scheduler.ts`:

```ts
import { schema } from '@aivastra/db';
import { shopifyPurchasesAwaitingPayment } from '@aivastra/observability';
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { FetchOneTimeSales } from './partner-api.js';
import { checkPurchases } from './payment-settlement.js';

/** One tick settles at most this many purchases; the rest wait for the next minute. */
const BATCH = 200;
const ONE_MINUTE_MS = 60_000;

/**
 * One pass: settle every AWAITING purchase whose next check is due. Runs
 * regardless of SHOPIFY_HOLD_UNTIL_PAID, so turning the flag off still lets
 * rows already parked AWAITING settle.
 */
export async function runPaymentSettlementTick(
  app: FastifyInstance,
  opts: { fetchSales?: FetchOneTimeSales; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const due = await app.db
    .select()
    .from(schema.shopifyCreditPurchases)
    .where(
      and(
        eq(schema.shopifyCreditPurchases.paymentStatus, 'AWAITING'),
        isNotNull(schema.shopifyCreditPurchases.shopifyChargeId),
        lte(schema.shopifyCreditPurchases.nextPaymentCheckAt, now),
      ),
    )
    .orderBy(asc(schema.shopifyCreditPurchases.nextPaymentCheckAt))
    .limit(BATCH);

  if (due.length > 0) {
    try {
      await checkPurchases(app, due, { fetchSales: opts.fetchSales, now });
    } catch (err) {
      // Fail closed: rows stay AWAITING and are retried next tick. Logged every
      // tick on purpose — with shopify_payment_check_last_success_timestamp
      // going stale, this is the alert.
      app.log.error({ err, due: due.length }, 'payment settlement check failed — purchases stay pending');
    }
  }

  const [{ awaiting }] = await app.db
    .select({ awaiting: sql<number>`count(*)::int` })
    .from(schema.shopifyCreditPurchases)
    .where(eq(schema.shopifyCreditPurchases.paymentStatus, 'AWAITING'));
  shopifyPurchasesAwaitingPayment.set(awaiting);
}

/** Call once after `app.listen(...)`. */
export function startPaymentSettlementScheduler(
  app: FastifyInstance,
  intervalMs: number = ONE_MINUTE_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      app.log.warn('payment settlement tick still running — skipping this interval');
      return;
    }
    running = true;
    void runPaymentSettlementTick(app)
      .catch((err) => {
        app.log.error({ err }, 'payment settlement tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: Start it in `main.ts`**

In `apps/api/src/main.ts`, add the import beside the reconciler import:

```ts
import { startPaymentSettlementScheduler } from './modules/shopify/payment-settlement-scheduler.js';
```

and after `startAutorefillReconciler(app);`:

```ts
startPaymentSettlementScheduler(app);
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --config vitest.integration.config.ts shopify-payment-settlement`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Record the loop in CLAUDE.md**

In `CLAUDE.md`'s "Background loops in the api process" table, add a row after `startAutorefillReconciler`:

```
| `startPaymentSettlementScheduler` | 60s | grants credit packs held `AWAITING` once the Partner API shows the sale (hold-until-paid); fails closed |
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/shopify/payment-settlement-scheduler.ts apps/api/src/main.ts apps/api/test/integration/shopify-payment-settlement.test.ts CLAUDE.md
git commit -m "feat(shopify): payment settlement loop for held credit-pack purchases"
```

---

### Task 6: Confirm-route check and pending endpoint

**Files:**
- Modify: `apps/api/src/modules/shopify/purchase.ts:197-379` (`ConfirmDeps`, `confirmPurchase`)
- Modify: `apps/api/src/modules/shopify/purchase.routes.ts`
- Test: `apps/api/test/integration/shopify-payment-settlement.test.ts` (append)

**Interfaces:**
- Consumes: `checkPurchases` (Task 3); `PartnerApiError` (Task 2); `FetchOneTimeSales`.
- Produces:
  - `confirmPurchase(app, store, purchaseId, deps?)` returns `{ status: string; paymentStatus: PaymentStatus; credits: number; creditsGranted: number; creditBalance: number }`.
  - `ConfirmDeps` gains `fetchSales?: FetchOneTimeSales`.
  - `GET /v1/shopify/billing/purchases/pending` returns `{ purchases: Array<{ id: string; packId: string; label: string; credits: number; createdAt: string; paymentStatus: 'AWAITING' | 'UNPAID' }> }`.

- [ ] **Step 1: Write the failing tests**

Append to the integration file, and add `confirmPurchase` to the existing `purchase.js` import:

```ts
describe('confirmPurchase payment check', () => {
  it('settles an AWAITING purchase on demand and reports the credits', async () => {
    const row = await awaitingPurchase();
    const res = await confirmPurchase(app, store, row.id, {
      fetchPurchase: async () => ({ id: row.shopifyChargeId as string, status: 'ACTIVE', test: false }),
      fetchSales: saleFor(row),
    });
    expect(res.paymentStatus).toBe('PAID');
    expect(res.credits).toBe(800);
    expect(res.creditsGranted).toBe(800);
  });

  it('throttles: a second check within 10 s does not call the Partner API', async () => {
    const row = await awaitingPurchase();
    let calls = 0;
    const counting = async () => {
      calls += 1;
      return new Map();
    };
    const deps = {
      fetchPurchase: async () => ({ id: row.shopifyChargeId as string, status: 'ACTIVE', test: false }),
      fetchSales: counting,
    };
    await confirmPurchase(app, store, row.id, deps);
    const second = await confirmPurchase(app, store, row.id, deps);
    expect(calls).toBe(1);
    expect(second.paymentStatus).toBe('AWAITING');
  });

  it('a Partner API failure returns AWAITING instead of erroring', async () => {
    const row = await awaitingPurchase();
    const res = await confirmPurchase(app, store, row.id, {
      fetchPurchase: async () => ({ id: row.shopifyChargeId as string, status: 'ACTIVE', test: false }),
      fetchSales: async () => {
        throw new PartnerApiError('http', 'down');
      },
    });
    expect(res.paymentStatus).toBe('AWAITING');
    expect(res.creditsGranted).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --config vitest.integration.config.ts shopify-payment-settlement -t "confirmPurchase"`
Expected: FAIL, because `paymentStatus` and `credits` are undefined.

- [ ] **Step 3: Implement it in `confirmPurchase`**

In `purchase.ts`, add the imports:

```ts
import type { FetchOneTimeSales } from './partner-api.js';
import { PartnerApiError } from './partner-api.js';
import { checkPurchases, type PaymentStatus } from './payment-settlement.js';
```

Extend `ConfirmDeps`:

```ts
interface ConfirmDeps {
  fetchPurchase?: (
    app: FastifyInstance,
    store: Store,
    chargeId: string,
  ) => Promise<OneTimePurchaseState | null>;
  fetchSales?: FetchOneTimeSales;
}
```

Add this helper above `confirmPurchase`:

```ts
/** One Partner API call per purchase per this window — merchants' return pages poll every 5 s. */
const PAYMENT_CHECK_THROTTLE_SEC = 10;

/**
 * On-demand payment check for one purchase, so the return page settles in
 * seconds instead of waiting for the next loop tick. Throttled through Redis
 * because the Partner API's 4 req/s limit is shared org-wide; a throttled or
 * failed check just reports the stored state (fail closed).
 */
async function checkPaymentNow(
  app: FastifyInstance,
  store: Store,
  row: typeof schema.shopifyCreditPurchases.$inferSelect,
  fetchSales?: FetchOneTimeSales,
): Promise<void> {
  const claimed = await app.redis.set(
    `shopify:paycheck:${row.id}`,
    '1',
    'EX',
    PAYMENT_CHECK_THROTTLE_SEC,
    'NX',
  );
  if (claimed !== 'OK') return;
  try {
    await checkPurchases(app, [row], { shop: store.shopDomain, fetchSales });
  } catch (err) {
    if (!(err instanceof PartnerApiError)) throw err;
    app.log.warn({ err, purchaseId: row.id }, 'on-demand payment check failed — purchase stays pending');
  }
}
```

Replace the body of `confirmPurchase` from `const creditsGranted = await grantForPurchase(app, store, row, observed);` to the end of the function with:

```ts
  let creditsGranted = await grantForPurchase(app, store, row, observed);

  await app.db
    .update(schema.shopifyCreditPurchases)
    .set({ status: observed.status, updatedAt: new Date() })
    .where(eq(schema.shopifyCreditPurchases.id, row.id));

  // grantForPurchase may have just parked it AWAITING, so re-read before checking.
  let [current] = await app.db
    .select()
    .from(schema.shopifyCreditPurchases)
    .where(eq(schema.shopifyCreditPurchases.id, row.id))
    .limit(1);
  if (current.paymentStatus === 'AWAITING' || current.paymentStatus === 'UNPAID') {
    await checkPaymentNow(app, store, current, deps.fetchSales);
    const before = current.paymentStatus;
    [current] = await app.db
      .select()
      .from(schema.shopifyCreditPurchases)
      .where(eq(schema.shopifyCreditPurchases.id, row.id))
      .limit(1);
    if (before !== 'PAID' && current.paymentStatus === 'PAID') creditsGranted = current.credits;
  }

  return {
    status: observed.status,
    paymentStatus: current.paymentStatus as PaymentStatus,
    credits: current.credits,
    creditsGranted,
    creditBalance: await storeBalance(app, store.id),
  };
```

Update the early return for `!row.shopifyChargeId` to include the new fields:

```ts
    return {
      status: row.status,
      paymentStatus: row.paymentStatus as PaymentStatus,
      credits: row.credits,
      creditsGranted: 0,
      creditBalance: await storeBalance(app, store.id),
    };
```

Change the return-type annotation to `Promise<{ status: string; paymentStatus: PaymentStatus; credits: number; creditsGranted: number; creditBalance: number }>`.

- [ ] **Step 4: Add the pending endpoint**

In `purchase.routes.ts`, update the imports:

```ts
import { schema } from '@aivastra/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getPack } from './packs.js';
```

`schema` is currently imported as `import type { schema }`. Change it to a value import, since the query uses it at runtime. Then add inside `shopifyPurchaseRoutes`:

```ts
  // Feeds the SPA's PendingPaymentBanner. Deliberately not folded into
  // /v1/shopify/me, which every page loads; only Dashboard and Pricing need this.
  app.get(
    '/v1/shopify/billing/purchases/pending',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const rows = await app.db
        .select()
        .from(schema.shopifyCreditPurchases)
        .where(
          and(
            eq(schema.shopifyCreditPurchases.storeId, store.id),
            eq(schema.shopifyCreditPurchases.source, 'manual'),
            inArray(schema.shopifyCreditPurchases.paymentStatus, ['AWAITING', 'UNPAID']),
          ),
        )
        .orderBy(desc(schema.shopifyCreditPurchases.createdAt))
        .limit(10);
      return {
        purchases: rows.map((r) => ({
          id: r.id,
          packId: r.packId,
          label: getPack(r.packId)?.label ?? r.packId,
          credits: r.credits,
          createdAt: r.createdAt.toISOString(),
          paymentStatus: r.paymentStatus as 'AWAITING' | 'UNPAID',
        })),
      };
    },
  );
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run --config vitest.integration.config.ts shopify-payment-settlement shopify-purchase` and then `pnpm --filter @aivastra/api typecheck`
Expected: PASS, with no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/shopify/purchase.ts apps/api/src/modules/shopify/purchase.routes.ts apps/api/test/integration/shopify-payment-settlement.test.ts
git commit -m "feat(shopify): on-demand payment check in confirm, pending purchases endpoint"
```

---

### Task 7: Admin purchase list and check-payment

**Files:**
- Modify: `apps/api/src/modules/admin/shopify-stores.routes.ts`
- Create: `apps/admin-web/src/components/StorePurchasesCard.tsx`
- Modify: `apps/admin-web/src/types.ts`, `apps/admin-web/src/pages/ShopifyStoresPage.tsx:678,980`
- Test: `apps/api/test/integration/shopify-payment-settlement.test.ts` (append)

**Interfaces:**
- Consumes: `checkPurchases` (Task 3); `recordAudit(tx, { actor, action, resourceType, resourceId, after, request })` from `./audit.js`; `requirePermission`.
- Produces:
  - `GET /admin/shopify-stores/:id/purchases` returns `{ purchases: StorePurchase[] }`.
  - `POST /admin/shopify/purchases/:id/check-payment` returns `{ paymentStatus }`.
  - Type: `StorePurchase { id; packId; credits; priceUsdCents; status; paymentStatus; paidAt: string | null; createdAt: string; shopifyChargeId: string | null }`.

- [ ] **Step 1: Write the failing tests**

Append to the integration file, and add `import { adminAuthHeader } from '../helpers/admin.js';` at the top. `adminAuthHeader(app, role)` creates an admin user directly in the database and returns the auth header. `SUPPORT` holds no `credits.write`; confirm with `grep -n "SUPPORT" apps/api/src/modules/admin/permissions*.ts` and pick another role without `credits.write` if that has changed.

```ts
describe('admin check-payment', () => {
  it('rejects a caller without credits.write', async () => {
    const row = await awaitingPurchase();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/shopify/purchases/${row.id}/check-payment`,
      headers: await adminAuthHeader(app, 'SUPPORT'),
    });
    expect(res.statusCode).toBe(403);
  });

  it('fails closed with 502 when the Partner API is not configured', async () => {
    const row = await awaitingPurchase();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/shopify/purchases/${row.id}/check-payment`,
      headers: await adminAuthHeader(app, 'SUPER_ADMIN'),
    });
    // No SHOPIFY_PARTNER_* in the test env → fail closed with a 502, row untouched.
    expect(res.statusCode).toBe(502);
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
  });
});
```

The audit-on-settle path needs a stubbed Partner API, which HTTP tests can't inject. It's covered by a direct test of the route's `onSettled` callback through `checkPurchases`:

```ts
it('onSettled runs inside the settlement transaction', async () => {
  const row = await awaitingPurchase();
  const seen: string[] = [];
  await checkPurchases(app, [row], {
    fetchSales: saleFor(row),
    onSettled: async (_tx, r) => {
      seen.push(r.id);
    },
  });
  expect(seen).toEqual([row.id]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --config vitest.integration.config.ts shopify-payment-settlement -t "admin check-payment"`
Expected: FAIL with 404, because the route doesn't exist.

- [ ] **Step 3: Implement the admin routes**

In `apps/api/src/modules/admin/shopify-stores.routes.ts`, add the imports:

```ts
import { PartnerApiError } from '../shopify/partner-api.js';
import { checkPurchases } from '../shopify/payment-settlement.js';
```

Inside `adminShopifyStoresRoutes`, after the `/ledger` route, add:

```ts
  app.get(
    '/admin/shopify-stores/:id/purchases',
    { preHandler: RO, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const purchases = await app.db
        .select({
          id: schema.shopifyCreditPurchases.id,
          packId: schema.shopifyCreditPurchases.packId,
          credits: schema.shopifyCreditPurchases.credits,
          priceUsdCents: schema.shopifyCreditPurchases.priceUsdCents,
          status: schema.shopifyCreditPurchases.status,
          paymentStatus: schema.shopifyCreditPurchases.paymentStatus,
          paidAt: schema.shopifyCreditPurchases.paidAt,
          createdAt: schema.shopifyCreditPurchases.createdAt,
          shopifyChargeId: schema.shopifyCreditPurchases.shopifyChargeId,
        })
        .from(schema.shopifyCreditPurchases)
        .where(eq(schema.shopifyCreditPurchases.storeId, id))
        .orderBy(desc(schema.shopifyCreditPurchases.createdAt))
        .limit(50);
      return { purchases };
    },
  );

  // credits.write, not a shopify_stores capability: this can grant credits, and
  // shopify_stores only has read/delete. The audit row is written inside the
  // settlement transaction (fail-closed admin-mutation invariant), and only
  // when a grant actually happened — a check that finds nothing writes nothing.
  app.post(
    '/admin/shopify/purchases/:id/check-payment',
    {
      preHandler: requirePermission('credits.write'),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [row] = await app.db
        .select()
        .from(schema.shopifyCreditPurchases)
        .where(eq(schema.shopifyCreditPurchases.id, id))
        .limit(1);
      if (!row) throw new AppError('NOT_FOUND', 404, 'purchase not found');
      if (row.paymentStatus !== 'AWAITING' && row.paymentStatus !== 'UNPAID') {
        return { paymentStatus: row.paymentStatus };
      }
      try {
        const outcome = await checkPurchases(app, [row], {
          onSettled: (tx, settled) =>
            recordAudit(tx, {
              actor: { userId: req.userId, role: req.adminRole! },
              action: 'shopify_purchase.settle',
              resourceType: 'shopify_credit_purchases',
              resourceId: settled.id,
              after: { credits: settled.credits, chargeId: settled.shopifyChargeId },
              request: req,
            }),
        });
        return { paymentStatus: outcome.get(row.id) ?? row.paymentStatus };
      } catch (err) {
        if (err instanceof PartnerApiError) {
          throw new AppError('SHOPIFY', 502, `Partner API unavailable: ${err.reason}`);
        }
        throw err;
      }
    },
  );
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --config vitest.integration.config.ts shopify-payment-settlement`
Expected: PASS.

- [ ] **Step 5: Add the admin-web type**

In `apps/admin-web/src/types.ts`, add:

```ts
export interface StorePurchase {
  id: string;
  packId: string;
  credits: number;
  priceUsdCents: number;
  status: string;
  paymentStatus: 'NOT_REQUIRED' | 'AWAITING' | 'PAID' | 'UNPAID';
  paidAt: string | null;
  createdAt: string;
  shopifyChargeId: string | null;
}
```

- [ ] **Step 6: Create the card component**

Create `apps/admin-web/src/components/StorePurchasesCard.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { StorePurchase } from '../types';
import { useToast } from './Toast';

/**
 * Credit-pack purchases for one store, with Shopify's charge status and our
 * payment status side by side — ACTIVE (invoiced) and PAID (collected) are
 * different facts under hold-until-paid. "Check payment" asks the Partner API
 * now instead of waiting for the settlement loop.
 */
export function StorePurchasesCard({ storeId }: { storeId: string }) {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [purchases, setPurchases] = useState<StorePurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ purchases: StorePurchase[] }>(
        `/admin/shopify-stores/${storeId}/purchases`,
      );
      setPurchases(data.purchases);
    } catch (err) {
      toast({ kind: 'error', title: 'Failed to load purchases', body: apiErrorMessage(err, 'Please try again.') });
    } finally {
      setLoading(false);
    }
  }, [storeId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkPayment(id: string) {
    setChecking(id);
    try {
      const res = await apiFetch<{ paymentStatus: string }>(
        `/admin/shopify/purchases/${id}/check-payment`,
        { method: 'POST' },
      );
      toast({ kind: 'success', title: `Payment status: ${res.paymentStatus}` });
      await load();
    } catch (err) {
      toast({ kind: 'error', title: 'Payment check failed', body: apiErrorMessage(err, 'Please try again.') });
    } finally {
      setChecking(null);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>Credit-pack purchases</h3>
      </div>
      <div className="card-body">
        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
        ) : purchases.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>No purchases yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pack</th>
                  <th style={{ textAlign: 'right' }}>Credits</th>
                  <th>Charge</th>
                  <th>Payment</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td>{p.packId}</td>
                    <td style={{ textAlign: 'right' }}>{p.credits.toLocaleString()}</td>
                    <td>{p.status}</td>
                    <td>
                      {p.paymentStatus}
                      {p.paidAt ? ` · ${new Date(p.paidAt).toLocaleString()}` : ''}
                    </td>
                    <td>{new Date(p.createdAt).toLocaleString()}</td>
                    <td>
                      {(p.paymentStatus === 'AWAITING' || p.paymentStatus === 'UNPAID') &&
                        hasPermission('credits.write') && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={checking === p.id}
                            onClick={() => void checkPayment(p.id)}
                          >
                            {checking === p.id ? 'Checking…' : 'Check payment'}
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

Before saving, check two names: `grep -n "export function useToast\|export const useToast" -r apps/admin-web/src`, and the button class used elsewhere on `ShopifyStoresPage.tsx` (`grep -n 'className="btn' apps/admin-web/src/pages/ShopifyStoresPage.tsx | head -3`). Use the actual toast hook and button class those return, so the card looks native to the page.

- [ ] **Step 7: Render it in both layouts**

In `apps/admin-web/src/pages/ShopifyStoresPage.tsx`, import `import { StorePurchasesCard } from '../components/StorePurchasesCard';`, then:
- immediately before `<div className="card">` that contains `<h3>Credit activity</h3>` (around line 678), insert `<StorePurchasesCard storeId={selectedStore.id} />`
- immediately before the mobile `<h3 …>Credit activity</h3>` (around line 980), insert `<StorePurchasesCard storeId={selectedStore.id} />`

- [ ] **Step 8: Typecheck and build admin-web**

Run: `pnpm --filter @aivastra/admin build && pnpm --filter @aivastra/api typecheck`
Expected: both succeed.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/admin/shopify-stores.routes.ts apps/api/test/integration/shopify-payment-settlement.test.ts apps/admin-web/src/components/StorePurchasesCard.tsx apps/admin-web/src/types.ts apps/admin-web/src/pages/ShopifyStoresPage.tsx
git commit -m "feat(admin): per-store credit-pack purchases with payment check"
```

---

### Task 8: Shopify SPA — return page and pending banner

**Files:**
- Modify: `apps/shopify/src/types.ts`
- Modify: `apps/shopify/src/pages/BillingCallbackPage.tsx`
- Create: `apps/shopify/src/components/PendingPaymentBanner.tsx`
- Modify: `apps/shopify/src/pages/DashboardPage.tsx`, `apps/shopify/src/pages/PricingPage.tsx`

**Interfaces:**
- Consumes: `GET /v1/shopify/billing/purchase/confirm` returning `{ status, paymentStatus, credits, creditsGranted, creditBalance }`, and `GET /v1/shopify/billing/purchases/pending` (Task 6).
- Produces: `<PendingPaymentBanner shopDomain={string} include="awaiting" | "all" />`.

- [ ] **Step 1: Add the types**

In `apps/shopify/src/types.ts`, add:

```ts
export type PurchasePaymentStatus = 'NOT_REQUIRED' | 'AWAITING' | 'PAID' | 'UNPAID';

export interface PurchaseConfirmResponse {
  status: string;
  paymentStatus: PurchasePaymentStatus;
  credits: number;
  creditsGranted: number;
  creditBalance: number;
}

export interface PendingPurchase {
  id: string;
  packId: string;
  label: string;
  credits: number;
  createdAt: string;
  paymentStatus: 'AWAITING' | 'UNPAID';
}
```

- [ ] **Step 2: Rewrite the return page's flow**

In `apps/shopify/src/pages/BillingCallbackPage.tsx`:

Replace the file's doc comment with:

```tsx
/**
 * Shopify sends the merchant here after they approve a one-time charge for a
 * credit pack. Under hold-until-paid, approval is not payment: the charge is
 * invoiced at approval and collected afterwards, so confirm may answer
 * AWAITING. We poll for up to WAIT_MS (most payments land in 1–2 minutes),
 * then hand off to the dashboard's PendingPaymentBanner — the api's settlement
 * loop grants the credits whenever payment lands, even if this tab is closed.
 * A failed confirm is still the one error here worth shouting about.
 */
```

Replace the `confirm` callback's generic with `PurchaseConfirmResponse` (imported from `../types`), add the constants after the imports:

```tsx
const POLL_MS = 5_000;
const WAIT_MS = 3 * 60_000;
```

add `const [waiting, setWaiting] = useState(false);` beside `declined`, and replace the `useEffect` with:

```tsx
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const first = await run();
      if (!first.ok || cancelled) return; // reauth redirect in flight, or error state already set
      let data = first.data;
      // A DECLINED purchase is a normal outcome, not a failure — the merchant
      // looked at the charge and said no.
      if (data.status === 'DECLINED' || data.status === 'EXPIRED') {
        setDeclined(true);
        return;
      }
      const deadline = Date.now() + WAIT_MS;
      while (data.paymentStatus === 'AWAITING' && Date.now() < deadline) {
        setWaiting(true);
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (cancelled) return;
        try {
          data = await confirm();
        } catch {
          // Transient — keep polling until the deadline; the banner and the
          // server-side loop cover anything that outlasts it.
        }
      }
      if (cancelled) return;
      const settled = data.paymentStatus === 'PAID' || data.paymentStatus === 'NOT_REQUIRED';
      navigate('/', { replace: true, state: settled ? { creditsAdded: data.credits } : undefined });
    })();
    return () => {
      cancelled = true;
    };
  }, [run, confirm, navigate]);
```

Replace the final spinner `return` with:

```tsx
  return (
    <AppFont>
      <Page>
        <BlockStack gap="400" inlineAlign="center">
          <Spinner accessibilityLabel="Confirming your payment" size="large" />
          {waiting && (
            <Text as="p" tone="subdued">
              Confirming your payment with Shopify… this usually takes a minute or two.
            </Text>
          )}
        </BlockStack>
      </Page>
    </AppFont>
  );
```

- [ ] **Step 3: Create the banner**

Create `apps/shopify/src/components/PendingPaymentBanner.tsx`:

```tsx
import { Banner, BlockStack, Text } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, navigateTopLevel } from '../lib/api';
import type { PendingPurchase, PurchaseConfirmResponse } from '../types';

/**
 * Credit packs approved but not yet paid. Approval only invoices the merchant;
 * Shopify collects afterwards, and credits are granted once it has. AWAITING
 * shows on Dashboard + Pricing; UNPAID (no payment after 30 days) only on
 * Pricing (`include="all"`), so an abandoned invoice doesn't nag forever.
 */
export function PendingPaymentBanner({
  shopDomain,
  include,
}: {
  shopDomain: string;
  include: 'awaiting' | 'all';
}) {
  const [purchases, setPurchases] = useState<PendingPurchase[]>([]);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ purchases: PendingPurchase[] }>(
        '/v1/shopify/billing/purchases/pending',
      );
      setPurchases(data.purchases);
    } catch {
      // Advisory UI — a failed load just hides the banner; the page's own
      // error handling covers real outages.
      setPurchases([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = purchases.filter((p) => include === 'all' || p.paymentStatus === 'AWAITING');
  if (visible.length === 0) return null;
  const p = visible[0];
  const awaiting = p.paymentStatus === 'AWAITING';
  const billingUrl = `https://admin.shopify.com/store/${shopDomain.replace(/\.myshopify\.com$/, '')}/settings/billing`;

  async function checkPayment() {
    setChecking(true);
    setNote(null);
    try {
      const res = await apiFetch<PurchaseConfirmResponse>(
        `/v1/shopify/billing/purchase/confirm?purchase=${encodeURIComponent(p.id)}`,
      );
      setNote(
        res.paymentStatus === 'PAID'
          ? `Payment received — ${res.credits.toLocaleString()} credits added.`
          : "Shopify hasn't collected this payment yet.",
      );
      await load();
    } catch {
      setNote('Could not check right now. Please try again in a moment.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <Banner
      tone={awaiting ? 'warning' : 'critical'}
      title={awaiting ? 'Payment pending' : 'Payment not received'}
      action={{ content: 'Check payment', onAction: () => void checkPayment(), loading: checking }}
      secondaryAction={{ content: 'Open Shopify billing', onAction: () => navigateTopLevel(billingUrl) }}
    >
      <BlockStack gap="100">
        <Text as="p">
          {awaiting
            ? `Your ${p.credits.toLocaleString()} credits (${p.label}) will be added as soon as Shopify collects your payment.`
            : `We haven't received payment for your ${p.label} pack. Pay the outstanding invoice in Shopify billing, then check again.`}
        </Text>
        {note && (
          <Text as="p" tone="subdued">
            {note}
          </Text>
        )}
      </BlockStack>
    </Banner>
  );
}
```

- [ ] **Step 4: Render it, and add the dashboard toast**

In `DashboardPage.tsx`:
- import `PendingPaymentBanner` from `'../components/PendingPaymentBanner'` and `useLocation` from `'react-router-dom'`
- directly after `{me && <LowCreditsBanner me={me} />}` (line 296), add `{me && <PendingPaymentBanner shopDomain={me.store.shopDomain} include="awaiting" />}`
- inside the component, after the `toastMessage` state (line 170), add:

```tsx
  const location = useLocation();
  // Set by BillingCallbackPage once a pack's payment settled.
  useEffect(() => {
    const added = (location.state as { creditsAdded?: number } | null)?.creditsAdded;
    if (added) setToastMessage(`${added.toLocaleString()} credits added`);
  }, [location.state]);
```

In `PricingPage.tsx`, import `PendingPaymentBanner` and, directly after `{me && <LowCreditsBanner me={me} hideCapReached />}` (line 151), add `{me && <PendingPaymentBanner shopDomain={me.store.shopDomain} include="all" />}`.

- [ ] **Step 5: Typecheck and build the SPA**

Run: `pnpm --filter @aivastra/shopify build`
Expected: the build succeeds. If the package name differs, check `apps/shopify/package.json`'s `name` and use that.

- [ ] **Step 6: Commit**

```bash
git add apps/shopify/src/types.ts apps/shopify/src/pages/BillingCallbackPage.tsx apps/shopify/src/components/PendingPaymentBanner.tsx apps/shopify/src/pages/DashboardPage.tsx apps/shopify/src/pages/PricingPage.tsx
git commit -m "feat(shopify-spa): wait for payment on return, pending-payment banner"
```

---

### Task 9: Full verification and progress log

**Files:**
- Modify: `docs/progress.md`

- [ ] **Step 1: Run the whole suite**

Run (from the repo root, with `pnpm docker:up` running):
```
pnpm typecheck
pnpm lint
pnpm --filter @aivastra/api test
pnpm --filter @aivastra/api test:integration
```
Expected: all pass. If an unrelated test was already failing before this branch, confirm that with `git stash; <test>; git stash pop` and note it in the progress entry rather than fixing it here.

- [ ] **Step 2: Add the progress entry**

At the top of `docs/progress.md` (below the "Moved 2026-08-29" note), add:

```markdown
## 2026-10-09 — Shopify credit packs: hold until paid (implemented, flag off)

- **Done:** credit-pack credits can now be held until Shopify has actually collected payment,
  behind `SHOPIFY_HOLD_UNTIL_PAID` (off by default — behaviour unchanged until flipped).
  Spec `docs/superpowers/specs/2026-10-09-shopify-hold-until-paid-design.md`, plan
  `docs/superpowers/plans/2026-10-09-shopify-hold-until-paid.md`. Migration `0219` adds
  `payment_status` / `paid_at` / `next_payment_check_at` to `shopify_credit_purchases`.
  New: `partner-api.ts`, `payment-settlement.ts`, `startPaymentSettlementScheduler` (60s),
  confirm-route on-demand check (Redis-throttled 10s), `GET /v1/shopify/billing/purchases/pending`,
  admin `GET /admin/shopify-stores/:id/purchases` + `POST /admin/shopify/purchases/:id/check-payment`
  (`credits.write`, audited), SPA return-page polling + `PendingPaymentBanner`.
- **Validation:** <paste the four commands from Task 9 Step 1 with pass counts>.
- **Rollout (not done — production ops):**
  1. Deploy (migration runs via CI `db:migrate:prod`), flag still off.
  2. Create a **production** Partner API client ("View financials" only), set
     `SHOPIFY_PARTNER_API_TOKEN` + `SHOPIFY_PARTNER_ORG_ID` in `.env.production`, restart api.
  3. On the VPS: `pnpm check:partner-transactions -- 3321168113` must report PAID.
  4. Set `SHOPIFY_HOLD_UNTIL_PAID=true`, restart api (runtime var, no rebuild).
  5. Buy Silver on our store; confirm AWAITING → PAID within minutes, banner, toast, one ledger row.
  6. Create the Grafana alert: `shopify_payment_check_last_success_timestamp` older than 15 min
     while `shopify_purchases_awaiting_payment > 0`. Record it here when done.
- **Open:** SPA banner/return page verified only by build — no component tests exist; verify by
  hand in rollout step 5.
```

Replace `<paste …>` with the actual command output summary before committing. Never commit the placeholder.

- [ ] **Step 3: Commit**

```bash
git add docs/progress.md
git commit -m "docs(progress): hold-until-paid implementation and rollout steps"
```
