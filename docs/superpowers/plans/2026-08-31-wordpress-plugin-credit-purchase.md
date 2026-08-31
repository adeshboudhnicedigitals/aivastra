# WordPress Plugin Credit Purchase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a merchant browse plans and buy credits from inside the WooCommerce plugin's `Settings → Aivastra Try-On` screen, without leaving wp-admin — closing the gap with Shopify's embedded `PricingPage`.

**Architecture:** Three new dev-API routes (`GET /v1/dev/plans`, `POST /v1/dev/payments/orders` [full-scope], `POST /v1/dev/payments/verify` [widget-scope]) reuse the existing, currently-unused Razorpay order/verify/grant logic from `apps/api/src/modules/merchant/payments.routes.ts`, extracted into a shared helper. The WordPress plugin persists the full API key (encrypted at rest via a key derived from `wp_salt()`) so it can create an order server-side on "Buy," renders a "Plans & Credits" card, and opens Razorpay's checkout modal in wp-admin; a new admin-ajax handler verifies the completed payment using the already-persisted widget key.

**Tech Stack:** Fastify 5 + Zod (`apps/api`), Drizzle ORM/Postgres, PHP 8.1 (WordPress plugin, PHPUnit 10 + Brain\Monkey for unit tests), Razorpay checkout.js + REST API, Vitest for API integration tests.

**Spec:** `docs/superpowers/specs/2026-08-31-wordpress-plugin-credit-purchase-design.md`

## Global Constraints

- Money-committing actions (order creation) require a **full-scoped** API key (`requireDevScope('full')`); verification and plan listing accept a **widget-scoped** key.
- The merchant's identity for every dev-API call is resolved server-side from the authenticated key (`req.merchantId`) — never from client-supplied input.
- The full API key is now a **persisted** credential in `wp_options`, and MUST be stored encrypted (AES-256-CBC, key derived from `wp_salt('auth')`), never in plaintext.
- Reuse `MERCHANT_PLAN_BILLING` (`packages/types/src/widget.ts`) as the plan catalog — do not introduce a second plan model.
- No schema/migration changes are needed — `merchant_payments` already has every column this feature uses.
- Every new PHP class file starts with `if (!defined('ABSPATH')) { exit; }`, matching every existing file in `wordpress-plugin/`.

---

### Task 1: Extract shared Razorpay helper (backend refactor)

**Files:**
- Create: `apps/api/src/modules/merchant/razorpay.ts`
- Modify: `apps/api/src/modules/merchant/payments.routes.ts`
- Test: `apps/api/test/integration/merchant-payments.test.ts` (existing — must still pass unchanged)

**Interfaces:**
- Produces: `GST_RATE: number`, `createRazorpayOrder(keyId: string, keySecret: string, amountPaise: number, receipt: string): Promise<{ id: string }>`, `grantMerchantCredits(app: FastifyInstance, merchantId: string, razorpayOrderId: string, razorpayPaymentId: string, credits: number, signature?: string): Promise<void>`, `verifyRazorpaySignature(keySecret: string, orderId: string, paymentId: string, signature: string): boolean` — all consumed by Task 2's new dev-API routes.

- [ ] **Step 1: Create the shared Razorpay helper module**

Create `apps/api/src/modules/merchant/razorpay.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { resolveMerchantUserId } from './ledger.js';

export const GST_RATE = 0.18;

export async function createRazorpayOrder(
  keyId: string,
  keySecret: string,
  amountPaise: number,
  receipt: string,
): Promise<{ id: string }> {
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Razorpay order creation failed: ${body}`);
  }
  return res.json() as Promise<{ id: string }>;
}

// Idempotent credit grant to a merchant's (single, unified) credit pool + ledger entry.
export async function grantMerchantCredits(
  app: FastifyInstance,
  merchantId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  credits: number,
  signature?: string,
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: DB type narrowing
  const userId = await resolveMerchantUserId(app.db as any, merchantId);

  await app.db.transaction(async (tx) => {
    await tx
      .update(schema.merchantPayments)
      .set({
        status: 'paid',
        razorpayPaymentId,
        ...(signature ? { razorpaySignature: signature } : {}),
        paidAt: new Date(),
      })
      .where(eq(schema.merchantPayments.razorpayOrderId, razorpayOrderId));

    await tx
      .insert(schema.userCredits)
      .values({ userId, balance: credits })
      .onConflictDoUpdate({
        target: schema.userCredits.userId,
        set: {
          balance: sql`${schema.userCredits.balance} + ${credits}`,
          updatedAt: new Date(),
        },
      });

    await tx.insert(schema.creditLedger).values({
      userId,
      delta: credits,
      reason: 'PAYMENT',
      adminId: null,
    });
  });
}

