# Shopify Grant-Then-Verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Shopify credit-pack credits instant (granted at approval) while verifying afterwards, through the Partner API, that Shopify collected the money, and give admins an all-stores page to see and annotate purchases that were never paid.

**Architecture:** A new flag `SHOPIFY_VERIFY_PAYMENTS` makes `grantForPurchase` mark a real, non-test charge `UNVERIFIED` and grant in ONE transaction. A second pass in the existing 60 s settlement loop looks for the sale: found → `PAID` (no second grant), none after a window → `NOT_RECEIVED`. Admins review purchases on a new page, can override the status with a note (audited, never touching credits), and the automatic loop skips manual overrides. The dormant hold-until-paid feature is untouched.

**Tech Stack:** Fastify 5, Drizzle ORM / Postgres 16, Redis, Vitest, React + Vite (`apps/admin-web`, `apps/shopify`), prom-client via `@aivastra/observability`.

**Spec:** `docs/superpowers/specs/2026-10-09-shopify-grant-then-verify-design.md` (read it first).

**Branch:** create `feat/shopify-grant-then-verify` from `docs/shopify-grant-then-verify` (which carries the spec) before Task 1.

## Global Constraints

- Credits are granted at approval, never held, never clawed back by this feature. Auto-refill (`source = 'autorefill'`) and test charges (`observed.test === true`) are unchanged and stay `NOT_REQUIRED`.
- Flag `SHOPIFY_VERIFY_PAYMENTS` accepts only the literal `'true'` (`z.preprocess((v) => v === 'true', z.boolean()).default(false)`); every gate compares `=== true`. With it off, `grantForPurchase` behaves exactly as today.
- If `SHOPIFY_HOLD_UNTIL_PAID` and `SHOPIFY_VERIFY_PAYMENTS` are both `true`, the hold takes precedence and nothing is verified.
- `payment_status` values: `NOT_REQUIRED`, `UNVERIFIED`, `PAID`, `NOT_RECEIVED`; plus the dormant hold feature's `AWAITING` and `UNPAID` (credits NOT granted), which must keep working unchanged.
- Window before "not received": `SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES`, default **180**, minimum **60**.
- Schedule: first check 15 minutes after the grant; every 15 minutes until the window ends; after the window `NOT_RECEIVED` rows are re-checked every 24 hours until the row is 30 days old, then never again.
- **Fail closed:** a failed Partner API query never marks a row `NOT_RECEIVED` and never changes any row.
- Grant and the `UNVERIFIED` mark happen in ONE transaction: `UPDATE … SET payment_status='UNVERIFIED' WHERE id=$1 AND payment_status='NOT_REQUIRED' RETURNING`, then `grantStore(tx, storeId, row.credits, 'SHOPIFY_PACK', 'shopify_pack:<chargeId>')`.
- The verification pass NEVER grants credits and only updates rows with `payment_status IN ('UNVERIFIED','NOT_RECEIVED') AND payment_status_source = 'AUTO'`.
- Admin override: `payment_status_source = 'MANUAL'` rows are skipped by the loop; `AUTO` clears the override (status back to `UNVERIFIED`, `next_payment_check_at = now()`). The review route never touches the ledger or any balance, rejects held rows (`AWAITING`/`UNPAID`) with 409, requires a note of 3–500 characters, and writes `recordAudit(tx, …)` (`shopify_purchase.payment_review`) in the same transaction. `check-payment` on a `MANUAL` row returns 409.
- Permissions: list = `shopify_stores.read`; any change = `credits.write`.
- `GET /v1/shopify/billing/purchases/pending` (merchant) stays unchanged: merchants see no banner from this feature.
- `/v1/shopify/me`: `UNVERIFIED` and `NOT_RECEIVED` count as "paid for a pack" (credits were delivered).
- New gauges: `shopify_purchases_unverified`, `shopify_purchases_not_received`, `shopify_purchases_overdue_verification` (automatic rows whose `next_payment_check_at` is more than 1 h in the past).
- Migration `0220` is additive. `pnpm db:generate` / `pnpm db:migrate` run LOCALLY only (`DATABASE_URL` host must be 127.0.0.1); production gets it via CI `db:migrate:prod`. The lefthook biome hook rejects the raw drizzle snapshot JSON: run `npx biome format --write` on the new `meta/0220_snapshot.json` before committing.
- Code rules: no `console.log` in `src/` (use `app.log`); comments explain the why; admin-web dropdowns use `SearchableSelect`, never a raw `<select>`; URL-param navigation per `docs/admin-url-routing-standard.md`; never print secrets; no new lockfiles.
- Tests: unit via `pnpm --filter @aivastra/api exec vitest run <file>`; integration need docker (`pnpm docker:up`) and run from `apps/api`: `npx vitest run --config vitest.integration.config.ts <pattern>`. Test output must be pristine: stub expected error logs with `vi.spyOn(app.log, 'error').mockImplementation(() => undefined)`.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/db/src/schema/shopify.ts` | modify | four new columns + partial index on `shopifyCreditPurchases` |
| `packages/db/src/migrations/0220_*.sql` (+ meta) | generate | the migration |
| `apps/api/src/env.ts` | modify | the flag and the window |
| `.env.example`, `.env.production.example`, `.env.staging.example` | modify | document the new vars |
| `packages/observability/src/metrics.ts` | modify | three gauges |
| `apps/api/src/modules/shopify/payment-verification.ts` | create | schedule constants/helpers, `verifyGrantedPurchases`, `runVerificationPass` |
| `apps/api/src/modules/shopify/payment-settlement.ts` | modify | widen `PaymentStatus`; extract shared `fetchSalesForRows` |
| `apps/api/src/modules/shopify/payment-settlement-scheduler.ts` | modify | call the verification pass from the tick |
| `apps/api/src/modules/shopify/purchase.ts` | modify | transactional mark+grant in `grantForPurchase` |
| `apps/api/src/modules/shopify/me.routes.ts` | modify | count `UNVERIFIED`/`NOT_RECEIVED` as purchased |
| `apps/api/src/modules/admin/shopify-purchases.routes.ts` | create | `GET /admin/shopify/purchases`, `POST …/payment-review` |
| `apps/api/src/modules/admin/shopify-stores.routes.ts` | modify | `check-payment` for granted rows; new fields on the per-store list |
| `apps/api/src/server.ts` | modify | register the new routes |
| `apps/shopify/src/lib/purchase-wait.ts`, `src/types.ts` | modify | `UNVERIFIED`/`NOT_RECEIVED` count as credits landed |
| `apps/admin-web/src/types.ts` | modify | extended `StorePurchase`, new `PackPurchase` |
| `apps/admin-web/src/pages/ShopifyPurchasesPage.tsx` | create | the all-stores page, drawer, review dialog |
| `apps/admin-web/src/App.tsx`, `components/Sidebar.tsx` | modify | route, title, sidebar entry |
| `apps/admin-web/src/components/StorePurchasesCard.tsx` | modify | new statuses, manual tag, check button for verifiable rows |
| `apps/api/test/env-verify-flags.test.ts` | create | env parsing |
| `apps/api/test/shopify-payment-verification-schedule.test.ts` | create | unit tests for the schedule helpers |
| `apps/api/test/integration/shopify-payment-verification.test.ts` | create | grant, verification, tick |
| `apps/api/test/integration/admin-shopify-purchases.test.ts` | create | list, review, check-payment |
| `docs/progress.md` | modify | entry + rollout |

---

### Task 1: Schema, migration, env flags, metrics

**Files:**
- Modify: `packages/db/src/schema/shopify.ts` (the `shopifyCreditPurchases` table)
- Generate: `packages/db/src/migrations/0220_<generated>.sql`, `meta/0220_snapshot.json`, `meta/_journal.json`
- Modify: `apps/api/src/env.ts`, `.env.example`, `.env.production.example`, `.env.staging.example`
- Modify: `packages/observability/src/metrics.ts`
- Test: `apps/api/test/env-verify-flags.test.ts`

**Interfaces:**
- Produces:
  - `schema.shopifyCreditPurchases.paymentStatusSource` (`'AUTO' | 'MANUAL'`, default `'AUTO'`), `.paymentNote` (`string | null`), `.paymentFlaggedBy` (`string | null`, FK `users.id`), `.paymentFlaggedAt` (`Date | null`)
  - `Env.SHOPIFY_VERIFY_PAYMENTS: boolean`, `Env.SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: number`
  - gauges `shopifyPurchasesUnverified`, `shopifyPurchasesNotReceived`, `shopifyPurchasesOverdueVerification` from `@aivastra/observability`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/shopify-grant-then-verify docs/shopify-grant-then-verify
```

- [ ] **Step 2: Write the failing env test**

Create `apps/api/test/env-verify-flags.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

// Minimal valid env for loadEnv to parse successfully
const minimalEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'debug',
  API_PORT: '4000',
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost',
  JWT_SECRET: '00000000000000000000000000000001',
  JWT_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '1h',
  R2_ENDPOINT: 'http://localhost:9000',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'test',
  R2_PUBLIC_URL: 'http://localhost:9000/test',
  R2_FORCE_PATH_STYLE: 'true',
  ADMIN_BOOTSTRAP_EMAIL: 'admin@example.com',
  ADMIN_BOOTSTRAP_PASSWORD: 'password123',
  CORS_ORIGIN: 'http://localhost:3000',
  COOKIE_SECRET: '00000000000000000000000000000002',
  WEB_URL: 'http://localhost:3000',
  RESEND_API_KEY: 'test',
  EMAIL_FROM: 'test@example.com',
};

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('env - grant-then-verify flags', () => {
  it('defaults the flag off and the window to 180 minutes', () => {
    process.env = { ...minimalEnv };
    const env = loadEnv();
    expect(env.SHOPIFY_VERIFY_PAYMENTS).toBe(false);
    expect(env.SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES).toBe(180);
  });

  it('turns the flag on only for the literal string true', () => {
    process.env = { ...minimalEnv, SHOPIFY_VERIFY_PAYMENTS: 'true' };
    expect(loadEnv().SHOPIFY_VERIFY_PAYMENTS).toBe(true);
    for (const v of ['false', '1', 'TRUE', 'yes', '']) {
      process.env = { ...minimalEnv, SHOPIFY_VERIFY_PAYMENTS: v };
      expect(loadEnv().SHOPIFY_VERIFY_PAYMENTS).toBe(false);
    }
  });

  it('treats a blank window as the default and accepts 60 or more', () => {
    process.env = { ...minimalEnv, SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: '' };
    expect(loadEnv().SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES).toBe(180);
    process.env = { ...minimalEnv, SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: '240' };
    expect(loadEnv().SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES).toBe(240);
    process.env = { ...minimalEnv, SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: '60' };
    expect(loadEnv().SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES).toBe(60);
  });

  it('rejects a window below 60 minutes or a non-number', () => {
    process.env = { ...minimalEnv, SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: '30' };
    expect(() => loadEnv()).toThrow();
    process.env = { ...minimalEnv, SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: 'abc' };
    expect(() => loadEnv()).toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @aivastra/api exec vitest run test/env-verify-flags.test.ts`
Expected: FAIL (`env.SHOPIFY_VERIFY_PAYMENTS` is `undefined`, so the default assertion fails).

- [ ] **Step 4: Add the env vars**

In `apps/api/src/env.ts`, directly after the `SHOPIFY_PARTNER_ORG_ID` definition (the `z.preprocess(...)` block ending with `),`), add:

```ts
  // Grant credit packs at approval as always, then use the Partner API afterwards
  // to confirm Shopify collected the money (UNVERIFIED -> PAID / NOT_RECEIVED).
  // Same literal-'true' pattern as the other revenue flags: anything but the exact
  // string stays off. See docs/superpowers/specs/2026-10-09-shopify-grant-then-verify-design.md.
  SHOPIFY_VERIFY_PAYMENTS: z.preprocess((v) => v === 'true', z.boolean()).default(false),
  // How long after approval a missing sale means "not received". Shopify's sale
  // took ~36-46 minutes to become visible in the one sample we have, so the default
  // is several times that; min 60 so a typo can't flood admins with false alarms.
  // A blank line in .env must not crash startup, hence the preprocess.
  SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(60).default(180),
  ),
```

- [ ] **Step 5: Run the env test to verify it passes**

Run: `pnpm --filter @aivastra/api exec vitest run test/env-verify-flags.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Add the schema columns and index**

In `packages/db/src/schema/shopify.ts`, inside `shopifyCreditPurchases`, directly after the `nextPaymentCheckAt` column add:

```ts
    // 'AUTO' | 'MANUAL'. MANUAL means an admin set payment_status by hand (the
    // payment-review route); the automatic verification loop never overwrites it.
    paymentStatusSource: text('payment_status_source').notNull().default('AUTO'),
    // Free-text note from the last admin review (3-500 chars, enforced by the route).
    paymentNote: text('payment_note'),
    // The admin who last reviewed it, and when. SET NULL so deleting an admin user
    // never deletes the purchase record.
    paymentFlaggedBy: uuid('payment_flagged_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    paymentFlaggedAt: timestamp('payment_flagged_at', { withTimezone: true }),
```

and in the table's index callback, after `awaitingPaymentIdx`, add:

```ts
    // Partial: the verification loop only asks "which unverified / not-received
    // rows that nobody overrode are due".
    verifyPaymentIdx: index('shopify_credit_purchases_verify_payment_idx')
      .on(table.nextPaymentCheckAt)
      .where(
        sql`${table.paymentStatus} IN ('UNVERIFIED','NOT_RECEIVED') AND ${table.paymentStatusSource} = 'AUTO'`,
      ),
```

(`users` and `sql` are already imported at the top of this file.)

- [ ] **Step 7: Generate and apply the migration (local database only)**

First confirm the target is local, without printing the password:
`grep -E '^DATABASE_URL=' .env | sed -E 's#(://[^:]+:)[^@]*@#\1***@#'` — the host must be `127.0.0.1` or `localhost`. If not, STOP.

Run: `pnpm db:generate`
Expected: a new `packages/db/src/migrations/0220_<name>.sql` with exactly four `ALTER TABLE "shopify_credit_purchases" ADD COLUMN …` statements, one `ADD CONSTRAINT … FOREIGN KEY ("payment_flagged_by") REFERENCES "public"."users"("id") ON DELETE set null`, and one `CREATE INDEX IF NOT EXISTS "shopify_credit_purchases_verify_payment_idx" … WHERE … IN ('UNVERIFIED','NOT_RECEIVED') AND … = 'AUTO'`. Open it and confirm nothing else is in it; if drizzle emits unrelated statements, STOP and report instead of editing.

Run: `npx biome format --write packages/db/src/migrations/meta/0220_snapshot.json`
Run: `pnpm db:migrate`
Expected: `Applied 0220_<name>` and `Done: 1 applied`.

- [ ] **Step 8: Document the vars in the three env examples**

Append to each file's Shopify section (after the `SHOPIFY_PARTNER_ORG_ID=` line in `.env.example`, `.env.production.example` and `.env.staging.example`):

```
# Grant credit packs at approval as always, then CONFIRM afterwards that Shopify collected
# payment (Partner API sale): UNVERIFIED -> PAID, or NOT_RECEIVED after the window. Only the
# literal 'true' enables it. Needs SHOPIFY_PARTNER_* above. Ignored while SHOPIFY_HOLD_UNTIL_PAID=true.
SHOPIFY_VERIFY_PAYMENTS=
# Minutes after approval before a missing sale is called "not received" (default 180, min 60).
SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES=
```

- [ ] **Step 9: Add the metrics**

In `packages/observability/src/metrics.ts`, after `shopifyPurchasesOverduePaymentCheck`, add:

```ts
export const shopifyPurchasesUnverified = new Gauge({
  name: 'shopify_purchases_unverified',
  help: 'Credit-pack purchases granted at approval whose payment has not been confirmed by a Partner API sale yet',
  registers: [register],
});

export const shopifyPurchasesNotReceived = new Gauge({
  name: 'shopify_purchases_not_received',
  help: 'Credit-pack purchases granted at approval with no Partner API sale after the verification window — someone should look',
  registers: [register],
});

export const shopifyPurchasesOverdueVerification = new Gauge({
  name: 'shopify_purchases_overdue_verification',
  help: 'Automatic UNVERIFIED/NOT_RECEIVED purchases whose next_payment_check_at is more than 1 hour in the past — the verification loop is stuck or the Partner API is failing',
  registers: [register],
});
```

- [ ] **Step 10: Build and typecheck**

Run: `pnpm --filter @aivastra/db --filter @aivastra/observability build && pnpm --filter @aivastra/api typecheck`
Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add packages/db/src/schema/shopify.ts packages/db/src/migrations packages/observability/src/metrics.ts apps/api/src/env.ts apps/api/test/env-verify-flags.test.ts .env.example .env.production.example .env.staging.example
git commit -m "feat(shopify): payment review columns, verify flags and gauges"
```

---

### Task 2: Schedule helpers and the transactional grant

**Files:**
- Create: `apps/api/src/modules/shopify/payment-verification.ts`
- Modify: `apps/api/src/modules/shopify/payment-settlement.ts` (type only), `apps/api/src/modules/shopify/purchase.ts`
- Test: `apps/api/test/shopify-payment-verification-schedule.test.ts` (unit), `apps/api/test/integration/shopify-payment-verification.test.ts` (integration, created here; Tasks 3–4 append)

**Interfaces:**
- Produces (from `payment-verification.ts`):
  ```ts
  export const VERIFY_FIRST_CHECK_MS: number;   // 15 minutes
  export const VERIFY_POLL_MS: number;          // 15 minutes
  export const NOT_RECEIVED_POLL_MS: number;    // 24 hours
  export const NOT_RECEIVED_STOP_MS: number;    // 30 days
  export function verifyWindowMs(env: { SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES?: number }): number;
  export interface NoSaleDecision { status: 'UNVERIFIED' | 'NOT_RECEIVED'; nextCheckAt: Date | null }
  export function decideNoSale(createdAt: Date, now: Date, windowMs: number): NoSaleDecision;
  ```
- Produces: `PaymentStatus` in `payment-settlement.ts` becomes `'NOT_REQUIRED' | 'UNVERIFIED' | 'PAID' | 'NOT_RECEIVED' | 'AWAITING' | 'UNPAID'`.
- Produces: `grantForPurchase(app, store, purchaseRow, observed)` — same signature; with the verify flag on and a real `ACTIVE` charge on a `NOT_REQUIRED` row it marks `UNVERIFIED` and grants in one transaction and returns the credits granted (800 on first call, 0 on replays).

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/test/shopify-payment-verification-schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  decideNoSale,
  NOT_RECEIVED_POLL_MS,
  VERIFY_POLL_MS,
  verifyWindowMs,
} from '../src/modules/shopify/payment-verification.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WINDOW = 180 * MIN;
const created = new Date('2026-10-01T00:00:00Z');
const at = (ms: number) => new Date(created.getTime() + ms);

describe('decideNoSale', () => {
  it('stays UNVERIFIED and re-checks in 15 minutes before the window ends', () => {
    const now = at(20 * MIN);
    const d = decideNoSale(created, now, WINDOW);
    expect(d.status).toBe('UNVERIFIED');
    expect(d.nextCheckAt?.getTime()).toBe(now.getTime() + VERIFY_POLL_MS);
  });

  it('becomes NOT_RECEIVED, re-checked daily, exactly when the window is reached', () => {
    const now = at(WINDOW);
    const d = decideNoSale(created, now, WINDOW);
    expect(d.status).toBe('NOT_RECEIVED');
    expect(d.nextCheckAt?.getTime()).toBe(now.getTime() + NOT_RECEIVED_POLL_MS);
  });

  it('is still UNVERIFIED one millisecond before the window ends', () => {
    expect(decideNoSale(created, at(WINDOW - 1), WINDOW).status).toBe('UNVERIFIED');
  });

  it('keeps re-checking daily until the row is 30 days old', () => {
    const now = at(29 * DAY);
    const d = decideNoSale(created, now, WINDOW);
    expect(d.status).toBe('NOT_RECEIVED');
    expect(d.nextCheckAt?.getTime()).toBe(now.getTime() + DAY);
  });

  it('stops checking (no next time) at 30 days', () => {
    const d = decideNoSale(created, at(30 * DAY), WINDOW);
    expect(d.status).toBe('NOT_RECEIVED');
    expect(d.nextCheckAt).toBeNull();
  });
});