// Shared by /v1/merchant/payments/verify and /v1/dev/payments/verify — both
// check the same "orderId|paymentId" HMAC construction against a caller-
// supplied signature. The webhook handler in payments.routes.ts is NOT this:
// it HMACs the raw request body with a different secret, so it stays separate.
export function verifyRazorpaySignature(
  keySecret: string,
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  return expectedBuf.length === signatureBuf.length && timingSafeEqual(expectedBuf, signatureBuf);
}
```

- [ ] **Step 2: Point `payments.routes.ts` at the shared helper**

In `apps/api/src/modules/merchant/payments.routes.ts`:

Replace the top of the file (from the `import { createHmac...` line down through the end of the `grantMerchantCredits` function, i.e. everything before `export async function merchantPaymentsRoutes`) with:

```ts
import { schema } from '@aivastra/db';
import { MERCHANT_PLAN_BILLING, MerchantCheckoutBody, MerchantPaymentVerify } from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { GST_RATE, createRazorpayOrder, grantMerchantCredits, verifyRazorpaySignature } from './razorpay.js';
```

(This drops `createHmac`, `timingSafeEqual`, `and`, `sql`, `type MerchantPlanSlug`, `resolveMerchantUserId` from this file's own imports — `and` is still used by the webhook handler further down, so re-check its usage before removing; if the webhook's `and(...)` call is still present, keep `import { and, eq } from 'drizzle-orm';` instead.)

Then in the `/v1/merchant/payments/verify` handler, replace:

```ts
      const expected = createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');
      const expectedBuf = Buffer.from(expected);
      const signatureBuf = Buffer.from(razorpaySignature);
      const signatureValid =
        expectedBuf.length === signatureBuf.length && timingSafeEqual(expectedBuf, signatureBuf);
      if (!signatureValid) {
        throw new AppError('INVALID_SIGNATURE', 400, 'payment signature invalid');
      }
```

with:

```ts
      if (!verifyRazorpaySignature(RAZORPAY_KEY_SECRET, razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
        throw new AppError('INVALID_SIGNATURE', 400, 'payment signature invalid');
      }
```

Leave the webhook sub-plugin (`/v1/merchant/payments/webhook`) untouched — its `createHmac`/`timingSafeEqual` usage is over the raw request body with `RAZORPAY_WEBHOOK_SECRET`, a different construction, so re-add `import { createHmac, timingSafeEqual } from 'node:crypto';` at the top since the webhook handler still needs both.

- [ ] **Step 3: Run the existing merchant-payments test suite to confirm no behavior changed**

Run: `pnpm docker:up` (if not already running), then from `apps/api`: `npx vitest run --config vitest.integration.config.ts merchant-payments`
Expected: PASS — both existing tests (`credits the merchant owner's user_credits balance...`, `is idempotent...`) still pass unchanged.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @aivastra/api typecheck`
Expected: no errors (confirms no leftover unused/missing imports in `payments.routes.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/merchant/razorpay.ts apps/api/src/modules/merchant/payments.routes.ts
git commit -m "refactor(api): extract shared Razorpay order/verify/grant helper"
```

---

### Task 2: Dev-API plans & payments routes + integration tests

**Files:**
- Modify: `packages/types/src/dev.ts`
- Modify: `apps/api/src/modules/dev/routes.ts`
- Test: `apps/api/test/integration/dev-payments.test.ts` (new)

**Interfaces:**
- Consumes: `GST_RATE`, `createRazorpayOrder`, `grantMerchantCredits`, `verifyRazorpaySignature` from Task 1's `apps/api/src/modules/merchant/razorpay.js`; `createTestApiKey`, `createTestMerchant` from `apps/api/test/helpers/merchant.js` (both already exist).
- Produces: `GET /v1/dev/plans`, `POST /v1/dev/payments/orders`, `POST /v1/dev/payments/verify` — consumed by the WordPress plugin starting Task 5.

- [ ] **Step 1: Add the new Zod schemas**

In `packages/types/src/dev.ts`, add the import and schemas below (insert the import alongside the existing `import { z } from 'zod';` line, and the schemas near `DevBalanceResponse`):

```ts
import { MERCHANT_PLAN_BILLING, MERCHANT_PLAN_SLUGS } from './widget.js';
```

```ts
export const DevPlan = z.object({
  slug: z.string(),
  name: z.string(),
  priceInr: z.number().int(),
  credits: z.number().int(),
});

// Deliberately available to a widget-scoped key — plan pricing is public
// display data, no different from a price list on a website.
export const DevPlansResponse = z.object({
  plans: z.array(DevPlan),
});

export const DevPaymentOrderBody = z.object({
  planSlug: z.enum(MERCHANT_PLAN_SLUGS),
});

// keyId is Razorpay's public key id, not a secret — safe to hand to a browser.
export const DevPaymentOrderResponse = z.object({
  orderId: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  keyId: z.string(),
  credits: z.number().int(),
  label: z.string(),
});

export const DevPaymentVerifyBody = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export const DevPaymentVerifyResponse = z.object({
  ok: z.literal(true),
  alreadyCredited: z.boolean(),
  balance: z.number().int(),
});
```

Note: `MERCHANT_PLAN_BILLING` is imported for use in Step 2's route handler (`apps/api/src/modules/dev/routes.ts` imports it directly from `@aivastra/types`, not re-exported from `dev.ts`) — the import added to `dev.ts` above is only for `MERCHANT_PLAN_SLUGS`, used by `DevPaymentOrderBody`'s enum. Adjust the import line to just:

```ts
import { MERCHANT_PLAN_SLUGS } from './widget.js';
```

- [ ] **Step 2: Run typecheck to confirm the new schemas compile**

Run: `pnpm --filter @aivastra/types typecheck`
Expected: PASS.

- [ ] **Step 3: Write the failing integration tests**

Create `apps/api/test/integration/dev-payments.test.ts`:

```ts
import { createHmac } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';
import { createTestApiKey, createTestMerchant } from '../helpers/merchant.js';

describe('GET /v1/dev/plans', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('returns the merchant plan catalog for a widget-scoped key', async () => {
    const merchant = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'widget' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/dev/plans',
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plans: { slug: string; name: string; priceInr: number; credits: number }[];
    };
    expect(body.plans).toHaveLength(4);
    expect(body.plans.map((p) => p.slug)).toEqual(['basic', 'advanced', 'pro', 'ultra']);
  });

  it('rejects a revoked key', async () => {
    const merchant = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, {
      scope: 'widget',
      revoked: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/dev/plans',
      headers: { authorization: `Bearer ${key}` },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/dev/payments/orders', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      RAZORPAY_KEY_ID: 'test-razorpay-key-id',
      RAZORPAY_KEY_SECRET: 'test-razorpay-key-secret',
    });
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a Razorpay order and a merchant_payments row scoped to the caller, using a full-scoped key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'order_test_full_1' }), { status: 200 }),
    );

    const merchant = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'full' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/payments/orders',
      headers: { authorization: `Bearer ${key}` },
      payload: { planSlug: 'basic' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      orderId: string;
      amount: number;
      currency: string;
      keyId: string;
      credits: number;
    };
    expect(body.orderId).toBe('order_test_full_1');
    expect(body.currency).toBe('INR');
    expect(body.credits).toBe(10000);

    const [row] = await app.db
      .select()
      .from(schema.merchantPayments)
      .where(eq(schema.merchantPayments.razorpayOrderId, 'order_test_full_1'));
    expect(row?.merchantId).toBe(merchant.merchantId);
    expect(row?.status).toBe('created');
  });

  it('rejects a widget-scoped key with 403', async () => {
    const merchant = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'widget' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/payments/orders',
      headers: { authorization: `Bearer ${key}` },
      payload: { planSlug: 'basic' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects an unknown plan slug with 400', async () => {
    const merchant = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'full' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/payments/orders',
      headers: { authorization: `Bearer ${key}` },
      payload: { planSlug: 'not-a-real-plan' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/dev/payments/verify', () => {
  let c: Containers;
  let app: TestApp;
  const RAZORPAY_KEY_SECRET = 'test-razorpay-key-secret';

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { RAZORPAY_KEY_SECRET });
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  function signature(orderId: string, paymentId: string) {
    return createHmac('sha256', RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  }

  async function seedPendingPayment(opts: {
    merchantId: string;
    razorpayOrderId: string;
    credits: number;
  }) {
    const [payment] = await app.db
      .insert(schema.merchantPayments)
      .values({
        merchantId: opts.merchantId,
        planId: 'basic',
        razorpayOrderId: opts.razorpayOrderId,
        basePaise: 2500000,
        gstPaise: 450000,
        totalPaise: 2950000,
        credits: opts.credits,
        status: 'created',
      })
      .returning();
    if (!payment) throw new Error('failed to seed merchant payment');
    return payment;
  }

  it('credits the merchant using a widget-scoped key', async () => {
    const merchant = await createTestMerchant(app, { balance: 40 });
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'widget' });
    const orderId = 'order_dev_widget_1';
    await seedPendingPayment({ merchantId: merchant.merchantId, razorpayOrderId: orderId, credits: 300 });

    const paymentId = 'pay_dev_widget_1';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/payments/verify',
      headers: { authorization: `Bearer ${key}` },
      payload: {
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: signature(orderId, paymentId),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; alreadyCredited: boolean; balance: number };
    expect(body.alreadyCredited).toBe(false);
    expect(body.balance).toBe(340);

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, merchant.userId));
    expect(credits?.balance).toBe(340);
  });

  it('rejects a forged signature', async () => {
    const merchant = await createTestMerchant(app);
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'widget' });
    const orderId = 'order_dev_badsig_1';
    await seedPendingPayment({ merchantId: merchant.merchantId, razorpayOrderId: orderId, credits: 300 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/payments/verify',
      headers: { authorization: `Bearer ${key}` },
      payload: {
        razorpayOrderId: orderId,
        razorpayPaymentId: 'pay_dev_badsig_1',
        razorpaySignature: 'not-a-valid-signature-not-a-valid-signature',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects verifying another merchant's order", async () => {
    const owner = await createTestMerchant(app);
    const intruder = await createTestMerchant(app);
    const { key: intruderKey } = await createTestApiKey(app, intruder.merchantId, { scope: 'widget' });
    const orderId = 'order_dev_cross_merchant_1';
    await seedPendingPayment({ merchantId: owner.merchantId, razorpayOrderId: orderId, credits: 300 });

    const paymentId = 'pay_dev_cross_merchant_1';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/payments/verify',
      headers: { authorization: `Bearer ${intruderKey}` },
      payload: {
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: signature(orderId, paymentId),
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('is idempotent — calling verify twice only credits once', async () => {
    const merchant = await createTestMerchant(app, { balance: 0 });
    const { key } = await createTestApiKey(app, merchant.merchantId, { scope: 'widget' });
    const orderId = 'order_dev_idempotent_1';
    await seedPendingPayment({ merchantId: merchant.merchantId, razorpayOrderId: orderId, credits: 150 });

    const paymentId = 'pay_dev_idempotent_1';
    const payload = {
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature(orderId, paymentId),
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/dev/payments/verify',
      headers: { authorization: `Bearer ${key}` },
      payload,
    });
    expect(first.json().alreadyCredited).toBe(false);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/dev/payments/verify',
      headers: { authorization: `Bearer ${key}` },
      payload,
    });
    expect(second.json().alreadyCredited).toBe(true);

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, merchant.userId));
    expect(credits?.balance).toBe(150);
  });
});
```

- [ ] **Step 4: Run the new tests to verify they fail (routes don't exist yet)**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts dev-payments`
Expected: FAIL — 404s from the not-yet-registered routes.

- [ ] **Step 5: Implement the three routes**

In `apps/api/src/modules/dev/routes.ts`, add to the existing import block from `@aivastra/types` (currently `DevBalanceResponse, DevCategoriesResponse, ...`):

```ts
  DevPaymentOrderBody,
  DevPaymentOrderResponse,
  DevPaymentVerifyBody,
  DevPaymentVerifyResponse,
  DevPlansResponse,
  MERCHANT_PLAN_BILLING,
  type MerchantPlanSlug,
```

Add to the top-level import: `import { GST_RATE, createRazorpayOrder, grantMerchantCredits, verifyRazorpaySignature } from '../merchant/razorpay.js';`

Insert these three routes immediately after the existing `/v1/dev/balance` route (before `/v1/dev/tryon`):

```ts
  app.get(
    '/v1/dev/plans',
    {
      // No requireDevScope() — plan pricing is public display data, same
      // reasoning as /v1/dev/balance: the WordPress plugin only ever holds
      // a widget-scoped key day-to-day and needs this to render its
      // "Plans & Credits" card on every settings-page load.
      preHandler: app.requireApiKey,
      config: rateLimitConfig,
      schema: {
        tags: ['dev'],
        summary: 'List purchasable merchant credit plans',
        response: { 200: DevPlansResponse, 401: DevErrorResponse, 429: DevErrorResponse },
      },
    },
    async () => {
      return { plans: Object.values(MERCHANT_PLAN_BILLING) };
    },
  );

  app.post(
    '/v1/dev/payments/orders',
    {
      preHandler: [app.requireApiKey, app.requireDevScope('full')],
      config: rateLimitConfig,
      schema: {
        tags: ['dev'],
        summary: 'Create a Razorpay order for a merchant credit plan',
        body: DevPaymentOrderBody,
        response: {
          200: DevPaymentOrderResponse,
          401: DevErrorResponse,
          403: DevErrorResponse,
          404: DevErrorResponse,
          429: DevErrorResponse,
          503: DevErrorResponse,
        },
      },
    },
    async (req) => {
      const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = app.env;
      if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        throw new AppError('NOT_CONFIGURED', 503, 'payments not configured');
      }

      const merchantId = req.merchantId as string;
      const { planSlug } = req.body as { planSlug: MerchantPlanSlug };
      const plan = MERCHANT_PLAN_BILLING[planSlug];
      if (!plan) throw new AppError('NOT_FOUND', 404, 'plan not found');

      const basePaise = plan.priceInr * 100;
      const gstPaise = Math.round(basePaise * GST_RATE);
      const totalPaise = basePaise + gstPaise;

      const rzpOrder = await createRazorpayOrder(
        RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET,
        totalPaise,
        `aivastra_wp_${merchantId.slice(0, 8)}`,
      );

      await app.db.insert(schema.merchantPayments).values({
        merchantId,
        planId: plan.slug,
        razorpayOrderId: rzpOrder.id,
        basePaise,
        gstPaise,
        totalPaise,
        credits: plan.credits,
        status: 'created',
      });

      return {
        orderId: rzpOrder.id,
        amount: totalPaise,
        currency: 'INR',
        keyId: RAZORPAY_KEY_ID,
        credits: plan.credits,
        label: plan.name,
      };
    },
  );

  app.post(
    '/v1/dev/payments/verify',
    {
      // Widget-scoped keys may call this: verification is a signature check
      // against an order already tied to a specific merchant at creation
      // time (/v1/dev/payments/orders, full-scope only) — a leaked widget
      // key cannot forge a valid Razorpay signature, so this stays safe
      // without a scope restriction.
      preHandler: app.requireApiKey,
      config: rateLimitConfig,
      schema: {
        tags: ['dev'],
        summary: 'Verify a Razorpay payment and grant credits',
        body: DevPaymentVerifyBody,
        response: {
          200: DevPaymentVerifyResponse,
          400: DevErrorResponse,
          401: DevErrorResponse,
          403: DevErrorResponse,
          404: DevErrorResponse,
          429: DevErrorResponse,
          503: DevErrorResponse,
        },
      },
    },
    async (req) => {
      const { RAZORPAY_KEY_SECRET } = app.env;
      if (!RAZORPAY_KEY_SECRET) {
        throw new AppError('NOT_CONFIGURED', 503, 'payments not configured');
      }

      const merchantId = req.merchantId as string;
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
        razorpayOrderId: string;
        razorpayPaymentId: string;
        razorpaySignature: string;
      };

      if (
        !verifyRazorpaySignature(RAZORPAY_KEY_SECRET, razorpayOrderId, razorpayPaymentId, razorpaySignature)
      ) {
        throw new AppError('INVALID_SIGNATURE', 400, 'payment signature invalid');
      }

      const [payment] = await app.db
        .select()
        .from(schema.merchantPayments)
        .where(eq(schema.merchantPayments.razorpayOrderId, razorpayOrderId));

      if (!payment) throw new AppError('NOT_FOUND', 404, 'order not found');
      if (payment.merchantId !== merchantId) throw new AppError('FORBIDDEN', 403, 'forbidden');

      if (payment.status === 'paid') {
        const [bal] = await app.db
          .select({ balance: schema.userCredits.balance })
          .from(schema.merchants)
          .innerJoin(schema.userCredits, eq(schema.userCredits.userId, schema.merchants.userId))
          .where(eq(schema.merchants.id, merchantId));
        return { ok: true as const, alreadyCredited: true, balance: bal?.balance ?? payment.credits };
      }

      await grantMerchantCredits(
        app,
        merchantId,
        razorpayOrderId,
        razorpayPaymentId,
        payment.credits,
        razorpaySignature,
      );

      const [bal] = await app.db
        .select({ balance: schema.userCredits.balance })
        .from(schema.merchants)
        .innerJoin(schema.userCredits, eq(schema.userCredits.userId, schema.merchants.userId))
        .where(eq(schema.merchants.id, merchantId));

      return { ok: true as const, alreadyCredited: false, balance: bal?.balance ?? payment.credits };
    },
  );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts dev-payments`
Expected: PASS — all tests in all three `describe` blocks green.

- [ ] **Step 7: Run the full API test suite and typecheck to confirm no regressions**

Run: `pnpm --filter @aivastra/api typecheck` then `pnpm --filter @aivastra/api test` then (from `apps/api`) `npx vitest run --config vitest.integration.config.ts`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/dev.ts apps/api/src/modules/dev/routes.ts apps/api/test/integration/dev-payments.test.ts
git commit -m "feat(api): add dev-API plans and Razorpay order/verify routes for WordPress"
```

---

### Task 3: `Aivastra_Crypto` encryption helper

**Files:**
- Create: `wordpress-plugin/includes/class-crypto.php`
- Test: `wordpress-plugin/tests/php/CryptoTest.php` (new)
- Modify: `wordpress-plugin/aivastra-tryon.php` (require the new file)

**Interfaces:**
- Produces: `Aivastra_Crypto::encrypt(string $plaintext): string`, `Aivastra_Crypto::decrypt(string $encoded): ?string` — consumed by Task 4's `Aivastra_Connection_Settings`.

- [ ] **Step 1: Write the failing tests**

Create `wordpress-plugin/tests/php/CryptoTest.php`:

```php
<?php
declare(strict_types=1);

use Brain\Monkey;
use Brain\Monkey\Functions;
use PHPUnit\Framework\TestCase;

final class CryptoTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Monkey\setUp();
        Functions\when('wp_salt')->justReturn('a-fixed-test-salt-value-not-a-real-secret');
    }

    protected function tearDown(): void
    {
        Monkey\tearDown();
        parent::tearDown();
    }

    public function test_round_trips_a_value(): void
    {
        $encrypted = Aivastra_Crypto::encrypt('sk_live_full_example_1234567890');
        $this->assertNotSame('sk_live_full_example_1234567890', $encrypted);
        $this->assertSame('sk_live_full_example_1234567890', Aivastra_Crypto::decrypt($encrypted));
    }

    public function test_two_encryptions_of_the_same_value_differ(): void
    {
        $first = Aivastra_Crypto::encrypt('sk_live_full_example_1234567890');
        $second = Aivastra_Crypto::encrypt('sk_live_full_example_1234567890');
        $this->assertNotSame($first, $second, 'IVs must be random per call');
    }

    public function test_decrypt_returns_null_for_malformed_input(): void
    {
        $this->assertNull(Aivastra_Crypto::decrypt('not-a-valid-encoded-value'));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `wordpress-plugin/`): `vendor/bin/phpunit tests/php/CryptoTest.php`
Expected: FAIL — `Class "Aivastra_Crypto" not found`.

- [ ] **Step 3: Implement `Aivastra_Crypto`**

Create `wordpress-plugin/includes/class-crypto.php`:

```php
<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Encrypts secrets the plugin must persist (the full API key — see
 * class-connection-settings.php) using a key derived from this WordPress
 * install's own AUTH_KEY salt (wp-config.php, not the database), so a raw
 * database dump does not trivially expose the plaintext. This is the
 * standard pattern WordPress plugins use to persist secrets without an
 * external KMS (comparable to how payment gateway plugins store secret
 * keys in wp_options). See
 * docs/superpowers/specs/2026-08-31-wordpress-plugin-credit-purchase-design.md.
 */
class Aivastra_Crypto
{
    private const CIPHER = 'aes-256-cbc';

    private static function derive_key(): string
    {
        // wp_salt('auth') is defined in wp-config.php, never stored in the
        // database — hashed to a fixed-length key because openssl_encrypt
        // requires exactly 32 bytes for AES-256.
        return hash('sha256', wp_salt('auth'), true);
    }

    public static function encrypt(string $plaintext): string
    {
        $key = self::derive_key();
        $ivLength = openssl_cipher_iv_length(self::CIPHER);
        $iv = openssl_random_pseudo_bytes($ivLength);
        $ciphertext = openssl_encrypt($plaintext, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv);
        if ($ciphertext === false) {
            throw new RuntimeException('Failed to encrypt value.');
        }
        // iv:ciphertext, both base64 — a single string wp_options can store as-is.
        return base64_encode($iv) . ':' . base64_encode($ciphertext);
    }

    public static function decrypt(string $encoded): ?string
    {
        $parts = explode(':', $encoded, 2);
        if (count($parts) !== 2) {
            return null;
        }
        [$ivB64, $ciphertextB64] = $parts;
        $iv = base64_decode($ivB64, true);
        $ciphertext = base64_decode($ciphertextB64, true);
        if ($iv === false || $ciphertext === false) {
            return null;
        }
        $key = self::derive_key();
        $plaintext = openssl_decrypt($ciphertext, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv);
        return $plaintext === false ? null : $plaintext;
    }
}
```

- [ ] **Step 4: Wire it into the plugin bootstrap**

In `wordpress-plugin/aivastra-tryon.php`, add this line before `require_once AIVASTRA_TRYON_DIR . 'includes/class-connection-settings.php';` (Task 4 makes `Aivastra_Connection_Settings` depend on it, so it must load first):

```php
require_once AIVASTRA_TRYON_DIR . 'includes/class-crypto.php';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `wordpress-plugin/`): `vendor/bin/phpunit tests/php/CryptoTest.php`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Run the full PHP suite to confirm no regressions**

Run (from `wordpress-plugin/`): `vendor/bin/phpunit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add wordpress-plugin/includes/class-crypto.php wordpress-plugin/tests/php/CryptoTest.php wordpress-plugin/aivastra-tryon.php
git commit -m "feat(wordpress-plugin): add Aivastra_Crypto for encrypting persisted secrets"
```

---

### Task 4: Persist the encrypted full key through connect

**Files:**
- Modify: `wordpress-plugin/includes/class-connection-settings.php`
- Modify: `wordpress-plugin/includes/class-connection-service.php`
- Modify: `wordpress-plugin/admin/class-settings-page.php` (copy fix only)
- Test: `wordpress-plugin/tests/php/ConnectionSettingsTest.php`
- Test: `wordpress-plugin/tests/php/ConnectionServiceTest.php`

**Interfaces:**
- Consumes: `Aivastra_Crypto::encrypt`/`::decrypt` from Task 3.
- Produces: `Aivastra_Connection_Settings::get_full_key(): ?string`, and `set_widget_key_and_snapshot(string $widgetKey, string $fullKey, string $companyName, int $credits, string $creditsAsOf): void` (signature changed — adds `$fullKey` as the 2nd parameter) — consumed by Task 5's `create_order()`.

- [ ] **Step 1: Update the failing/changed tests first**

In `wordpress-plugin/tests/php/ConnectionSettingsTest.php`:

Delete this test entirely (it encodes the invariant this task deliberately reverses):

```php
    public function test_never_exposes_a_setter_for_the_full_key(): void
    {
        $methods = get_class_methods(Aivastra_Connection_Settings::class);
        foreach ($methods as $method) {
            $this->assertStringNotContainsStringIgnoringCase('full_key', $method);
        }
    }
```

Replace `test_set_widget_key_and_snapshot_persists_both_in_one_write` with:

```php
    public function test_set_widget_key_and_snapshot_persists_the_encrypted_full_key_too(): void
    {
        Functions\when('wp_salt')->justReturn('a-fixed-test-salt-value-not-a-real-secret');

        Functions\expect('update_option')
            ->once()
            ->with(
                'aivastra_tryon_settings',
                Mockery::on(function ($saved) {
                    return $saved['widget_key'] === 'sk_live_new'
                        && $saved['company_name'] === 'Acme Co'
                        && $saved['credits'] === 500
                        && $saved['credits_as_of'] === '2026-08-26 00:00:00'
                        && Aivastra_Crypto::decrypt($saved['full_key']) === 'sk_live_full_original';
                })
            )
            ->andReturn(true);

        $settings = new Aivastra_Connection_Settings();
        $settings->set_widget_key_and_snapshot(
            'sk_live_new',
            'sk_live_full_original',
            'Acme Co',
            500,
            '2026-08-26 00:00:00'
        );

        $this->addToAssertionCount(1);
    }
```

Add two new tests, anywhere in the class:

```php
    public function test_get_full_key_decrypts_the_stored_value(): void
    {
        Functions\when('wp_salt')->justReturn('a-fixed-test-salt-value-not-a-real-secret');
        $encrypted = Aivastra_Crypto::encrypt('sk_live_full_original');

        Functions\expect('get_option')
            ->once()
            ->with('aivastra_tryon_settings', [])
            ->andReturn(['full_key' => $encrypted]);

        $settings = new Aivastra_Connection_Settings();
        $this->assertSame('sk_live_full_original', $settings->get_full_key());
    }

    public function test_get_full_key_returns_null_when_unset(): void
    {
        Functions\expect('get_option')->once()->andReturn([]);
        $settings = new Aivastra_Connection_Settings();
        $this->assertNull($settings->get_full_key());
    }
```

In `wordpress-plugin/tests/php/ConnectionServiceTest.php`, replace `test_successful_connect_stores_widget_key_and_snapshot_not_the_full_key` with:

```php
    public function test_successful_connect_stores_widget_key_full_key_and_snapshot(): void
    {
        Functions\expect('wp_remote_get')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/me',
                Mockery::on(fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_full')
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode(['companyName' => 'Acme Co', 'credits' => 500]));
        Functions\expect('current_time')->once()->with('mysql')->andReturn('2026-08-26 00:00:00');

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('set_widget_key_and_snapshot')
            ->once()
            ->with('sk_live_widget', 'sk_live_full', 'Acme Co', 500, '2026-08-26 00:00:00');

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->connect('sk_live_full', 'sk_live_widget');

        $this->assertTrue($result['ok']);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `wordpress-plugin/`): `vendor/bin/phpunit tests/php/ConnectionSettingsTest.php tests/php/ConnectionServiceTest.php`
Expected: FAIL — `set_widget_key_and_snapshot` doesn't accept a 2nd `$fullKey` parameter yet, `get_full_key` doesn't exist yet.

- [ ] **Step 3: Update `Aivastra_Connection_Settings`**

In `wordpress-plugin/includes/class-connection-settings.php`, replace the class docblock (currently: `"The ONLY class that touches the plugin's wp_options row. Deliberately has no method that stores a full-scoped API key..."`) with:

```php
/**
 * The ONLY class that touches the plugin's wp_options row. Persists the
 * full-scoped API key (encrypted via Aivastra_Crypto) so the "Plans &
 * Credits" purchase flow can create a Razorpay order without asking the
 * merchant to re-paste it every time — see
 * docs/superpowers/specs/2026-08-31-wordpress-plugin-credit-purchase-design.md.
 */
```

Replace `set_widget_key_and_snapshot()`:

```php
    /**
     * The only write path for a successful connection — sets the widget key,
     * the encrypted full key, and the display snapshot together, in one
     * wp_options write.
     */
    public function set_widget_key_and_snapshot(
        string $widgetKey,
        string $fullKey,
        string $companyName,
        int $credits,
        string $creditsAsOf
    ): void {
        update_option(self::OPTION_KEY, [
            'widget_key' => $widgetKey,
            'full_key' => Aivastra_Crypto::encrypt($fullKey),
            'company_name' => $companyName,
            'credits' => $credits,
            'credits_as_of' => $creditsAsOf,
        ]);
    }
```

Add a new method, near `get_widget_key()`:

```php
    /**
     * Decrypts and returns the stored full key, or null if never connected.
     * Used only by Aivastra_Connection_Service::create_order() — every other
     * call in the plugin uses the widget key.
     */
    public function get_full_key(): ?string
    {
        $encrypted = $this->all()['full_key'] ?? null;
        return is_string($encrypted) ? Aivastra_Crypto::decrypt($encrypted) : null;
    }
```

`clear()` already wipes the entire option row via `delete_option()`, so it needs no change — the full key is removed along with everything else on disconnect.

- [ ] **Step 4: Update `Aivastra_Connection_Service::connect()`**

In `wordpress-plugin/includes/class-connection-service.php`, update the class docblock (currently claims the full key "lives only in this method's local scope" and is discarded) to:

```php
/**
 * Verifies a full-scoped API key via GET /v1/dev/me, then persists it
 * (encrypted, via Aivastra_Connection_Settings) alongside the widget key and
 * a display snapshot — the full key is needed later to create Razorpay
 * orders from the "Plans & Credits" card. See
 * docs/superpowers/specs/2026-08-31-wordpress-plugin-credit-purchase-design.md.
 */
```

Replace the `connect()` method's final line:

```php
        $this->settings->set_widget_key_and_snapshot($widgetKey, $companyName, $credits, current_time('mysql'));
```

with:

```php
        $this->settings->set_widget_key_and_snapshot($widgetKey, $fullKey, $companyName, $credits, current_time('mysql'));
```

- [ ] **Step 5: Fix the now-inaccurate settings-page copy**

In `wordpress-plugin/admin/class-settings-page.php`, in `render_connect_form()`, replace:

```php
              <p class="aivastra-step-hint">From your aivastra account → API Keys. Verified once against your account, then discarded — never stored.</p>
```

with:

```php
              <p class="aivastra-step-hint">From your aivastra account → API Keys. Verified against your account and stored securely (encrypted) so you can buy credits below without re-entering it.</p>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `wordpress-plugin/`): `vendor/bin/phpunit tests/php/ConnectionSettingsTest.php tests/php/ConnectionServiceTest.php`
Expected: PASS.

- [ ] **Step 7: Run the full PHP suite to confirm no regressions**

Run (from `wordpress-plugin/`): `vendor/bin/phpunit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add wordpress-plugin/includes/class-connection-settings.php wordpress-plugin/includes/class-connection-service.php wordpress-plugin/admin/class-settings-page.php wordpress-plugin/tests/php/ConnectionSettingsTest.php wordpress-plugin/tests/php/ConnectionServiceTest.php
git commit -m "feat(wordpress-plugin): persist the encrypted full API key on connect"
```

---

### Task 5: `Aivastra_Connection_Service` — list_plans, create_order, verify_payment

**Files:**
- Modify: `wordpress-plugin/includes/class-connection-service.php`
- Test: `wordpress-plugin/tests/php/ConnectionServiceTest.php`

**Interfaces:**
- Consumes: `Aivastra_Connection_Settings::get_widget_key()`, `::get_full_key()`, `::update_credits()` (all existing/Task 4).
- Produces: `list_plans(string $widgetKey): array`, `create_order(string $planSlug): array`, `verify_payment(array $payment): array` — `verify_payment` consumed by Task 6 (checkout ajax handler); `list_plans`/`create_order` consumed by Task 7 (settings page).

- [ ] **Step 1: Write the failing tests**

Append to `wordpress-plugin/tests/php/ConnectionServiceTest.php` (inside the class, before the closing `}`):

```php
    public function test_list_plans_returns_the_plans_using_the_widget_key(): void
    {
        Functions\expect('wp_remote_get')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/plans',
                Mockery::on(fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_widget')
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode([
                'plans' => [['slug' => 'basic', 'name' => 'Basic', 'priceInr' => 25000, 'credits' => 10000]],
            ]));

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->list_plans('sk_live_widget');

        $this->assertTrue($result['ok']);
        $this->assertSame(
            [['slug' => 'basic', 'name' => 'Basic', 'priceInr' => 25000, 'credits' => 10000]],
            $result['plans']
        );
    }

    public function test_list_plans_returns_not_ok_on_network_error(): void
    {
        Functions\expect('wp_remote_get')->once()->andReturn(new WP_Error('http_request_failed'));
        Functions\expect('is_wp_error')->once()->andReturn(true);

        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->list_plans('sk_live_widget');

        $this->assertFalse($result['ok']);
        $this->assertSame([], $result['plans']);
    }

    public function test_create_order_without_a_stored_full_key_does_not_call_the_api(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_full_key')->once()->andReturn(null);

        Functions\expect('wp_remote_post')->never();

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->create_order('basic');

        $this->assertFalse($result['ok']);
        $this->assertSame('not_connected', $result['error']);
    }

    public function test_create_order_posts_the_plan_slug_using_the_stored_full_key(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_full_key')->once()->andReturn('sk_live_full');

        Functions\expect('wp_json_encode')->once()->with(['planSlug' => 'basic'])->andReturn('{"planSlug":"basic"}');
        Functions\expect('wp_remote_post')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/payments/orders',
                Mockery::on(
                    fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_full'
                        && $args['body'] === '{"planSlug":"basic"}'
                )
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode([
                'orderId' => 'order_abc',
                'amount' => 2950000,
                'currency' => 'INR',
                'keyId' => 'rzp_test_key',
                'credits' => 10000,
                'label' => 'Basic',
            ]));

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->create_order('basic');

        $this->assertTrue($result['ok']);
        $this->assertSame('order_abc', $result['orderId']);
        $this->assertSame('rzp_test_key', $result['keyId']);
    }

    public function test_create_order_returns_not_ok_when_the_full_key_is_rejected(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_full_key')->once()->andReturn('sk_live_full');

        Functions\expect('wp_json_encode')->once()->andReturn('{"planSlug":"basic"}');
        Functions\expect('wp_remote_post')->once()->andReturn(['response' => ['code' => 403]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(403);

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->create_order('basic');

        $this->assertFalse($result['ok']);
    }

    public function test_verify_payment_updates_the_stored_balance_on_success(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_widget_key')->once()->andReturn('sk_live_widget');

        $payment = [
            'razorpayOrderId' => 'order_abc',
            'razorpayPaymentId' => 'pay_abc',
            'razorpaySignature' => 'sig_abc',
        ];

        Functions\expect('wp_json_encode')->once()->with($payment)->andReturn(json_encode($payment));
        Functions\expect('wp_remote_post')
            ->once()
            ->with(
                'https://api.aivastra.com/v1/dev/payments/verify',
                Mockery::on(fn ($args) => $args['headers']['Authorization'] === 'Bearer sk_live_widget')
            )
            ->andReturn(['response' => ['code' => 200]]);
        Functions\expect('is_wp_error')->once()->andReturn(false);
        Functions\expect('wp_remote_retrieve_response_code')->once()->andReturn(200);
        Functions\expect('wp_remote_retrieve_body')
            ->once()
            ->andReturn(json_encode(['ok' => true, 'alreadyCredited' => false, 'balance' => 10340]));
        Functions\expect('current_time')->once()->with('mysql')->andReturn('2026-08-31 00:00:00');

        $settings->shouldReceive('update_credits')->once()->with(10340, '2026-08-31 00:00:00');

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->verify_payment($payment);

        $this->assertTrue($result['ok']);
        $this->assertSame(10340, $result['balance']);
    }

    public function test_verify_payment_without_a_stored_widget_key_does_not_call_the_api(): void
    {
        $settings = Mockery::mock(Aivastra_Connection_Settings::class);
        $settings->shouldReceive('get_widget_key')->once()->andReturn(null);

        Functions\expect('wp_remote_post')->never();

        $service = new Aivastra_Connection_Service($settings, 'https://api.aivastra.com');
        $result = $service->verify_payment([
            'razorpayOrderId' => 'order_abc',
            'razorpayPaymentId' => 'pay_abc',
            'razorpaySignature' => 'sig_abc',
        ]);

        $this->assertFalse($result['ok']);
        $this->assertSame('not_connected', $result['error']);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `wordpress-plugin/`): `vendor/bin/phpunit tests/php/ConnectionServiceTest.php`
Expected: FAIL — `list_plans`/`create_order`/`verify_payment` don't exist yet.

- [ ] **Step 3: Implement the three methods**

Append to `wordpress-plugin/includes/class-connection-service.php`, inside the class, before its closing `}`:

```php
    /**
     * Lists the merchant's purchasable credit plans (Basic/Advanced/Pro/
     * Ultra), for the "Plans & Credits" card — GET /v1/dev/plans accepts a
     * widget-scoped key, so no full key is needed here.
     *
     * @return array{ok: bool, plans: array<int, array{slug: string, name: string, priceInr: int, credits: int}>, error?: string}
     */
    public function list_plans(string $widgetKey): array
    {
        $response = wp_remote_get($this->apiBase . '/v1/dev/plans', [
            'headers' => ['Authorization' => 'Bearer ' . $widgetKey],
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'plans' => [], 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'plans' => [], 'error' => 'The widget key was rejected (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $plans = is_array($body) ? ($body['plans'] ?? []) : [];

        return ['ok' => true, 'plans' => is_array($plans) ? $plans : []];
    }

    /**
     * Creates a Razorpay order for the given plan using the stored, encrypted
     * full key — POST /v1/dev/payments/orders requires full scope. The
     * decrypted key lives only in this method's local scope.
     *
     * @return array{ok: bool, orderId?: string, amount?: int, currency?: string, keyId?: string, credits?: int, label?: string, error?: string}
     */
    public function create_order(string $planSlug): array
    {
        $fullKey = $this->settings->get_full_key();
        if ($fullKey === null) {
            return ['ok' => false, 'error' => 'not_connected'];
        }

        $response = wp_remote_post($this->apiBase . '/v1/dev/payments/orders', [
            'headers' => [
                'Authorization' => 'Bearer ' . $fullKey,
                'Content-Type' => 'application/json',
            ],
            'body' => wp_json_encode(['planSlug' => $planSlug]),
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'error' => 'Could not start the purchase (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($body) || !isset($body['orderId'])) {
            return ['ok' => false, 'error' => 'Unexpected response from the aivastra API.'];
        }

        return [
            'ok' => true,
            'orderId' => (string) $body['orderId'],
            'amount' => (int) $body['amount'],
            'currency' => (string) $body['currency'],
            'keyId' => (string) $body['keyId'],
            'credits' => (int) $body['credits'],
            'label' => (string) $body['label'],
        ];
    }

    /**
     * Verifies a completed Razorpay payment using the stored widget key —
     * POST /v1/dev/payments/verify accepts widget scope, since verification
     * is a signature check against an order already tied to this merchant.
     *
     * @param array{razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string} $payment
     * @return array{ok: bool, balance?: int, error?: string}
     */
    public function verify_payment(array $payment): array
    {
        $widgetKey = $this->settings->get_widget_key();
        if ($widgetKey === null) {
            return ['ok' => false, 'error' => 'not_connected'];
        }

        $response = wp_remote_post($this->apiBase . '/v1/dev/payments/verify', [
            'headers' => [
                'Authorization' => 'Bearer ' . $widgetKey,
                'Content-Type' => 'application/json',
            ],
            'body' => wp_json_encode($payment),
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return ['ok' => false, 'error' => 'Could not reach the aivastra API.'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            return ['ok' => false, 'error' => 'Payment could not be verified (HTTP ' . $code . ').'];
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $balance = is_array($body) ? (int) ($body['balance'] ?? 0) : 0;

        $this->settings->update_credits($balance, current_time('mysql'));

        return ['ok' => true, 'balance' => $balance];
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `wordpress-plugin/`): `vendor/bin/phpunit tests/php/ConnectionServiceTest.php`
Expected: PASS.

- [ ] **Step 5: Run the full PHP suite to confirm no regressions**

Run (from `wordpress-plugin/`): `vendor/bin/phpunit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add wordpress-plugin/includes/class-connection-service.php wordpress-plugin/tests/php/ConnectionServiceTest.php
git commit -m "feat(wordpress-plugin): add list_plans/create_order/verify_payment to Connection_Service"
```

---

### Task 6: Checkout ajax verification + Razorpay modal JS

**Files:**
- Modify: `wordpress-plugin/admin/class-settings-page.php` (visibility change only)
- Create: `wordpress-plugin/includes/class-checkout-ajax.php`
- Create: `wordpress-plugin/admin/assets/checkout.js`
- Modify: `wordpress-plugin/aivastra-tryon.php` (require + init the new class)

**Interfaces:**
- Consumes: `Aivastra_Connection_Service::verify_payment()` from Task 5.
- Produces: `Aivastra_Settings_Page::API_BASE` becomes a `public const` (was `private const`) — consumed by this task's `Aivastra_Checkout_Ajax`. `Aivastra_Checkout_Ajax::NONCE_ACTION` (string constant) and the `admin-ajax` action `aivastra_tryon_verify_payment` — both consumed by Task 7's `enqueue_assets()`. `checkout.js` reads a JS global `aivastraCheckout` (`{order, ajaxUrl, nonce}`) that doesn't exist yet — it no-ops safely (via the `typeof aivastraCheckout === 'undefined'` guard) until Task 7 localizes it, so this task is safe to ship on its own even though nothing triggers it yet.

This task has no PHP unit test of its own: `Aivastra_Checkout_Ajax::handle()` is a thin WordPress-ajax adapter over `verify_payment()`, which Task 5 already covers. It is confirmed here only by Step 5's full-suite run showing no regressions; end-to-end behavior (the "Buy" button actually reaching this handler) is verified manually in Task 7, once the settings-page UI that triggers it exists.

- [ ] **Step 1: Widen `API_BASE` visibility**

In `wordpress-plugin/admin/class-settings-page.php`, change:

```php
    private const API_BASE = 'https://app.aivastra.com';
```

to:

```php
    // Public: Aivastra_Checkout_Ajax (includes/class-checkout-ajax.php) needs
    // the same base URL and has no other way to reach it.
    public const API_BASE = 'https://app.aivastra.com';
```

- [ ] **Step 2: Implement the ajax handler**

Create `wordpress-plugin/includes/class-checkout-ajax.php`:

```php
<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Verifies a completed Razorpay payment from the "Plans & Credits" card
 * (admin/class-settings-page.php) without a full page reload. Admin-only —
 * unlike class-cart-ajax.php this has no wp_ajax_nopriv_ variant, since only
 * a logged-in store admin with manage_woocommerce should ever trigger a
 * purchase.
 */
class Aivastra_Checkout_Ajax
{
    private const ACTION = 'aivastra_tryon_verify_payment';
    public const NONCE_ACTION = 'aivastra_tryon_verify_payment';

    public static function init(): void
    {
        add_action('wp_ajax_' . self::ACTION, [self::class, 'handle']);
    }

    public static function handle(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error(['message' => 'You do not have permission to do this.'], 403);
        }
        check_ajax_referer(self::NONCE_ACTION, 'nonce');

        $payment = [
            'razorpayOrderId' => sanitize_text_field((string) ($_POST['razorpay_order_id'] ?? '')),
            'razorpayPaymentId' => sanitize_text_field((string) ($_POST['razorpay_payment_id'] ?? '')),
            'razorpaySignature' => sanitize_text_field((string) ($_POST['razorpay_signature'] ?? '')),
        ];

        if ($payment['razorpayOrderId'] === '' || $payment['razorpayPaymentId'] === '' || $payment['razorpaySignature'] === '') {
            wp_send_json_error(['message' => 'Missing payment details.']);
        }

        $service = new Aivastra_Connection_Service(new Aivastra_Connection_Settings(), Aivastra_Settings_Page::API_BASE);
        $result = $service->verify_payment($payment);

        if (!$result['ok']) {
            wp_send_json_error(['message' => 'Payment received but not yet reflected — click Refresh balance.']);
        }

        wp_send_json_success(['balance' => $result['balance']]);
    }
}
```

- [ ] **Step 3: Implement the Razorpay modal JS**

Create `wordpress-plugin/admin/assets/checkout.js`:

```js
(function () {
  if (typeof aivastraCheckout === 'undefined' || !window.Razorpay) {
    return;
  }

  var order = aivastraCheckout.order;

  var rzp = new window.Razorpay({
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    order_id: order.orderId,
    name: 'Aivastra',
    description: order.label + ' — ' + order.credits.toLocaleString() + ' credits',
    handler: function (response) {
      var body = new URLSearchParams();
      body.set('action', 'aivastra_tryon_verify_payment');
      body.set('nonce', aivastraCheckout.nonce);
      body.set('razorpay_order_id', response.razorpay_order_id);
      body.set('razorpay_payment_id', response.razorpay_payment_id);
      body.set('razorpay_signature', response.razorpay_signature);

      fetch(aivastraCheckout.ajaxUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (json) {
          if (json.success) {
            window.location.reload();
          } else {
            window.alert(
              (json.data && json.data.message) ||
                'Payment received but not yet reflected — click Refresh balance.'
            );
          }
        })
        .catch(function () {
          window.alert('Payment received but not yet reflected — click Refresh balance.');
        });
    },
    modal: {
      ondismiss: function () {
        // No error — matches the web app's silent "dismissed" handling.
      },
    },
  });

  rzp.open();
})();
```

- [ ] **Step 4: Wire the new class into the plugin bootstrap**

In `wordpress-plugin/aivastra-tryon.php`, add the require alongside the others:

```php
require_once AIVASTRA_TRYON_DIR . 'includes/class-checkout-ajax.php';
```

And add the init call inside the existing `plugins_loaded` action:

```php
add_action('plugins_loaded', function (): void {
    Aivastra_Settings_Page::init();
    Aivastra_Widget_Loader::init();
    Aivastra_Cart_Ajax::init();
    Aivastra_Checkout_Ajax::init();
});
```

- [ ] **Step 5: Run the full PHP suite to confirm no regressions**

Run (from `wordpress-plugin/`): `vendor/bin/phpunit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add wordpress-plugin/admin/class-settings-page.php wordpress-plugin/includes/class-checkout-ajax.php wordpress-plugin/admin/assets/checkout.js wordpress-plugin/aivastra-tryon.php
git commit -m "feat(wordpress-plugin): verify Razorpay payments via ajax, add checkout modal JS"
```

---

### Task 7: Settings page — "Plans & Credits" card and Buy handler

**Files:**
- Modify: `wordpress-plugin/admin/class-settings-page.php`
- Modify: `wordpress-plugin/admin/assets/settings-page.css`

**Interfaces:**
- Consumes: `Aivastra_Connection_Service::list_plans()`/`::create_order()` from Task 5; `Aivastra_Checkout_Ajax::NONCE_ACTION` and `admin/assets/checkout.js` from Task 6.
- Produces: sets transient key `aivastra_tryon_checkout_{user_id}` — consumed by this same task's `enqueue_assets()`.

This task has no PHP unit tests of its own: `render()`/`enqueue_assets()` are WordPress-hook-bound presentation code, following the existing convention in this file (`render_category_mapping()`, `render_connect_form()` are likewise untested — the testable logic lives in the service/settings classes covered by Tasks 4–5). Verify this task by loading the plugin against `wordpress-plugin/local-wp` (Step 4).

- [ ] **Step 1: Register the Buy admin-post action**

In `init()`, add alongside the existing `add_action('admin_post_aivastra_tryon_...', ...)` calls:

```php
        add_action('admin_post_aivastra_tryon_buy', [self::class, 'handle_buy']);
```

- [ ] **Step 2: Add the `handle_buy` handler**

Add this method near the other `handle_*` methods:

```php
    /**
     * Creates a Razorpay order for the selected plan using the stored full
     * key, stashes the (non-secret) order details in a short-lived transient,
     * and redirects back to the settings page, which opens the Razorpay
     * modal automatically (see enqueue_assets()) — mirroring the auto-open
     * pattern already used for the aivastra.com "Buy Now" deep link
     * (docs/superpowers/specs/2026-08-18-pricing-plan-deep-link-design.md).
     */
    public static function handle_buy(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html('You do not have permission to do this.'), 403);
        }
        check_admin_referer('aivastra_tryon_buy');

        $planSlug = sanitize_key((string) ($_POST['aivastra_plan_slug'] ?? ''));
        $settings = new Aivastra_Connection_Settings();
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $service->create_order($planSlug);

        if (!$result['ok']) {
            wp_safe_redirect(add_query_arg(
                ['page' => 'aivastra-tryon', 'aivastra_error' => $result['error'] ?? 'unknown'],
                admin_url('options-general.php')
            ));
            exit;
        }

        set_transient('aivastra_tryon_checkout_' . get_current_user_id(), $result, 15 * MINUTE_IN_SECONDS);

        wp_safe_redirect(add_query_arg(
            ['page' => 'aivastra-tryon', 'aivastra_checkout' => '1'],
            admin_url('options-general.php')
        ));
        exit;
    }
```

- [ ] **Step 3: Enqueue Razorpay checkout when a purchase is pending, and render the "Plans & Credits" card**

Replace `enqueue_assets()`:

```php
    public static function enqueue_assets(string $hookSuffix): void
    {
        if ($hookSuffix !== 'settings_page_aivastra-tryon') {
            return;
        }
        wp_enqueue_style(
            'aivastra-tryon-settings',
            AIVASTRA_TRYON_URL . 'admin/assets/settings-page.css',
            [],
            AIVASTRA_TRYON_VERSION
        );

        if (!isset($_GET['aivastra_checkout'])) {
            return;
        }
        $order = get_transient('aivastra_tryon_checkout_' . get_current_user_id());
        if ($order === false) {
            return;
        }
        delete_transient('aivastra_tryon_checkout_' . get_current_user_id());

        wp_enqueue_script('razorpay-checkout', 'https://checkout.razorpay.com/v1/checkout.js', [], null, false);
        wp_enqueue_script(
            'aivastra-tryon-checkout',
            AIVASTRA_TRYON_URL . 'admin/assets/checkout.js',
            ['razorpay-checkout'],
            AIVASTRA_TRYON_VERSION,
            true
        );
        wp_localize_script('aivastra-tryon-checkout', 'aivastraCheckout', [
            'order' => $order,
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce(Aivastra_Checkout_Ajax::NONCE_ACTION),
        ]);
    }