describe('verifyWindowMs', () => {
  it('uses the configured minutes', () => {
    expect(verifyWindowMs({ SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: 240 })).toBe(240 * MIN);
    expect(verifyWindowMs({ SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: 60 })).toBe(60 * MIN);
  });
  it('falls back to 180 minutes when unset or below the minimum', () => {
    expect(verifyWindowMs({})).toBe(180 * MIN);
    expect(verifyWindowMs({ SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES: 59 })).toBe(180 * MIN);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-payment-verification-schedule.test.ts`
Expected: FAIL (module `payment-verification.js` cannot be resolved).

- [ ] **Step 3: Create the schedule module**

Create `apps/api/src/modules/shopify/payment-verification.ts`:

```ts
/**
 * Grant-then-verify: credits are granted when the merchant approves the charge,
 * and the Partner API is used afterwards only to CONFIRM that Shopify collected
 * the money. A pack that is never confirmed is flagged for a human, not clawed
 * back. Spec: docs/superpowers/specs/2026-10-09-shopify-grant-then-verify-design.md.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Delay before the first check after the grant. */
export const VERIFY_FIRST_CHECK_MS = 15 * MIN;
/** Re-check cadence while the purchase is inside the verification window. */
export const VERIFY_POLL_MS = 15 * MIN;
/** Re-check cadence once a purchase is NOT_RECEIVED (a late payer is caught the next day). */
export const NOT_RECEIVED_POLL_MS = DAY;
/** A NOT_RECEIVED purchase older than this is never re-checked automatically. */
export const NOT_RECEIVED_STOP_MS = 30 * DAY;

const DEFAULT_WINDOW_MINUTES = 180;
const MIN_WINDOW_MINUTES = 60;

/** The configured verification window in ms, falling back to the default for unset/too-small values. */
export function verifyWindowMs(env: { SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES?: number }): number {
  const m = env.SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES;
  return (typeof m === 'number' && m >= MIN_WINDOW_MINUTES ? m : DEFAULT_WINDOW_MINUTES) * MIN;
}

export interface NoSaleDecision {
  status: 'UNVERIFIED' | 'NOT_RECEIVED';
  /** null = never check this row again. */
  nextCheckAt: Date | null;
}

/**
 * What to do with a row for which a SUCCESSFUL Partner API query found no sale.
 * Only ever call this after a successful query: absence is meaningless if the
 * query failed, which is why a failed query must change nothing.
 */
export function decideNoSale(createdAt: Date, now: Date, windowMs: number): NoSaleDecision {
  const age = now.getTime() - createdAt.getTime();
  if (age < windowMs) {
    return { status: 'UNVERIFIED', nextCheckAt: new Date(now.getTime() + VERIFY_POLL_MS) };
  }
  if (age >= NOT_RECEIVED_STOP_MS) return { status: 'NOT_RECEIVED', nextCheckAt: null };
  return { status: 'NOT_RECEIVED', nextCheckAt: new Date(now.getTime() + NOT_RECEIVED_POLL_MS) };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm --filter @aivastra/api exec vitest run test/shopify-payment-verification-schedule.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Widen the `PaymentStatus` type**

In `apps/api/src/modules/shopify/payment-settlement.ts`, replace:

```ts
export type PaymentStatus = 'NOT_REQUIRED' | 'AWAITING' | 'PAID' | 'UNPAID';
```

with:

```ts
export type PaymentStatus =
  | 'NOT_REQUIRED'
  | 'UNVERIFIED'
  | 'PAID'
  | 'NOT_RECEIVED'
  | 'AWAITING'
  | 'UNPAID';
```

- [ ] **Step 6: Write the failing grant integration tests**

Create `apps/api/test/integration/shopify-payment-verification.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantStore } from '../../src/modules/credits/shopify-ledger.js';
import { grantForPurchase } from '../../src/modules/shopify/purchase.js';
import { buildTestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

let ctx: Containers;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let store: typeof schema.shopifyStores.$inferSelect;
let devStore: typeof schema.shopifyStores.$inferSelect;
let overflowStore: typeof schema.shopifyStores.$inferSelect;
let seq = 0;

type Row = typeof schema.shopifyCreditPurchases.$inferSelect;

async function makeStore(domain: string, shopId: number, partnerDevelopment = false) {
  const [s] = await app.db
    .insert(schema.shopifyStores)
    .values({
      shopDomain: domain,
      shopifyShopId: shopId,
      accessToken: 'enc:token',
      scope: 'read_products',
      partnerDevelopment,
    })
    .returning();
  return s;
}

async function purchase(
  overrides: Partial<Row> = {},
  forStore: typeof store = store,
): Promise<Row> {
  seq += 1;
  const [row] = await app.db
    .insert(schema.shopifyCreditPurchases)
    .values({
      storeId: forStore.id,
      packId: 'pack_10',
      credits: 800,
      priceUsdCents: 1000,
      status: 'ACTIVE',
      shopifyChargeId: `gid://shopify/AppPurchaseOneTime/${5000 + seq}`,
      paymentStatus: 'NOT_REQUIRED',
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
        eq(schema.shopifyCreditLedger.storeId, row.storeId),
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

const observed = (row: Row, test = false) => ({
  id: row.shopifyChargeId as string,
  status: 'ACTIVE',
  test,
});

/** An app whose env has the given overrides, sharing everything else with the real one. */
function withEnv(overrides: Record<string, unknown>) {
  return Object.assign(Object.create(app), { env: { ...app.env, ...overrides } });
}

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
  store = await makeStore('verify-test.myshopify.com', 600000001);
  devStore = await makeStore('verify-dev.myshopify.com', 600000002, true);
  overflowStore = await makeStore('verify-overflow.myshopify.com', 600000003);
}, 60000);

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('grantForPurchase with SHOPIFY_VERIFY_PAYMENTS', () => {
  it('grants once and marks the purchase UNVERIFIED with the first check 15 minutes out', async () => {
    const row = await purchase();
    const before = Date.now();
    const granted = await grantForPurchase(
      withEnv({ SHOPIFY_VERIFY_PAYMENTS: true }),
      store,
      row,
      observed(row),
    );

    expect(granted).toBe(800);
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('UNVERIFIED');
    expect(fresh.paymentStatusSource).toBe('AUTO');
    const due = fresh.nextPaymentCheckAt?.getTime() ?? 0;
    expect(due).toBeGreaterThanOrEqual(before + 14 * 60_000);
    expect(due).toBeLessThanOrEqual(Date.now() + 16 * 60_000);
    const ledger = await ledgerFor(row);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 800, reason: 'SHOPIFY_PACK' });
  });

  it('a replay grants nothing more and leaves one ledger row', async () => {
    const row = await purchase();
    const verifyApp = withEnv({ SHOPIFY_VERIFY_PAYMENTS: true });
    expect(await grantForPurchase(verifyApp, store, row, observed(row))).toBe(800);
    // Same stale snapshot again (a webhook replay or a confirm revisit).
    expect(await grantForPurchase(verifyApp, store, row, observed(row))).toBe(0);
    expect(await ledgerFor(row)).toHaveLength(1);
    expect((await reload(row)).paymentStatus).toBe('UNVERIFIED');
  });

  it('two concurrent callers grant exactly once', async () => {
    const row = await purchase();
    const verifyApp = withEnv({ SHOPIFY_VERIFY_PAYMENTS: true });
    const results = await Promise.all([
      grantForPurchase(verifyApp, store, row, observed(row)),
      grantForPurchase(verifyApp, store, row, observed(row)),
    ]);
    expect(results.filter((n) => n > 0)).toHaveLength(1);
    expect(await ledgerFor(row)).toHaveLength(1);
  });

  it('still ends UNVERIFIED when the credits were already granted before the flag was on', async () => {
    const row = await purchase();
    await grantStore(app.db, store.id, 800, 'SHOPIFY_PACK', `shopify_pack:${row.shopifyChargeId}`);
    const granted = await grantForPurchase(
      withEnv({ SHOPIFY_VERIFY_PAYMENTS: true }),
      store,
      row,
      observed(row),
    );
    expect(granted).toBe(0); // the ledger entry already existed
    expect((await reload(row)).paymentStatus).toBe('UNVERIFIED');
    expect(await ledgerFor(row)).toHaveLength(1);
  });

  it('leaves a test charge on a development store untracked (it never gets a sale)', async () => {
    const row = await purchase({}, devStore);
    const granted = await grantForPurchase(
      withEnv({ SHOPIFY_VERIFY_PAYMENTS: true }),
      devStore,
      row,
      observed(row, true),
    );
    expect(granted).toBe(800);
    expect((await reload(row)).paymentStatus).toBe('NOT_REQUIRED');
    expect((await ledgerFor(row))[0]).toMatchObject({ reason: 'SHOPIFY_PACK_TEST' });
  });

  it('with the flag off behaves as before: grants and stays NOT_REQUIRED', async () => {
    const row = await purchase();
    expect(await grantForPurchase(app, store, row, observed(row))).toBe(800);
    expect((await reload(row)).paymentStatus).toBe('NOT_REQUIRED');
  });

  it('the hold takes precedence when both flags are on: held, not granted, not verified', async () => {
    const row = await purchase();
    const both = withEnv({ SHOPIFY_VERIFY_PAYMENTS: true, SHOPIFY_HOLD_UNTIL_PAID: true });
    expect(await grantForPurchase(both, store, row, observed(row))).toBe(0);
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
    expect(await ledgerFor(row)).toHaveLength(0);
  });

  it('rolls the UNVERIFIED mark back when the grant fails (one transaction)', async () => {
    // A balance at the 32-bit maximum makes the credit upsert overflow inside the grant.
    await app.db
      .insert(schema.shopifyStoreCredits)
      .values({ storeId: overflowStore.id, balance: 2147483647 });
    const row = await purchase({}, overflowStore);
    await expect(
      grantForPurchase(
        withEnv({ SHOPIFY_VERIFY_PAYMENTS: true }),
        overflowStore,
        row,
        observed(row),
      ),
    ).rejects.toThrow();
    expect((await reload(row)).paymentStatus).toBe('NOT_REQUIRED');
    expect(await ledgerFor(row)).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-payment-verification`
Expected: FAIL — the first test sees `granted` 800 but `paymentStatus` still `NOT_REQUIRED`.

- [ ] **Step 8: Implement the transactional mark+grant**

In `apps/api/src/modules/shopify/purchase.ts` add to the imports:

```ts
import { VERIFY_FIRST_CHECK_MS } from './payment-verification.js';
```

Then, directly before the comment line `  // The bound on test-funded credits. Counted from the ledger rather than a`, insert:

```ts
  // Grant-then-verify: the merchant gets credits at approval as always, but the
  // purchase is marked UNVERIFIED so a later Partner API pass can confirm Shopify
  // collected the money. Mark and grant share ONE transaction: marking first and
  // granting after could strand a row marked-but-ungranted (the early return on
  // `paymentStatus !== 'NOT_REQUIRED'` above would then block every retry), and
  // the reverse would grant an untracked purchase. The conditional UPDATE is the
  // race guard — a concurrent caller that loses it gets no row back and grants
  // nothing; grantStore's external_ref idempotency stays underneath. Reached only
  // when the hold above did not return (it returns for every real charge while
  // SHOPIFY_HOLD_UNTIL_PAID is on, so the hold wins when both flags are set).
  // Test charges never get a sale and so are not tracked.
  if (!observed.test && app.env.SHOPIFY_VERIFY_PAYMENTS === true) {
    const externalRef = `shopify_pack:${observed.id}`;
    return app.db.transaction(async (tx) => {
      const marked = await tx
        .update(schema.shopifyCreditPurchases)
        .set({
          paymentStatus: 'UNVERIFIED',
          nextPaymentCheckAt: new Date(Date.now() + VERIFY_FIRST_CHECK_MS),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.shopifyCreditPurchases.id, purchaseRow.id),
            eq(schema.shopifyCreditPurchases.paymentStatus, 'NOT_REQUIRED'),
          ),
        )
        .returning({ id: schema.shopifyCreditPurchases.id });
      if (marked.length === 0) return 0;

      const { granted } = await grantStore(
        tx as never,
        purchaseRow.storeId,
        purchaseRow.credits,
        'SHOPIFY_PACK',
        externalRef,
      );
      return granted ? purchaseRow.credits : 0;
    });
  }

```

- [ ] **Step 9: Run the tests**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-payment-verification shopify-payment-settlement shopify-purchase`
Expected: PASS — the new file (8 tests) and the existing settlement and purchase files (flag off paths unchanged). Then `pnpm --filter @aivastra/api typecheck` (exit 0).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/shopify/payment-verification.ts apps/api/src/modules/shopify/payment-settlement.ts apps/api/src/modules/shopify/purchase.ts apps/api/test/shopify-payment-verification-schedule.test.ts apps/api/test/integration/shopify-payment-verification.test.ts
git commit -m "feat(shopify): mark purchases UNVERIFIED in the same transaction as the grant"
```

---

### Task 3: Verification of granted purchases

**Files:**
- Modify: `apps/api/src/modules/shopify/payment-settlement.ts` (extract `fetchSalesForRows`)
- Modify: `apps/api/src/modules/shopify/payment-verification.ts` (add `verifyGrantedPurchases`)
- Test: `apps/api/test/integration/shopify-payment-verification.test.ts` (append)

**Interfaces:**
- Consumes: `decideNoSale`, `verifyWindowMs` (Task 2); `FetchOneTimeSales`, `OneTimeSale`, `numericChargeId`, `PartnerApiError` from `./partner-api.js`.
- Produces:
  ```ts
  // payment-settlement.ts
  export interface SalesFetchOptions { shop?: string; fetchSales?: FetchOneTimeSales; now?: Date }
  export async function fetchSalesForRows(app: FastifyInstance, rows: PurchaseRow[], opts?: SalesFetchOptions): Promise<Map<string, OneTimeSale>>;   // throws PartnerApiError; bumps the failure counter; sets last-success on success
  // payment-verification.ts
  export interface VerifyOptions extends SalesFetchOptions { windowMs?: number; onRowError?: (row: PurchaseRow, err: unknown) => void }
  export async function verifyGrantedPurchases(app: FastifyInstance, rows: PurchaseRow[], opts?: VerifyOptions): Promise<void>;   // throws PartnerApiError WITHOUT touching a row
  ```

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/integration/shopify-payment-verification.test.ts`. Add these imports at the top: `import { PartnerApiError } from '../../src/modules/shopify/partner-api.js';` and `import { verifyGrantedPurchases } from '../../src/modules/shopify/payment-verification.js';`. Then append:

```ts
const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** A granted purchase waiting for confirmation. Charge ids are unique per call. */
async function unverified(overrides: Partial<Row> = {}): Promise<Row> {
  return purchase({
    paymentStatus: 'UNVERIFIED',
    nextPaymentCheckAt: new Date(Date.now() - MIN_MS),
    ...overrides,
  });
}

const saleFor = (row: Row, paidAt = new Date('2026-10-09T06:39:29Z')) => async () =>
  new Map([[(row.shopifyChargeId as string).split('/').pop() as string, { paidAt }]]);
const noSales = async () => new Map();

describe('verifyGrantedPurchases', () => {
  it('a sale marks the purchase PAID with the sale time and never grants again', async () => {
    const row = await unverified();
    await verifyGrantedPurchases(app, [row], { fetchSales: saleFor(row) });

    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('PAID');
    expect(fresh.paidAt?.toISOString()).toBe('2026-10-09T06:39:29.000Z');
    expect(fresh.nextPaymentCheckAt).toBeNull();
    expect(await ledgerFor(row)).toHaveLength(0); // credits were given at approval, not here
  });

  it('a sale also rescues a NOT_RECEIVED purchase', async () => {
    const row = await unverified({ paymentStatus: 'NOT_RECEIVED' });
    await verifyGrantedPurchases(app, [row], { fetchSales: saleFor(row) });
    expect((await reload(row)).paymentStatus).toBe('PAID');
  });

  it('no sale inside the window keeps it UNVERIFIED and re-checks in 15 minutes', async () => {
    const row = await unverified({ createdAt: new Date() });
    const now = new Date();
    await verifyGrantedPurchases(app, [row], { fetchSales: noSales, now });
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('UNVERIFIED');
    expect(fresh.nextPaymentCheckAt?.getTime()).toBe(now.getTime() + 15 * MIN_MS);
  });

  it('no sale once the window has passed marks it NOT_RECEIVED and re-checks tomorrow', async () => {
    const row = await unverified({ createdAt: new Date(Date.now() - 4 * HOUR_MS) });
    const now = new Date();
    await verifyGrantedPurchases(app, [row], { fetchSales: noSales, now });
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('NOT_RECEIVED');
    expect(fresh.nextPaymentCheckAt?.getTime()).toBe(now.getTime() + DAY_MS);
    expect(await ledgerFor(row)).toHaveLength(0);
  });

  it('stops re-checking a NOT_RECEIVED purchase after 30 days', async () => {
    const row = await unverified({
      paymentStatus: 'NOT_RECEIVED',
      createdAt: new Date(Date.now() - 31 * DAY_MS),
    });
    await verifyGrantedPurchases(app, [row], { fetchSales: noSales });
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('NOT_RECEIVED');
    expect(fresh.nextPaymentCheckAt).toBeNull();
  });

  it('fails closed: a Partner API failure changes nothing, even for a past-window row', async () => {
    const row = await unverified({ createdAt: new Date(Date.now() - 5 * HOUR_MS) });
    const before = await reload(row);
    await expect(
      verifyGrantedPurchases(app, [row], {
        fetchSales: async () => {
          throw new PartnerApiError('http', 'down');
        },
      }),
    ).rejects.toBeInstanceOf(PartnerApiError);

    const after = await reload(row);
    expect(after.paymentStatus).toBe('UNVERIFIED'); // NOT marked NOT_RECEIVED
    expect(after.nextPaymentCheckAt?.getTime()).toBe(before.nextPaymentCheckAt?.getTime());
  });

  it('leaves an admin override alone even when a sale exists', async () => {
    const row = await unverified({ paymentStatus: 'NOT_RECEIVED', paymentStatusSource: 'MANUAL' });
    await verifyGrantedPurchases(app, [row], { fetchSales: saleFor(row) });
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('NOT_RECEIVED');
    expect(fresh.paymentStatusSource).toBe('MANUAL');
    expect(fresh.paidAt).toBeNull();
  });

  it('never touches a held (hold-until-paid) row', async () => {
    const row = await purchase({
      paymentStatus: 'AWAITING',
      nextPaymentCheckAt: new Date(Date.now() - MIN_MS),
    });
    await verifyGrantedPurchases(app, [row], { fetchSales: saleFor(row) });
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-payment-verification -t "verifyGrantedPurchases"`
Expected: FAIL (`verifyGrantedPurchases` is not exported).

- [ ] **Step 3: Extract the shared sales fetch in `payment-settlement.ts`**

In `apps/api/src/modules/shopify/payment-settlement.ts`:

1. Add `type OneTimeSale` to the import from `./partner-api.js`:

```ts
import {
  type FetchOneTimeSales,
  fetchOneTimeSales,
  numericChargeId,
  type OneTimeSale,
  PartnerApiError,
} from './partner-api.js';
```

2. Directly above `export interface CheckOptions`, add:

```ts
export interface SalesFetchOptions {
  /** Narrows the Partner API query to one store — used by single-purchase checks. */
  shop?: string;
  fetchSales?: FetchOneTimeSales;
  now?: Date;
}

/**
 * One Partner API query covering `rows`: every sale since the oldest row's
 * createdAt (minus slack). Shared by the hold-until-paid settlement and the
 * grant-then-verify pass so both bump the same failure counter and last-success
 * gauge. Throws PartnerApiError on any failure — callers must treat that as
 * "learned nothing" and leave every row untouched.
 */
export async function fetchSalesForRows(
  app: FastifyInstance,
  rows: PurchaseRow[],
  opts: SalesFetchOptions = {},
): Promise<Map<string, OneTimeSale>> {
  const now = opts.now ?? new Date();
  const fetchSales = opts.fetchSales ?? fetchOneTimeSales;
  const oldest = Math.min(...rows.map((r) => r.createdAt.getTime()));

  let sales: Map<string, OneTimeSale>;
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
  return sales;
}
```

3. In `checkPurchases`, replace the block from `const now = opts.now ?? new Date();` through `shopifyPaymentCheckLastSuccess.set(Math.floor(now.getTime() / 1000));` (the `fetchSales`/`oldest` consts, the `let sales`, the try/catch and the gauge set) with:

```ts
  const now = opts.now ?? new Date();
  const sales = await fetchSalesForRows(app, checkable, opts);
```

Run the existing hold-until-paid tests now to prove the refactor changed nothing: from `apps/api`, `npx vitest run --config vitest.integration.config.ts shopify-payment-settlement`. Expected: PASS (all existing tests).

- [ ] **Step 4: Add `verifyGrantedPurchases`**

In `apps/api/src/modules/shopify/payment-verification.ts`, add these imports at the top of the file (above the doc comment):

```ts
import { schema } from '@aivastra/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { numericChargeId } from './partner-api.js';
import { fetchSalesForRows, type SalesFetchOptions } from './payment-settlement.js';

type PurchaseRow = typeof schema.shopifyCreditPurchases.$inferSelect;
```

and append at the end of the file:

```ts
export interface VerifyOptions extends SalesFetchOptions {
  /** Defaults to verifyWindowMs(app.env). */
  windowMs?: number;
  /**
   * Called from the per-row catch, alongside the log, so a single-row caller (the
   * admin action) can re-raise a failure this function otherwise swallows to
   * protect a batch.
   */
  onRowError?: (row: PurchaseRow, err: unknown) => void;
}

/**
 * One Partner API query for all `rows`, then confirm / re-schedule / flag each.
 *
 * - sale found -> PAID with the sale's time. NEVER grants: the credits were given
 *   at approval, so this only records what Shopify did.
 * - no sale -> decideNoSale (stay UNVERIFIED inside the window, NOT_RECEIVED after).
 *
 * Throws PartnerApiError on any API failure WITHOUT touching a row: absence of a
 * sale only means something after a successful query, so a failed query must never
 * push a row toward NOT_RECEIVED. Every update is conditional on the row still
 * being an automatic UNVERIFIED/NOT_RECEIVED one, so a concurrent admin override
 * (source MANUAL) always wins.
 */
export async function verifyGrantedPurchases(
  app: FastifyInstance,
  rows: PurchaseRow[],
  opts: VerifyOptions = {},
): Promise<void> {
  const checkable = rows.filter((r) => r.shopifyChargeId);
  if (checkable.length === 0) return;

  const now = opts.now ?? new Date();
  const windowMs = opts.windowMs ?? verifyWindowMs(app.env);
  const sales = await fetchSalesForRows(app, checkable, opts);

  const P = schema.shopifyCreditPurchases;
  for (const row of checkable) {
    try {
      const sale = sales.get(numericChargeId(row.shopifyChargeId as string));
      const stillAutomatic = and(
        eq(P.id, row.id),
        inArray(P.paymentStatus, ['UNVERIFIED', 'NOT_RECEIVED']),
        eq(P.paymentStatusSource, 'AUTO'),
      );
      if (sale) {
        await app.db
          .update(P)
          .set({
            paymentStatus: 'PAID',
            paidAt: sale.paidAt,
            nextPaymentCheckAt: null,
            updatedAt: now,
          })
          .where(stillAutomatic);
        continue;
      }
      const decision = decideNoSale(row.createdAt, now, windowMs);
      await app.db
        .update(P)
        .set({
          paymentStatus: decision.status,
          nextPaymentCheckAt: decision.nextCheckAt,
          updatedAt: now,
        })
        .where(stillAutomatic);
    } catch (err) {
      // One row's DB failure must not abandon the rest of the batch.
      app.log.error({ err, purchaseId: row.id }, 'payment verification failed for purchase');
      opts.onRowError?.(row, err);
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-payment-verification shopify-payment-settlement`
Expected: PASS (all). Then `pnpm --filter @aivastra/api typecheck` (exit 0).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/shopify/payment-settlement.ts apps/api/src/modules/shopify/payment-verification.ts apps/api/test/integration/shopify-payment-verification.test.ts
git commit -m "feat(shopify): verify granted purchases against Partner API sales"
```

---

### Task 4: Verification pass in the settlement loop

**Files:**
- Modify: `apps/api/src/modules/shopify/payment-verification.ts` (add `runVerificationPass`)
- Modify: `apps/api/src/modules/shopify/payment-settlement-scheduler.ts`
- Test: `apps/api/test/integration/shopify-payment-verification.test.ts` (append)

**Interfaces:**
- Consumes: `verifyGrantedPurchases`, the gauges from Task 1.
- Produces:
  ```ts
  export async function runVerificationPass(app: FastifyInstance, opts?: { fetchSales?: FetchOneTimeSales; now?: Date }): Promise<void>;
  ```
  The existing `runPaymentSettlementTick(app, opts)` calls it as its last step, regardless of any flag (so rows already tracked keep being checked after a rollback).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/integration/shopify-payment-verification.test.ts`. Add imports: `import { register } from '@aivastra/observability';`, `import { sql } from 'drizzle-orm';` (merge with the existing `drizzle-orm` import), `import { vi } from 'vitest';` (merge with the existing vitest import), and `import { runPaymentSettlementTick } from '../../src/modules/shopify/payment-settlement-scheduler.js';`. Then append:

```ts
async function gauge(name: string): Promise<number | undefined> {
  const metric = await register.getSingleMetric(name)?.get();
  return metric?.values[0]?.value;
}

async function dbCount(statuses: string[], extra = sql`true`): Promise<number> {
  const [{ n }] = await app.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.shopifyCreditPurchases)
    .where(
      sql`${schema.shopifyCreditPurchases.paymentStatus} IN (${sql.join(
        statuses.map((s) => sql`${s}`),
        sql`, `,
      )}) AND ${extra}`,
    );
  return n;
}

describe('settlement tick - verification pass', () => {
  it('confirms due rows, skips rows not yet due, and sets the gauges from the database', async () => {
    const due = await unverified();
    const later = await unverified({ nextPaymentCheckAt: new Date(Date.now() + HOUR_MS) });
    const sales = new Map(
      [due, later].map((r) => [
        (r.shopifyChargeId as string).split('/').pop() as string,
        { paidAt: new Date() },
      ]),
    );

    await runPaymentSettlementTick(app, { fetchSales: async () => sales });

    expect((await reload(due)).paymentStatus).toBe('PAID');
    expect((await reload(later)).paymentStatus).toBe('UNVERIFIED'); // not due, so not looked at
    expect(await gauge('shopify_purchases_unverified')).toBe(await dbCount(['UNVERIFIED']));
    expect(await gauge('shopify_purchases_not_received')).toBe(await dbCount(['NOT_RECEIVED']));
  });

  it('an outage leaves a past-window row UNVERIFIED, logs, and raises the overdue gauge', async () => {
    const row = await unverified({
      createdAt: new Date(Date.now() - 5 * HOUR_MS),
      nextPaymentCheckAt: new Date(Date.now() - 2 * HOUR_MS),
    });
    const logError = vi.spyOn(app.log, 'error').mockImplementation(() => undefined);
    try {
      await runPaymentSettlementTick(app, {
        fetchSales: async () => {
          throw new PartnerApiError('http', 'down');
        },
      });
      expect(logError).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(PartnerApiError) }),
        'payment verification check failed — purchases stay unverified',
      );
    } finally {
      logError.mockRestore();
    }

    expect((await reload(row)).paymentStatus).toBe('UNVERIFIED'); // never NOT_RECEIVED on a failed query
    const overdueRows = await dbCount(
      ['UNVERIFIED', 'NOT_RECEIVED'],
      sql`${schema.shopifyCreditPurchases.paymentStatusSource} = 'AUTO'
        AND ${schema.shopifyCreditPurchases.nextPaymentCheckAt} < now() - interval '1 hour'`,
    );
    expect(overdueRows).toBeGreaterThanOrEqual(1);
    expect(await gauge('shopify_purchases_overdue_verification')).toBe(overdueRows);

    // Park the row so it cannot influence later tests.
    await app.db
      .update(schema.shopifyCreditPurchases)
      .set({ nextPaymentCheckAt: new Date(Date.now() + 30 * DAY_MS) })
      .where(eq(schema.shopifyCreditPurchases.id, row.id));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-payment-verification -t "verification pass"`
Expected: FAIL (the tick does not touch UNVERIFIED rows yet).

- [ ] **Step 3: Add `runVerificationPass`**

In `apps/api/src/modules/shopify/payment-verification.ts`, extend the imports:

```ts
import { schema } from '@aivastra/db';
import {
  shopifyPurchasesNotReceived,
  shopifyPurchasesOverdueVerification,
  shopifyPurchasesUnverified,
} from '@aivastra/observability';
import { and, asc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type FetchOneTimeSales, numericChargeId } from './partner-api.js';
import { fetchSalesForRows, type SalesFetchOptions } from './payment-settlement.js';
```

(replace the earlier narrower import lines for `@aivastra/db`, `drizzle-orm`, `./partner-api.js` and `./payment-settlement.js` with these), and append:

```ts
/** One pass settles at most this many purchases; the rest wait for the next tick. */
const BATCH = 200;
/** A row this far past its next check is stuck, not merely backing off. */
const OVERDUE_GRACE_MS = 60 * MIN;

/**
 * The verification half of the settlement tick: check every automatic
 * UNVERIFIED/NOT_RECEIVED purchase whose next check is due, then refresh the
 * gauges. Runs regardless of SHOPIFY_VERIFY_PAYMENTS so that turning the flag
 * off (the rollback) still lets already-tracked rows reach PAID.
 */
export async function runVerificationPass(
  app: FastifyInstance,
  opts: { fetchSales?: FetchOneTimeSales; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const P = schema.shopifyCreditPurchases;
  const tracked = inArray(P.paymentStatus, ['UNVERIFIED', 'NOT_RECEIVED']);

  const due = await app.db
    .select()
    .from(P)
    .where(
      and(
        tracked,
        eq(P.paymentStatusSource, 'AUTO'),
        isNotNull(P.shopifyChargeId),
        lte(P.nextPaymentCheckAt, now),
      ),
    )
    .orderBy(asc(P.nextPaymentCheckAt))
    .limit(BATCH);

  if (due.length > 0) {
    try {
      await verifyGrantedPurchases(app, due, { fetchSales: opts.fetchSales, now });
    } catch (err) {
      // Fail closed: rows stay as they are and are retried next tick. Logged every
      // tick on purpose — together with the overdue gauge this is the alert.
      app.log.error(
        { err, due: due.length },
        'payment verification check failed — purchases stay unverified',
      );
    }
  }

  const counts = await app.db
    .select({ status: P.paymentStatus, n: sql<number>`count(*)::int` })
    .from(P)
    .where(tracked)
    .groupBy(P.paymentStatus);
  shopifyPurchasesUnverified.set(counts.find((c) => c.status === 'UNVERIFIED')?.n ?? 0);
  shopifyPurchasesNotReceived.set(counts.find((c) => c.status === 'NOT_RECEIVED')?.n ?? 0);

  // The alertable signal: "last success" only advances when rows are due, so it
  // goes stale on a healthy system; a row overdue by an hour can only mean the
  // loop is failing or not keeping up.
  const [{ overdue }] = await app.db
    .select({ overdue: sql<number>`count(*)::int` })
    .from(P)
    .where(
      and(
        tracked,
        eq(P.paymentStatusSource, 'AUTO'),
        lt(P.nextPaymentCheckAt, new Date(now.getTime() - OVERDUE_GRACE_MS)),
      ),
    );
  shopifyPurchasesOverdueVerification.set(overdue);
}
```

- [ ] **Step 4: Call it from the tick**

In `apps/api/src/modules/shopify/payment-settlement-scheduler.ts` add the import:

```ts
import { runVerificationPass } from './payment-verification.js';
```

and, as the LAST statement of `runPaymentSettlementTick` (after `shopifyPurchasesOverduePaymentCheck.set(overdue);`), add:

```ts

  // Grant-then-verify: confirm purchases that were granted at approval.
  await runVerificationPass(app, opts);
```

Update the function's doc comment first sentence to: `One pass: settle every AWAITING purchase whose next check is due, then verify granted purchases.`

- [ ] **Step 5: Run the tests**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-payment-verification shopify-payment-settlement`
Expected: PASS (all, including the existing tick tests). Then `pnpm --filter @aivastra/api typecheck` (exit 0).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/shopify/payment-verification.ts apps/api/src/modules/shopify/payment-settlement-scheduler.ts apps/api/test/integration/shopify-payment-verification.test.ts
git commit -m "feat(shopify): verification pass in the settlement loop with gauges"
```

---

### Task 5: `/me` and the Shopify app treat granted purchases as landed

**Files:**
- Modify: `apps/api/src/modules/shopify/me.routes.ts`
- Modify: `apps/shopify/src/lib/purchase-wait.ts`, `apps/shopify/src/types.ts`
- Test: `apps/api/test/integration/shopify-me-held-purchase.test.ts` (extend), `apps/shopify/src/lib/purchase-wait.test.ts` (extend)

**Interfaces:**
- Produces: `GET /v1/shopify/me` → `hasPurchasedPack`/`currentPack` true for `UNVERIFIED` and `NOT_RECEIVED`. `creditsLanded(r)` returns true for `PAID`, or for `NOT_REQUIRED`/`UNVERIFIED`/`NOT_RECEIVED` with `creditsGranted > 0`. `PurchasePaymentStatus` gains the two values.

- [ ] **Step 1: Write the failing API tests**

In `apps/api/test/integration/shopify-me-held-purchase.test.ts`, change the `meFor` parameter type from the four-value union to `string`:

```ts
async function meFor(paymentStatus: string) {
```

and append inside the existing `describe('GET /v1/shopify/me - hasPurchasedPack with an ACTIVE charge', …)` block, before its closing `});`:

```ts

  it('is true for UNVERIFIED (credits were granted at approval, payment not yet confirmed)', async () => {
    const body = await meFor('UNVERIFIED');
    expect(body.hasPurchasedPack).toBe(true);
    expect(body.currentPack).toEqual({ id: 'pack_10', label: 'Silver' });
  });

  it('is true for NOT_RECEIVED (credits were delivered; the payment is flagged separately)', async () => {
    const body = await meFor('NOT_RECEIVED');
    expect(body.hasPurchasedPack).toBe(true);
    expect(body.currentPack).toEqual({ id: 'pack_10', label: 'Silver' });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-me-held-purchase`
Expected: FAIL — the two new cases get `hasPurchasedPack` false.

- [ ] **Step 3: Update `me.routes.ts`**

Replace the `inArray(...)` line and its comment block. In `apps/api/src/modules/shopify/me.routes.ts` change:

```ts
          inArray(schema.shopifyCreditPurchases.paymentStatus, ['NOT_REQUIRED', 'PAID']),
```

to:

```ts
          inArray(schema.shopifyCreditPurchases.paymentStatus, [
            'NOT_REQUIRED',
            'PAID',
            'UNVERIFIED',
            'NOT_RECEIVED',
          ]),
```

and extend the comment directly above the query (the one beginning "Dashboard's free-credits tile stays up until the store has actually PAID") by appending these lines to it:

```ts
    // UNVERIFIED and NOT_RECEIVED are grant-then-verify states: the credits WERE
    // delivered at approval and only the payment confirmation is pending/missing,
    // so they count — the merchant has the pack. Only the hold-until-paid states
    // AWAITING/UNPAID (credits withheld) stay excluded.
```

- [ ] **Step 4: Write the failing Shopify app tests**

In `apps/shopify/src/lib/purchase-wait.test.ts`, inside the existing `describe('creditsLanded', …)` block, add before its closing `});`:

```ts
  it('UNVERIFIED and NOT_RECEIVED count only when something was actually granted', () => {
    expect(creditsLanded(r('UNVERIFIED', 800))).toBe(true);
    expect(creditsLanded(r('UNVERIFIED', 0))).toBe(false);
    expect(creditsLanded(r('NOT_RECEIVED', 800))).toBe(true);
    expect(creditsLanded(r('NOT_RECEIVED', 0))).toBe(false);
  });
```

Run: `pnpm --filter @aivastra/shopify-admin test`
Expected: FAIL (`creditsLanded(r('UNVERIFIED', 800))` is false).

- [ ] **Step 5: Update the Shopify app**

In `apps/shopify/src/lib/purchase-wait.ts` replace the `creditsLanded` doc comment and function with:

```ts
/**
 * Whether a confirm result means credits actually landed. PAID is enough on its
 * own: in hold mode `creditsGranted` is advisory and can be 0 when another
 * process granted first. The states below grant at approval and so report an
 * accurate `creditsGranted` for the call that did it — but NOT_REQUIRED also
 * covers outcomes that grant nothing (test charge refused on a non-development
 * store, test grant limit reached, charge not ACTIVE), so require it. UNVERIFIED
 * and NOT_RECEIVED are grant-then-verify states: credits were given at approval.
 */
const GRANTED_AT_APPROVAL = new Set(['NOT_REQUIRED', 'UNVERIFIED', 'NOT_RECEIVED']);

export function creditsLanded(r: { paymentStatus: string; creditsGranted: number }): boolean {
  return r.paymentStatus === 'PAID' || (GRANTED_AT_APPROVAL.has(r.paymentStatus) && r.creditsGranted > 0);
}
```

In `apps/shopify/src/types.ts` change:

```ts
export type PurchasePaymentStatus = 'NOT_REQUIRED' | 'AWAITING' | 'PAID' | 'UNPAID';
```

to:

```ts
export type PurchasePaymentStatus =
  | 'NOT_REQUIRED'
  | 'UNVERIFIED'
  | 'PAID'
  | 'NOT_RECEIVED'
  | 'AWAITING'
  | 'UNPAID';
```

- [ ] **Step 6: Run everything for this task**

Run: `npx biome check --write apps/shopify/src/lib/purchase-wait.ts apps/shopify/src/types.ts`
Run: `pnpm --filter @aivastra/shopify-admin test` and `pnpm --filter @aivastra/shopify-admin build` (both exit 0; tests pass).
Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-me-held-purchase` (PASS) and `pnpm --filter @aivastra/api typecheck` (exit 0).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/shopify/me.routes.ts apps/api/test/integration/shopify-me-held-purchase.test.ts apps/shopify/src/lib/purchase-wait.ts apps/shopify/src/lib/purchase-wait.test.ts apps/shopify/src/types.ts
git commit -m "feat(shopify): count grant-then-verify purchases as bought in /me and the app"
```

---

### Task 6: Admin API — list, review, extended check-payment

**Files:**
- Create: `apps/api/src/modules/admin/shopify-purchases.routes.ts`
- Modify: `apps/api/src/modules/admin/shopify-stores.routes.ts` (`adminCheckPurchasePayment`, the per-store purchases select)
- Modify: `apps/api/src/server.ts` (register)
- Test: `apps/api/test/integration/admin-shopify-purchases.test.ts`

**Interfaces:**
- Consumes: `verifyGrantedPurchases`, `verifyWindowMs` (Tasks 2–3); `recordAudit(tx, { actor, action, resourceType, resourceId, before, after, request })` from `./audit.js`; `requirePermission` from `./guard.js`; `AppError('CONFLICT', 409, …)`.
- Produces:
  - `GET /admin/shopify/purchases?paymentStatus=a,b&storeId=&q=&from=&to=&needsAttention=true&cursor=&limit=` (`shopify_stores.read`) → `{ purchases: PackPurchaseRow[]; nextCursor: string | null }` where each row has `id, storeId, shopDomain, packId, credits, priceUsdCents, status, paymentStatus, paymentStatusSource, paidAt, paymentNote, paymentFlaggedAt, flaggedByName, flaggedByEmail, createdAt, shopifyChargeId, creditsGrantedAt`
  - `POST /admin/shopify/purchases/:id/payment-review` (`credits.write`), body `{ status?: 'PAID' | 'NOT_RECEIVED' | 'AUTO'; note: string }`, and the exported `adminReviewPurchasePayment(app, purchaseId, body, actor, request): Promise<{ paymentStatus; paymentStatusSource; paymentNote; paymentFlaggedAt }>`
  - `adminCheckPurchasePayment` additionally verifies `UNVERIFIED`/`NOT_RECEIVED` AUTO rows (no grant, no audit) and returns 409 for `MANUAL` ones.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/integration/admin-shopify-purchases.test.ts`:

```ts
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminCheckPurchasePayment,
  adminReviewPurchasePayment,
} from '../../src/modules/admin/shopify-purchases.routes.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

let ctx: Containers;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let storeA: typeof schema.shopifyStores.$inferSelect;
let storeB: typeof schema.shopifyStores.$inferSelect;
let adminUserId: string;
let seq = 0;

type Row = typeof schema.shopifyCreditPurchases.$inferSelect;
const MIN = 60_000;
const HOUR = 60 * MIN;

const fakeRequest = { id: 'req-1', ip: '127.0.0.1', headers: {} } as unknown as FastifyRequest;

async function makeStore(domain: string, shopId: number) {
  const [s] = await app.db
    .insert(schema.shopifyStores)
    .values({ shopDomain: domain, shopifyShopId: shopId, accessToken: 'enc:token', scope: 'read_products' })
    .returning();
  return s;
}

async function purchase(overrides: Partial<Row> = {}, forStore = storeA): Promise<Row> {
  seq += 1;
  const [row] = await app.db
    .insert(schema.shopifyCreditPurchases)
    .values({
      storeId: forStore.id,
      packId: 'pack_10',
      credits: 800,
      priceUsdCents: 1000,
      status: 'ACTIVE',
      shopifyChargeId: `gid://shopify/AppPurchaseOneTime/${4000 + seq}`,
      paymentStatus: 'UNVERIFIED',
      ...overrides,
    })
    .returning();
  return row;
}

async function reload(row: Row): Promise<Row> {
  const [fresh] = await app.db
    .select()
    .from(schema.shopifyCreditPurchases)
    .where(eq(schema.shopifyCreditPurchases.id, row.id));
  return fresh;
}

async function auditRows(row: Row) {
  return app.db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.resourceId, row.id),
        eq(schema.auditLogs.action, 'shopify_purchase.payment_review'),
      ),
    );
}

const actor = () => ({ userId: adminUserId, role: 'SUPER_ADMIN' });

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
  storeA = await makeStore('admin-list-a.myshopify.com', 700000001);
  storeB = await makeStore('admin-list-b.myshopify.com', 700000002);
  // adminAuthHeader creates a real admin user; recover its id for direct calls.
  await adminAuthHeader(app, 'SUPER_ADMIN');
  const [u] = await app.db.select({ id: schema.adminUsers.userId }).from(schema.adminUsers).limit(1);
  adminUserId = u.id;
}, 60000);

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('GET /admin/shopify/purchases', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/shopify/purchases' });
    expect(res.statusCode).toBe(401);
  });

  it('lists only approved manual purchases, newest first, with store domain and filters', async () => {
    const paid = await purchase({ paymentStatus: 'PAID', createdAt: new Date(Date.now() - 3 * HOUR) });
    const notReceived = await purchase({ paymentStatus: 'NOT_RECEIVED', createdAt: new Date(Date.now() - 2 * HOUR) });
    const other = await purchase({ paymentStatus: 'UNVERIFIED' }, storeB);
    await purchase({ status: 'PENDING', paymentStatus: 'NOT_REQUIRED' }); // never approved: hidden
    await purchase({ source: 'autorefill', paymentStatus: 'NOT_REQUIRED' }); // auto-refill: hidden

    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const all = (await app.inject({ method: 'GET', url: '/admin/shopify/purchases?limit=100', headers })).json();
    const ids = all.purchases.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([paid.id, notReceived.id, other.id]));
    expect(all.purchases.every((p: { status: string }) => p.status === 'ACTIVE')).toBe(true);
    expect(all.purchases.find((p: { id: string }) => p.id === other.id).shopDomain).toBe(
      'admin-list-b.myshopify.com',
    );
    // newest first
    const times = all.purchases.map((p: { createdAt: string }) => new Date(p.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const byStatus = (
      await app.inject({ method: 'GET', url: '/admin/shopify/purchases?paymentStatus=NOT_RECEIVED&limit=100', headers })
    ).json();
    expect(byStatus.purchases.every((p: { paymentStatus: string }) => p.paymentStatus === 'NOT_RECEIVED')).toBe(true);
    expect(byStatus.purchases.map((p: { id: string }) => p.id)).toContain(notReceived.id);

    const byStore = (
      await app.inject({ method: 'GET', url: `/admin/shopify/purchases?storeId=${storeB.id}&limit=100`, headers })
    ).json();
    expect(byStore.purchases.map((p: { id: string }) => p.id)).toEqual([other.id]);

    const byQuery = (
      await app.inject({ method: 'GET', url: '/admin/shopify/purchases?q=admin-list-b&limit=100', headers })
    ).json();
    expect(byQuery.purchases.map((p: { id: string }) => p.id)).toEqual([other.id]);
  });

  it('needsAttention returns NOT_RECEIVED, stale UNVERIFIED and annotated rows only', async () => {
    const stale = await purchase({ paymentStatus: 'UNVERIFIED', createdAt: new Date(Date.now() - 5 * HOUR) });
    const fresh = await purchase({ paymentStatus: 'UNVERIFIED', createdAt: new Date() });
    const noted = await purchase({ paymentStatus: 'PAID', paymentNote: 'checked with the merchant' });
    const clean = await purchase({ paymentStatus: 'PAID' });

    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const res = (
      await app.inject({ method: 'GET', url: '/admin/shopify/purchases?needsAttention=true&limit=100', headers })
    ).json();
    const ids = res.purchases.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([stale.id, noted.id]));
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(clean.id);
  });

  it('paginates with a cursor', async () => {
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const first = (await app.inject({ method: 'GET', url: '/admin/shopify/purchases?limit=2', headers })).json();
    expect(first.purchases).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (
      await app.inject({ method: 'GET', url: `/admin/shopify/purchases?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`, headers })
    ).json();
    const firstIds = first.purchases.map((p: { id: string }) => p.id);
    expect(second.purchases.every((p: { id: string }) => !firstIds.includes(p.id))).toBe(true);
  });

  it('rejects an unknown payment status', async () => {
    const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
    const res = await app.inject({ method: 'GET', url: '/admin/shopify/purchases?paymentStatus=BOGUS', headers });
    expect(res.statusCode).toBe(400);
  });
});

describe('payment review', () => {
  it('marks a purchase PAID by hand: records the note, reviewer and an audit row, and touches no credits', async () => {
    const row = await purchase();
    const ledgerBefore = await app.db.select().from(schema.shopifyCreditLedger).where(eq(schema.shopifyCreditLedger.storeId, storeA.id));

    const out = await adminReviewPurchasePayment(app, row.id, { status: 'PAID', note: 'seen in the Partner Dashboard' }, actor(), fakeRequest);

    expect(out.paymentStatus).toBe('PAID');
    const fresh = await reload(row);
    expect(fresh).toMatchObject({
      paymentStatus: 'PAID',
      paymentStatusSource: 'MANUAL',
      paymentNote: 'seen in the Partner Dashboard',
      paymentFlaggedBy: adminUserId,
      nextPaymentCheckAt: null,
    });
    expect(fresh.paidAt).not.toBeNull();
    expect(fresh.paymentFlaggedAt).not.toBeNull();
    const audit = await auditRows(row);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: adminUserId, resourceType: 'shopify_credit_purchases' });
    const ledgerAfter = await app.db.select().from(schema.shopifyCreditLedger).where(eq(schema.shopifyCreditLedger.storeId, storeA.id));
    expect(ledgerAfter).toHaveLength(ledgerBefore.length);
  });

  it('marks NOT_RECEIVED with no paid_at, and a note alone keeps the status', async () => {
    const row = await purchase();
    await adminReviewPurchasePayment(app, row.id, { status: 'NOT_RECEIVED', note: 'invoice failed' }, actor(), fakeRequest);
    let fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('NOT_RECEIVED');
    expect(fresh.paidAt).toBeNull();

    await adminReviewPurchasePayment(app, row.id, { note: 'merchant contacted on whatsapp' }, actor(), fakeRequest);
    fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('NOT_RECEIVED');
    expect(fresh.paymentStatusSource).toBe('MANUAL');
    expect(fresh.paymentNote).toBe('merchant contacted on whatsapp');
    expect(await auditRows(row)).toHaveLength(2);
  });

  it('AUTO clears an override and queues an immediate re-check; without an override it is a 409', async () => {
    const row = await purchase();
    await expect(
      adminReviewPurchasePayment(app, row.id, { status: 'AUTO', note: 'nothing to clear' }, actor(), fakeRequest),
    ).rejects.toMatchObject({ statusCode: 409 });

    await adminReviewPurchasePayment(app, row.id, { status: 'PAID', note: 'manual first' }, actor(), fakeRequest);
    await adminReviewPurchasePayment(app, row.id, { status: 'AUTO', note: 'let the system decide' }, actor(), fakeRequest);
    const fresh = await reload(row);
    expect(fresh).toMatchObject({ paymentStatus: 'UNVERIFIED', paymentStatusSource: 'AUTO', paidAt: null });
    expect(fresh.nextPaymentCheckAt).not.toBeNull();
  });

  it('refuses a held (hold-until-paid) purchase with 409 and changes nothing', async () => {
    const row = await purchase({ paymentStatus: 'AWAITING' });
    await expect(
      adminReviewPurchasePayment(app, row.id, { status: 'PAID', note: 'trying to force it' }, actor(), fakeRequest),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
    expect(await auditRows(row)).toHaveLength(0);
  });

  it('returns 404 for an unknown purchase', async () => {
    await expect(
      adminReviewPurchasePayment(app, '00000000-0000-0000-0000-000000000000', { note: 'no such row' }, actor(), fakeRequest),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rolls everything back when the reviewer cannot be recorded (no such admin user)', async () => {
    const row = await purchase();
    await expect(
      adminReviewPurchasePayment(
        app,
        row.id,
        { status: 'PAID', note: 'should not stick' },
        { userId: '00000000-0000-0000-0000-00000000dead', role: 'SUPER_ADMIN' },
        fakeRequest,
      ),
    ).rejects.toThrow();
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('UNVERIFIED');
    expect(fresh.paymentNote).toBeNull();
    expect(await auditRows(row)).toHaveLength(0);
  });

  it('over HTTP: 403 without credits.write, 400 for a too-short note, 200 and the new status otherwise', async () => {
    const row = await purchase();
    const support = await adminAuthHeader(app, 'SUPPORT');
    const forbidden = await app.inject({
      method: 'POST',
      url: `/admin/shopify/purchases/${row.id}/payment-review`,
      headers: support,
      payload: { status: 'PAID', note: 'support cannot do this' },
    });
    expect(forbidden.statusCode).toBe(403);

    const admin = await adminAuthHeader(app, 'SUPER_ADMIN');
    const short = await app.inject({
      method: 'POST',
      url: `/admin/shopify/purchases/${row.id}/payment-review`,
      headers: admin,
      payload: { status: 'PAID', note: 'x' },
    });
    expect(short.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: `/admin/shopify/purchases/${row.id}/payment-review`,
      headers: admin,
      payload: { status: 'NOT_RECEIVED', note: 'invoice failed in billing' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().paymentStatus).toBe('NOT_RECEIVED');
    expect((await reload(row)).paymentStatusSource).toBe('MANUAL');
  });
});

describe('check payment on a granted purchase', () => {
  const saleFor = (row: Row) => async () =>
    new Map([[(row.shopifyChargeId as string).split('/').pop() as string, { paidAt: new Date('2026-10-09T06:39:29Z') }]]);

  it('confirms an UNVERIFIED purchase as PAID without granting or auditing', async () => {
    const row = await purchase();
    const out = await adminCheckPurchasePayment(app, row.id, actor(), fakeRequest, { fetchSales: saleFor(row) });
    expect(out.paymentStatus).toBe('PAID');
    const ledger = await app.db.select().from(schema.shopifyCreditLedger).where(eq(schema.shopifyCreditLedger.externalRef, `shopify_pack:${row.shopifyChargeId}`));
    expect(ledger).toHaveLength(0);
  });

  it('refuses a manually overridden purchase with 409', async () => {
    const row = await purchase({ paymentStatus: 'NOT_RECEIVED', paymentStatusSource: 'MANUAL' });
    await expect(
      adminCheckPurchasePayment(app, row.id, actor(), fakeRequest, { fetchSales: saleFor(row) }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await reload(row)).paymentStatus).toBe('NOT_RECEIVED');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts admin-shopify-purchases`
Expected: FAIL (the new routes module cannot be resolved).

- [ ] **Step 3: Move `adminCheckPurchasePayment` and extend it**

The admin check function currently lives in `shopify-stores.routes.ts`. To keep one module owning purchase admin actions, **move** it into the new file. In `apps/api/src/modules/admin/shopify-stores.routes.ts`: delete the whole `export async function adminCheckPurchasePayment(...)` function and its doc comment, delete the now-unused imports (`FetchOneTimeSales`, `PartnerApiError`, `checkPurchases`, `recordAudit` — keep any still used elsewhere in the file; run typecheck to see), and replace the `check-payment` route registration (the `app.post('/admin/shopify/purchases/:id/check-payment', …)` block with its comment) with nothing — it moves too. In the per-store purchases select (`'/admin/shopify-stores/:id/purchases'`), add three fields after `shopifyChargeId`:

```ts
          paymentStatusSource: schema.shopifyCreditPurchases.paymentStatusSource,
          paymentNote: schema.shopifyCreditPurchases.paymentNote,
          paymentFlaggedAt: schema.shopifyCreditPurchases.paymentFlaggedAt,
```

- [ ] **Step 4: Create the new routes module**

Create `apps/api/src/modules/admin/shopify-purchases.routes.ts`:

```ts
import { schema } from '@aivastra/db';
import { and, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { type FetchOneTimeSales, PartnerApiError } from '../shopify/partner-api.js';
import { checkPurchases } from '../shopify/payment-settlement.js';
import { verifyGrantedPurchases, verifyWindowMs } from '../shopify/payment-verification.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

const PAYMENT_STATUSES = ['NOT_REQUIRED', 'UNVERIFIED', 'PAID', 'NOT_RECEIVED', 'AWAITING', 'UNPAID'] as const;
/** Purchases whose credits were granted — the only ones an admin may review. */
const GRANTED_STATUSES = ['NOT_REQUIRED', 'UNVERIFIED', 'PAID', 'NOT_RECEIVED'] as const;

const P = schema.shopifyCreditPurchases;

const ListQuery = z.object({
  paymentStatus: z.string().optional(),
  storeId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  needsAttention: z.enum(['true', 'false']).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ReviewBody = z.object({
  status: z.enum(['PAID', 'NOT_RECEIVED', 'AUTO']).optional(),
  note: z.string().trim().min(3).max(500),
});
export type ReviewBodyInput = z.infer<typeof ReviewBody>;

/**
 * Core of POST /admin/shopify/purchases/:id/check-payment, exported so tests can
 * drive it with an injected Partner API fetch. Held rows (AWAITING/UNPAID) settle
 * and may grant; granted rows (UNVERIFIED/NOT_RECEIVED) are only verified — no
 * grant, no audit, because nothing about the credits changes. A row an admin
 * overrode is refused: the override would just be undone otherwise.
 */
export async function adminCheckPurchasePayment(
  app: FastifyInstance,
  purchaseId: string,
  actor: { userId: string; role: string },
  request: FastifyRequest,
  deps: { fetchSales?: FetchOneTimeSales } = {},
): Promise<{ paymentStatus: string }> {
  const load = async () => {
    const [r] = await app.db.select().from(P).where(eq(P.id, purchaseId)).limit(1);
    return r;
  };
  const row = await load();
  if (!row) throw new AppError('NOT_FOUND', 404, 'purchase not found');

  const verifying = row.paymentStatus === 'UNVERIFIED' || row.paymentStatus === 'NOT_RECEIVED';
  if (verifying && row.paymentStatusSource === 'MANUAL') {
    throw new AppError('CONFLICT', 409, 'status was set by an admin — clear the override first');
  }
  if (!verifying && row.paymentStatus !== 'AWAITING' && row.paymentStatus !== 'UNPAID') {
    return { paymentStatus: row.paymentStatus };
  }

  // Same scoping as the merchant confirm path: one store's sales, not the org's.
  const [store] = await app.db
    .select({ shopDomain: schema.shopifyStores.shopDomain })
    .from(schema.shopifyStores)
    .where(eq(schema.shopifyStores.id, row.storeId))
    .limit(1);

  // Both checkers log and swallow per-row failures so one bad row can't abandon a
  // batch. For a single admin action that would turn a failed settlement (which
  // correctly rolled back) into a silent 200, so remember the first failure and
  // re-raise it.
  let rowError: unknown;
  const onRowError = (_r: unknown, err: unknown) => {
    rowError ??= err;
  };
  try {
    if (verifying) {
      await verifyGrantedPurchases(app, [row], {
        shop: store?.shopDomain,
        fetchSales: deps.fetchSales,
        onRowError,
      });
    } else {
      await checkPurchases(app, [row], {
        shop: store?.shopDomain,
        fetchSales: deps.fetchSales,
        onRowError,
        onSettled: async (tx, settled) => {
          await recordAudit(tx, {
            actor,
            action: 'shopify_purchase.settle',
            resourceType: 'shopify_credit_purchases',
            resourceId: settled.id,
            after: { credits: settled.credits, chargeId: settled.shopifyChargeId },
            request,
          });
        },
      });
    }
  } catch (err) {
    if (err instanceof PartnerApiError) {
      throw new AppError('SHOPIFY', 502, `Partner API unavailable: ${err.reason}`);
    }
    throw err;
  }
  if (rowError) throw rowError;

  // Report the database, not the checker's outcome: a concurrent settle can win.
  const fresh = await load();
  return { paymentStatus: fresh?.paymentStatus ?? row.paymentStatus };
}

/**
 * An admin's decision about whether a purchase was paid. Sets the status by hand
 * (source MANUAL, which the automatic loop then leaves alone), records a note and
 * who/when, and audits it in the same transaction. NEVER touches the ledger or any
 * balance: this feature records decisions, it does not move credits. Held rows are
 * refused because they have their own settle flow and their credits are not granted.
 */
export async function adminReviewPurchasePayment(
  app: FastifyInstance,
  purchaseId: string,
  body: ReviewBodyInput,
  actor: { userId: string; role: string },
  request: FastifyRequest,
) {
  return app.db.transaction(async (tx) => {
    const [row] = await tx.select().from(P).where(eq(P.id, purchaseId)).limit(1);
    if (!row) throw new AppError('NOT_FOUND', 404, 'purchase not found');
    if (!(GRANTED_STATUSES as readonly string[]).includes(row.paymentStatus)) {
      throw new AppError('CONFLICT', 409, 'held purchase — use Check payment, not a manual review');
    }

    const now = new Date();
    const set: Partial<typeof P.$inferInsert> = {
      paymentNote: body.note,
      paymentFlaggedBy: actor.userId,
      paymentFlaggedAt: now,
      updatedAt: now,
    };
    if (body.status === 'PAID' || body.status === 'NOT_RECEIVED') {
      Object.assign(set, {
        paymentStatus: body.status,
        paymentStatusSource: 'MANUAL',
        nextPaymentCheckAt: null,
        paidAt: body.status === 'PAID' ? (row.paidAt ?? now) : null,
      });
    } else if (body.status === 'AUTO') {
      if (row.paymentStatusSource !== 'MANUAL') {
        throw new AppError('CONFLICT', 409, 'there is no manual override to clear');
      }
      Object.assign(set, {
        paymentStatus: 'UNVERIFIED',
        paymentStatusSource: 'AUTO',
        nextPaymentCheckAt: now,
        paidAt: null,
      });
    }

    // Conditional on still being a granted row: a concurrent change to a held
    // state must not be overwritten by a stale read.
    const updated = await tx
      .update(P)
      .set(set)
      .where(and(eq(P.id, row.id), inArray(P.paymentStatus, [...GRANTED_STATUSES])))
      .returning({
        paymentStatus: P.paymentStatus,
        paymentStatusSource: P.paymentStatusSource,
        paymentNote: P.paymentNote,
        paymentFlaggedAt: P.paymentFlaggedAt,
      });
    if (updated.length === 0) throw new AppError('CONFLICT', 409, 'purchase changed — reload and retry');

    await recordAudit(tx, {
      actor,
      action: 'shopify_purchase.payment_review',
      resourceType: 'shopify_credit_purchases',
      resourceId: row.id,
      before: {
        paymentStatus: row.paymentStatus,
        paymentStatusSource: row.paymentStatusSource,
        paymentNote: row.paymentNote,
      },
      after: {
        paymentStatus: updated[0].paymentStatus,
        paymentStatusSource: updated[0].paymentStatusSource,
        paymentNote: updated[0].paymentNote,
      },
      request,
    });
    return updated[0];
  });
}

export async function adminShopifyPurchasesRoutes(app: FastifyInstance) {
  const RO = requirePermission('shopify_stores.read');
  // credits.write, not a shopify_stores capability: shopify_stores only has
  // read/delete, and these actions are about credit purchases.
  const RW = requirePermission('credits.write');

  app.get('/admin/shopify/purchases', { preHandler: RO, schema: { querystring: ListQuery } }, async (req) => {
    const q = req.query as z.infer<typeof ListQuery>;
    const statuses = q.paymentStatus
      ? q.paymentStatus.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const bad = statuses.find((s) => !(PAYMENT_STATUSES as readonly string[]).includes(s));
    if (bad) throw new AppError('BAD_REQUEST', 400, `unknown paymentStatus "${bad}"`);

    const windowAgo = new Date(Date.now() - verifyWindowMs(app.env));
    const conds = [eq(P.source, 'manual'), eq(P.status, 'ACTIVE')];
    if (statuses.length) conds.push(inArray(P.paymentStatus, statuses));
    if (q.storeId) conds.push(eq(P.storeId, q.storeId));
    if (q.q) conds.push(ilike(schema.shopifyStores.shopDomain, `%${q.q.replace(/[\\%_]/g, '\\$&')}%`));
    if (q.from) conds.push(gte(P.createdAt, new Date(q.from)));
    if (q.to) conds.push(lte(P.createdAt, new Date(q.to)));
    if (q.needsAttention === 'true') {
      const attention = or(
        eq(P.paymentStatus, 'NOT_RECEIVED'),
        and(eq(P.paymentStatus, 'UNVERIFIED'), lt(P.createdAt, windowAgo)),
        isNotNull(P.paymentNote),
      );
      if (attention) conds.push(attention);
    }
    if (q.cursor) conds.push(lt(P.createdAt, new Date(q.cursor)));

    const rows = await app.db
      .select({
        id: P.id,
        storeId: P.storeId,
        shopDomain: schema.shopifyStores.shopDomain,
        packId: P.packId,
        credits: P.credits,
        priceUsdCents: P.priceUsdCents,
        status: P.status,
        paymentStatus: P.paymentStatus,
        paymentStatusSource: P.paymentStatusSource,
        paidAt: P.paidAt,
        paymentNote: P.paymentNote,
        paymentFlaggedAt: P.paymentFlaggedAt,
        flaggedByName: schema.users.displayName,
        flaggedByEmail: schema.users.email,
        createdAt: P.createdAt,
        shopifyChargeId: P.shopifyChargeId,
        // When the credits were actually written to the ledger, if they were.
        creditsGrantedAt: sql<Date | null>`(
          select min(l.created_at) from shopify_credit_ledger l
          where l.external_ref = 'shopify_pack:' || ${P.shopifyChargeId}
        )`,
      })
      .from(P)
      .innerJoin(schema.shopifyStores, eq(schema.shopifyStores.id, P.storeId))
      .leftJoin(schema.users, eq(schema.users.id, P.paymentFlaggedBy))
      .where(and(...conds))
      .orderBy(desc(P.createdAt))
      .limit(q.limit);

    const nextCursor = rows.length === q.limit ? rows[rows.length - 1].createdAt.toISOString() : null;
    return { purchases: rows, nextCursor };
  });

  app.post(
    '/admin/shopify/purchases/:id/payment-review',
    { preHandler: RW, schema: { params: z.object({ id: z.string().uuid() }), body: ReviewBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      return adminReviewPurchasePayment(
        app,
        id,
        req.body as ReviewBodyInput,
        { userId: req.userId, role: req.adminRole as string },
        req,
      );
    },
  );

  app.post(
    '/admin/shopify/purchases/:id/check-payment',
    { preHandler: RW, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      return adminCheckPurchasePayment(
        app,
        id,
        { userId: req.userId, role: req.adminRole as string },
        req,
      );
    },
  );
}
```

- [ ] **Step 5: Register the routes**

In `apps/api/src/server.ts`, next to the `adminShopifyStoresRoutes` import add:

```ts
import { adminShopifyPurchasesRoutes } from './modules/admin/shopify-purchases.routes.js';
```

and after `await app.register(adminShopifyStoresRoutes);` add:

```ts
  await app.register(adminShopifyPurchasesRoutes);
```

- [ ] **Step 6: Fix the existing hold-until-paid admin tests' import**

The old tests import `adminCheckPurchasePayment` from `shopify-stores.routes.js`. In `apps/api/test/integration/shopify-payment-settlement.test.ts` change that one import line to:

```ts
import { adminCheckPurchasePayment } from '../../src/modules/admin/shopify-purchases.routes.js';
```

- [ ] **Step 7: Run the tests**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts admin-shopify-purchases shopify-payment-settlement shopify-payment-verification`
Expected: PASS (all). Then `pnpm --filter @aivastra/api typecheck` (exit 0). If typecheck reports unused imports left in `shopify-stores.routes.ts`, remove them.

If a test depends on `AppError` surfacing a `statusCode` property: `AppError` exposes `statusCode` (see `apps/api/src/lib/errors.ts`), which is what the `toMatchObject({ statusCode: 409 })` assertions use.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/admin/shopify-purchases.routes.ts apps/api/src/modules/admin/shopify-stores.routes.ts apps/api/src/server.ts apps/api/test/integration/admin-shopify-purchases.test.ts apps/api/test/integration/shopify-payment-settlement.test.ts
git commit -m "feat(admin): all-stores purchase list, audited payment review, check-payment for granted rows"
```

---

### Task 7: Admin UI — Pack purchases page

**Files:**
- Modify: `apps/admin-web/src/types.ts`
- Create: `apps/admin-web/src/pages/ShopifyPurchasesPage.tsx`
- Modify: `apps/admin-web/src/App.tsx`, `apps/admin-web/src/components/Sidebar.tsx`
- Modify: `apps/admin-web/src/components/StorePurchasesCard.tsx`

**Interfaces:**
- Consumes: `GET /admin/shopify/purchases`, `POST /admin/shopify/purchases/:id/payment-review`, `POST /admin/shopify/purchases/:id/check-payment` (Task 6); `apiFetch`, `apiErrorMessage` from `../lib/data`; `useAuth().hasPermission` from `../context/AuthContext`; `useUrlState` from `../hooks/use-url-state`; `useCloseOverlay` from `../hooks/use-close-overlay`; `SearchableSelect` from `../components/SearchableSelect`; page prop `toast: (opts: { kind?: 'error'; title: string; body?: string }) => void`.
- Produces: route `/shopify-purchases`; the `PackPurchase` type below.

There is no component-test harness in `apps/admin-web`: verify with the build and the manual walk in Step 7.

- [ ] **Step 1: Types**

In `apps/admin-web/src/types.ts` replace the `StorePurchase` interface with:

```ts
export type PurchasePaymentStatus =
  | 'NOT_REQUIRED'
  | 'UNVERIFIED'
  | 'PAID'
  | 'NOT_RECEIVED'
  | 'AWAITING'
  | 'UNPAID';

export interface StorePurchase {
  id: string;
  packId: string;
  credits: number;
  priceUsdCents: number;
  status: string;
  paymentStatus: PurchasePaymentStatus;
  paymentStatusSource: 'AUTO' | 'MANUAL';
  paymentNote: string | null;
  paymentFlaggedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  shopifyChargeId: string | null;
}

/** One row of GET /admin/shopify/purchases (all stores). */
export interface PackPurchase {
  id: string;
  storeId: string;
  shopDomain: string;
  packId: string;
  credits: number;
  priceUsdCents: number;
  status: string;
  paymentStatus: PurchasePaymentStatus;
  paymentStatusSource: 'AUTO' | 'MANUAL';
  paidAt: string | null;
  paymentNote: string | null;
  paymentFlaggedAt: string | null;
  flaggedByName: string | null;
  flaggedByEmail: string | null;
  createdAt: string;
  shopifyChargeId: string | null;
  creditsGrantedAt: string | null;
}
```

- [ ] **Step 2: The page**

Create `apps/admin-web/src/pages/ShopifyPurchasesPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { useAuth } from '../context/AuthContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { PackPurchase, PurchasePaymentStatus } from '../types';

interface Props {
  toast: (opts: { kind?: 'error'; title: string; body?: string }) => void;
}

type Filter = 'attention' | 'all' | PurchasePaymentStatus;
type ReviewAction = 'PAID' | 'NOT_RECEIVED' | 'AUTO' | 'NOTE';

const FILTER_OPTIONS: { id: Filter; label: string }[] = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'all', label: 'All purchases' },
  { id: 'UNVERIFIED', label: 'Unverified (granted, awaiting confirmation)' },
  { id: 'NOT_RECEIVED', label: 'Not received' },
  { id: 'PAID', label: 'Paid' },
  { id: 'NOT_REQUIRED', label: 'Not tracked' },
  { id: 'AWAITING', label: 'Held — awaiting payment' },
  { id: 'UNPAID', label: 'Held — unpaid' },
];

const STATUS_LABEL: Record<PurchasePaymentStatus, string> = {
  NOT_REQUIRED: 'Not tracked',
  UNVERIFIED: 'Unverified',
  PAID: 'Paid',
  NOT_RECEIVED: 'Not received',
  AWAITING: 'Held — awaiting',
  UNPAID: 'Held — unpaid',
};

function statusBadgeClass(s: PurchasePaymentStatus): string {
  if (s === 'PAID') return 'badge success';
  if (s === 'NOT_RECEIVED' || s === 'UNPAID') return 'badge danger';
  if (s === 'UNVERIFIED' || s === 'AWAITING') return 'badge warn';
  return 'badge';
}

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Every Shopify credit-pack purchase across all stores, with Shopify's charge
 * state and our payment-confirmation state side by side. Credits are granted at
 * approval; this is where an admin sees which approvals Shopify never collected
 * and records a decision (status override + note). Nothing here moves credits.
 */
export default function ShopifyPurchasesPage({ toast }: Props) {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('credits.write');

  const [purchaseParam, setPurchaseParam] = useUrlState('purchase');
  const closePurchase = useCloseOverlay(['purchase']);
  const [reviewParam, setReviewParam] = useUrlState('review');
  const closeReview = useCloseOverlay(['review']);

  // Filters are how the list is sliced, not navigation, so they stay local state.
  const [filter, setFilter] = useState<Filter>('attention');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [rows, setRows] = useState<PackPurchase[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const [action, setAction] = useState<ReviewAction>('PAID');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (filter === 'attention') params.set('needsAttention', 'true');
        else if (filter !== 'all') params.set('paymentStatus', filter);
        if (query) params.set('q', query);
        if (from) params.set('from', `${from}T00:00:00.000Z`);
        if (to) params.set('to', `${to}T23:59:59.999Z`);
        if (cursor) params.set('cursor', cursor);
        const data = await apiFetch<{ purchases: PackPurchase[]; nextCursor: string | null }>(
          `/admin/shopify/purchases?${params}`,
        );
        setRows((prev) => (cursor ? [...prev, ...data.purchases] : data.purchases));
        setNextCursor(data.nextCursor);
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Failed to load purchases',
          body: apiErrorMessage(err, 'Please try again.'),
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter, query, from, to, toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => rows.find((r) => r.id === purchaseParam) ?? null, [rows, purchaseParam]);
  const reviewing = useMemo(() => rows.find((r) => r.id === reviewParam) ?? null, [rows, reviewParam]);

  async function checkPayment(id: string) {
    setCheckingId(id);
    try {
      const res = await apiFetch<{ paymentStatus: string }>(
        `/admin/shopify/purchases/${id}/check-payment`,
        { method: 'POST' },
      );
      toast({ title: `Payment status: ${res.paymentStatus}` });
      await load();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Payment check failed',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setCheckingId(null);
    }
  }

  function openReview(row: PackPurchase) {
    setAction(row.paymentStatusSource === 'MANUAL' ? 'AUTO' : 'PAID');
    setNote('');
    setReviewParam(row.id);
  }

  async function submitReview() {
    if (!reviewing) return;
    setSaving(true);
    try {
      await apiFetch(`/admin/shopify/purchases/${reviewing.id}/payment-review`, {
        method: 'POST',
        body: JSON.stringify({
          status: action === 'NOTE' ? undefined : action,
          note: note.trim(),
        }),
      });
      toast({ title: 'Review saved' });
      closeReview();
      await load();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to save review',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  const noteValid = note.trim().length >= 3 && note.trim().length <= 500;
  const canCheck = (r: PackPurchase) =>
    canWrite &&
    ((r.paymentStatus === 'UNVERIFIED' || r.paymentStatus === 'NOT_RECEIVED'
      ? r.paymentStatusSource === 'AUTO'
      : false) ||
      r.paymentStatus === 'AWAITING' ||
      r.paymentStatus === 'UNPAID');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0 }}>Pack purchases</h1>
          <div className="sub" style={{ marginTop: 4 }}>
            Credits are granted when a merchant approves a charge. This page shows whether Shopify
            actually collected the money.
          </div>
        </div>
      </div>

      <div className="card">
        <div
          className="card-body"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
        >
          <div style={{ minWidth: 260 }}>
            <label className="sub" htmlFor="pp-filter">
              Show
            </label>
            <SearchableSelect
              id="pp-filter"
              ariaLabel="Payment filter"
              options={FILTER_OPTIONS}
              value={filter}
              onChange={(id) => setFilter((id || 'attention') as Filter)}
            />
          </div>
          <div>
            <label className="sub" htmlFor="pp-store">
              Store
            </label>
            <input
              id="pp-store"
              className="input sm"
              placeholder="shop domain contains…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setQuery(search.trim());
              }}
              onBlur={() => setQuery(search.trim())}
            />
          </div>
          <div>
            <label className="sub" htmlFor="pp-from">
              From
            </label>
            <input id="pp-from" type="date" className="input sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="sub" htmlFor="pp-to">
              To
            </label>
            <input id="pp-to" type="date" className="input sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
          ) : rows.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              {filter === 'attention' ? 'Nothing needs attention.' : 'No purchases match.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Store</th>
                    <th>Pack</th>
                    <th style={{ textAlign: 'right' }}>Credits</th>
                    <th>Payment</th>
                    <th>Note</th>
                    <th>Approved</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setPurchaseParam(r.id)}>
                      <td>{r.shopDomain}</td>
                      <td>
                        {r.packId} · {dollars(r.priceUsdCents)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{r.credits.toLocaleString()}</td>
                      <td>
                        <span className={statusBadgeClass(r.paymentStatus)}>
                          {STATUS_LABEL[r.paymentStatus]}
                        </span>
                        {r.paymentStatusSource === 'MANUAL' && (
                          <span className="badge" style={{ marginLeft: 6 }}>
                            Manual
                          </span>
                        )}
                      </td>
                      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.paymentNote ?? '—'}
                      </td>
                      <td>{when(r.createdAt)}</td>
                      <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                        {canCheck(r) && (
                          <button
                            type="button"
                            className="btn sm ghost"
                            disabled={checkingId === r.id}
                            onClick={() => void checkPayment(r.id)}
                          >
                            {checkingId === r.id ? 'Checking…' : 'Check payment'}
                          </button>
                        )}{' '}
                        {canWrite &&
                          (r.paymentStatus === 'AWAITING' || r.paymentStatus === 'UNPAID' ? null : (
                            <button type="button" className="btn sm" onClick={() => openReview(r)}>
                              Review
                            </button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {nextCursor && (
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 12 }}
              disabled={loadingMore}
              onClick={() => void load(nextCursor)}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={closePurchase}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                {selected.packId} · {selected.shopDomain}
              </h3>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 8, fontSize: 13 }}>
              <div>
                <strong>Charge:</strong> {selected.status} · {selected.shopifyChargeId ?? '—'}
              </div>
              <div>
                <strong>Approved:</strong> {when(selected.createdAt)}
              </div>
              <div>
                <strong>Credits granted:</strong>{' '}
                {selected.creditsGrantedAt
                  ? `${selected.credits.toLocaleString()} at ${when(selected.creditsGrantedAt)}`
                  : 'no ledger entry'}
              </div>
              <div>
                <strong>Payment:</strong> {STATUS_LABEL[selected.paymentStatus]} (
                {selected.paymentStatusSource === 'MANUAL' ? 'set by an admin' : 'automatic'})
              </div>
              <div>
                <strong>Sale recorded by Shopify:</strong> {when(selected.paidAt)}
              </div>
              <div>
                <strong>Note:</strong> {selected.paymentNote ?? '—'}
              </div>
              <div>
                <strong>Last reviewed:</strong>{' '}
                {selected.paymentFlaggedAt
                  ? `${when(selected.paymentFlaggedAt)} by ${selected.flaggedByName ?? selected.flaggedByEmail ?? 'unknown'}`
                  : '—'}
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn ghost" onClick={closePurchase}>
                Close
              </button>
              {canWrite && selected.paymentStatus !== 'AWAITING' && selected.paymentStatus !== 'UNPAID' && (
                <button type="button" className="btn" onClick={() => openReview(selected)}>
                  Review
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {reviewing && (
        <div className="modal-overlay" onClick={closeReview}>
          <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Review payment — {reviewing.shopDomain}</h3>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13 }}>
                This records your decision only. It does not add or remove any credits.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(
                  [
                    ['PAID', 'Mark paid'],
                    ['NOT_RECEIVED', 'Mark not received'],
                    ...(reviewing.paymentStatusSource === 'MANUAL'
                      ? ([['AUTO', 'Clear override']] as [ReviewAction, string][])
                      : []),
                    ['NOTE', 'Note only'],
                  ] as [ReviewAction, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={action === value ? 'btn' : 'btn ghost'}
                    aria-pressed={action === value}
                    onClick={() => setAction(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div>
                <label className="sub" htmlFor="pp-note">
                  Note (required, 3–500 characters)
                </label>
                <textarea
                  id="pp-note"
                  className="input"
                  rows={4}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Invoice shows Failed in the merchant's billing; contacted them"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn ghost" onClick={closeReview} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void submitReview()}
                disabled={saving || !noteValid}
              >
                {saving ? 'Saving…' : 'Save review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Route, title, sidebar**

In `apps/admin-web/src/App.tsx`:
- add `import ShopifyPurchasesPage from './pages/ShopifyPurchasesPage';` next to the `ShopifyStoresPage` import;
- add `'shopify-purchases': 'Pack purchases',` to the titles map directly after `'shopify-stores': 'Shopify Dashboard',`;
- add `<Route path="/shopify-purchases" element={<ShopifyPurchasesPage {...pageProps} />} />` directly after the `/shopify-stores` route.

In `apps/admin-web/src/components/Sidebar.tsx` add, directly after the `shopify-stores` entry:

```tsx
      {
        k: 'shopify-purchases',
        label: 'Pack purchases',
        icon: Icon.Coin,
        perm: 'shopify_stores.read',
      },
```

- [ ] **Step 4: The per-store card**

In `apps/admin-web/src/components/StorePurchasesCard.tsx`:
- in the "Payment" cell, after the `paidAt` text add a manual tag and the note:

```tsx
                    <td>
                      {p.paymentStatus}
                      {p.paidAt ? ` · ${new Date(p.paidAt).toLocaleString()}` : ''}
                      {p.paymentStatusSource === 'MANUAL' ? ' · set by an admin' : ''}
                      {p.paymentNote ? (
                        <div className="sub" style={{ fontSize: 11 }}>
                          {p.paymentNote}
                        </div>
                      ) : null}
                    </td>
```

- change the Check-payment button condition from `(p.paymentStatus === 'AWAITING' || p.paymentStatus === 'UNPAID') && canCheck` to:

```tsx
                      {((p.paymentStatus === 'AWAITING' || p.paymentStatus === 'UNPAID') ||
                        ((p.paymentStatus === 'UNVERIFIED' || p.paymentStatus === 'NOT_RECEIVED') &&
                          p.paymentStatusSource === 'AUTO')) &&
                        canCheck && (
```

(keep the existing `<button …>` and closing parentheses as they are).

- [ ] **Step 5: Lint and build**

Run: `npx biome check --write apps/admin-web/src/pages/ShopifyPurchasesPage.tsx apps/admin-web/src/components/StorePurchasesCard.tsx apps/admin-web/src/components/Sidebar.tsx apps/admin-web/src/App.tsx apps/admin-web/src/types.ts`
Run: `pnpm --filter @aivastra/admin build`
Expected: both exit 0. Fix any type errors (the build is the typecheck here).

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin): Pack purchases page with filters, detail and audited payment review"
```

- [ ] **Step 7: Manual walk (record the result in the report; no automated UI tests exist)**

With the stack running locally and a few seeded rows (the `pnpm seed:shopify-pending-payments` script is NOT part of this branch; insert rows by hand if needed): open `/shopify-purchases`; confirm the default "Needs attention" view, the status filter, the store search, load-more; open a row (the URL gains `?purchase=<id>`), close it with the browser Back button; open Review, confirm Save is disabled until the note is 3+ characters, mark one row not received and confirm the "Manual" tag and note appear and the row stays unchanged after "Check payment" is hidden for it; clear the override; confirm a SUPPORT-role admin (no `credits.write`) sees no Review or Check buttons.

---

### Task 8: Verification, docs and rollout notes

**Files:**
- Modify: `docs/progress.md`

- [ ] **Step 1: Run the full suite**

From the repo root with docker running, report exact results:

```
pnpm typecheck
pnpm lint
pnpm --filter @aivastra/api test
pnpm --filter @aivastra/api test:integration
pnpm --filter @aivastra/shopify-admin test
pnpm --filter @aivastra/shopify-admin build
pnpm --filter @aivastra/admin build
```

Expected: all exit 0. If anything fails, determine whether it is pre-existing by comparing against the branch point (`git diff --stat docs/shopify-grant-then-verify..HEAD`); do not fix unrelated failures here, record them.

- [ ] **Step 2: Mutation check on the two highest-risk guards**

Prove the tests have teeth, then revert each break completely (`git diff apps/api/src` must be empty afterwards):
1. In `grantForPurchase` change `eq(schema.shopifyCreditPurchases.paymentStatus, 'NOT_REQUIRED')` inside the new transaction to `inArray(…paymentStatus, ['NOT_REQUIRED','UNVERIFIED'])` → the "two concurrent callers grant exactly once" and "a replay" tests must FAIL.
2. In `verifyGrantedPurchases` remove `eq(P.paymentStatusSource, 'AUTO')` from `stillAutomatic` → "leaves an admin override alone" must FAIL.

- [ ] **Step 3: Progress entry**

Add at the top of `docs/progress.md` (below the "Moved 2026-08-29" blockquote and above the newest dated entry) a `## 2026-10-09 — Shopify credit packs: grant on approval, verify afterwards (implemented, flag off)` entry in the repo's Done / Validation / Failed-Not-Done / Open format with REAL content: what was built (the transactional UNVERIFIED mark+grant, the verification pass and gauges, the admin Pack purchases page with audited review, `/me` and Shopify-app handling), the validation results from Step 1 with counts, and:

- **Rollout (production):** (1) deploy with `SHOPIFY_VERIFY_PAYMENTS` unset — migration `0220` runs via CI; (2) set `SHOPIFY_VERIFY_PAYMENTS=true`, restart the API; (3) buy Silver ($10) on the real store: credits instantly, row `UNVERIFIED`, `PAID` roughly an hour later (Shopify's visibility delay of ~36–46 min in the one sample, plus the 15-minute poll); (4) in the admin page mark one row not received with a note, confirm the audit row, confirm the loop leaves it alone, clear the override; (5) create the Grafana alerts — `shopify_purchases_not_received > 0` and `shopify_purchases_overdue_verification > 0` for 30 minutes (do NOT alert on the last-success timestamp: it goes stale on a healthy system).
- **Open:** the 180-minute window rests on one sample of Shopify's visibility delay — re-measure on real purchases and tune `SHOPIFY_PAYMENT_VERIFY_WINDOW_MINUTES`; management must decide what happens to a `NOT_RECEIVED` store (contact, block, claw back) and whether merchants are told; no merchant-facing banner; the admin UI has no automated tests.

No placeholder text may remain in the entry: grep it for `<`, `TBD`, `TODO` before committing.

- [ ] **Step 4: Commit**

```bash
git add docs/progress.md
git commit -m "docs(progress): grant-then-verify implementation and rollout"
```