```

Add a `render_plans()` method, mirroring `render_category_mapping()`:

```php
    /**
     * Only shown once connected — plan pricing needs the widget key
     * (GET /v1/dev/plans), and purchasing needs a plan to buy against.
     */
    private static function render_plans(Aivastra_Connection_Settings $settings): void
    {
        $widgetKey = $settings->get_widget_key();
        $service = new Aivastra_Connection_Service($settings, self::API_BASE);
        $result = $widgetKey !== null ? $service->list_plans($widgetKey) : ['ok' => false, 'plans' => []];
        ?>
        <div class="aivastra-card aivastra-plans-card">
          <h2 class="aivastra-card-heading">Plans &amp; credits</h2>
          <?php if (!$result['ok']): ?>
            <p class="aivastra-empty-state">Could not load plans right now — try reloading this page.</p>
          <?php else: ?>
            <div class="aivastra-plans-grid">
              <?php foreach ($result['plans'] as $plan): ?>
                <div class="aivastra-plan-tile">
                  <h3 class="aivastra-plan-name"><?php echo esc_html($plan['name']); ?></h3>
                  <p class="aivastra-plan-credits"><?php echo esc_html(number_format_i18n((int) $plan['credits'])); ?> credits</p>
                  <p class="aivastra-plan-price">&#8377;<?php echo esc_html(number_format_i18n((int) $plan['priceInr'])); ?> + GST</p>
                  <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                    <input type="hidden" name="action" value="aivastra_tryon_buy">
                    <input type="hidden" name="aivastra_plan_slug" value="<?php echo esc_attr($plan['slug']); ?>">
                    <?php wp_nonce_field('aivastra_tryon_buy'); ?>
                    <button type="submit" class="aivastra-btn aivastra-btn-primary aivastra-btn-block">Buy</button>
                  </form>
                </div>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>
        </div>
        <?php
    }
```

In `render()`, add the card alongside the existing `render_category_mapping()` call:

```php
          <?php if ($connected): ?>
            <?php self::render_plans($settings); ?>
            <?php self::render_category_mapping($settings); ?>
          <?php endif; ?>
```

(replacing the existing block that only calls `render_category_mapping($settings)`).

- [ ] **Step 4: Add matching CSS**

Append to `wordpress-plugin/admin/assets/settings-page.css`:

```css
/* Plans & credits card */
.aivastra-plans-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 14px;
}

.aivastra-plan-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  background: var(--aivastra-surface-subtle);
  border: 1px solid var(--aivastra-border);
  border-radius: var(--aivastra-radius-control);
}

.aivastra-plan-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--aivastra-text-main);
  margin: 0;
}

.aivastra-plan-credits {
  font-size: 13px;
  color: var(--aivastra-text-muted);
  margin: 0;
}

.aivastra-plan-price {
  font-size: 12.5px;
  color: var(--aivastra-text-subtle);
  margin: 0 0 8px;
}
```

- [ ] **Step 5: Manual verification against the local WooCommerce stack (Razorpay test mode)**

Using `wordpress-plugin/local-wp` with Razorpay test-mode keys configured on the backend:
- The "Plans & Credits" card renders 4 tiles with correct names/prices once connected.
- Click "Buy" on a plan → confirm the Razorpay modal opens automatically (Task 6's `checkout.js`).
- Complete a test payment → confirm the page reloads and the displayed credit balance increases by the plan's credit amount.
- Dismiss the modal without paying → confirm no error is shown and the settings page is otherwise unaffected.

- [ ] **Step 6: Commit**

```bash
git add wordpress-plugin/admin/class-settings-page.php wordpress-plugin/admin/assets/settings-page.css
git commit -m "feat(wordpress-plugin): add Plans & Credits card and Buy handler to settings page"
```

---

### Task 8: Documentation correction and version bump

**Files:**
- Modify: `docs/wordpress-plugin-design.md`
- Modify: `wordpress-plugin/aivastra-tryon.php`

**Interfaces:** None — documentation and metadata only.

- [ ] **Step 1: Correct the stale "never persist the full key" claim**

In `docs/wordpress-plugin-design.md`, §4.3, replace this paragraph:

```
  **Do not persist the full key.** It's used exactly once, at save time, for a
  `GET /v1/dev/me` connection check (company name, credit balance), then
  discarded — only the resulting snapshot (`companyName`, `creditsAsOf`
  timestamp) and the widget key are stored in `wp_options`. WordPress installs
  vary enormously in hosting security, and a plugin holding a full
  account-level credential at rest indefinitely is a materially larger blast
  radius than the widget key that's already accepted as page-source-exposed —
  the entire reason for the scope split (§4.2) is to keep the powerful
  credential out of the least-trusted environment; discarding it after use
  extends that same reasoning to storage, not just transport. Cost: the
  displayed credit balance goes stale until the merchant re-enters the full
  key via an explicit "Refresh connection" action — an acceptable trade for
  not keeping a standing full-account secret on infrastructure this platform
  doesn't control.
```

with:

```
  **The full key is now persisted, encrypted at rest.** Originally discarded
  after the one-time `GET /v1/dev/me` connection check, it is stored
  (AES-256-CBC, key derived from `wp_salt('auth')`) starting with the
  in-plugin credit-purchase feature — see
  `docs/superpowers/specs/2026-08-31-wordpress-plugin-credit-purchase-design.md`.
  Creating a Razorpay order is a money-committing, account-identifying action
  that needs full-scope authority, and persisting the key lets "Buy" be a
  single click in wp-admin, matching Shopify's embedded purchase flow. This
  is a deliberate reversal of the original discard-after-use decision: a
  compromised WordPress install now exposes a standing full-account
  credential, not just the already-page-source-exposed widget key.
```

- [ ] **Step 2: Bump the plugin version**

In `wordpress-plugin/aivastra-tryon.php`, update both the `Version:` header comment and the `AIVASTRA_TRYON_VERSION` constant from `0.4.5` to `0.5.0` (a minor version bump for a new user-facing feature, following this plugin's existing versioning pattern — see commit `5357b736`'s `0.4.0 -> 0.4.5` bump for the same reasoning: browsers must pick up the new `checkout.js`/CSS past their own asset cache).

- [ ] **Step 3: Commit**

```bash
git add docs/wordpress-plugin-design.md wordpress-plugin/aivastra-tryon.php
git commit -m "docs(wordpress-plugin): correct full-key persistence claim, bump to 0.5.0"
```
