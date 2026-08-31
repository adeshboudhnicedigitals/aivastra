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
    return createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
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
    await seedPendingPayment({
      merchantId: merchant.merchantId,
      razorpayOrderId: orderId,
      credits: 300,
    });

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
    await seedPendingPayment({
      merchantId: merchant.merchantId,
      razorpayOrderId: orderId,
      credits: 300,
    });

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
    const { key: intruderKey } = await createTestApiKey(app, intruder.merchantId, {
      scope: 'widget',
    });
    const orderId = 'order_dev_cross_merchant_1';
    await seedPendingPayment({
      merchantId: owner.merchantId,
      razorpayOrderId: orderId,
      credits: 300,
    });

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
    await seedPendingPayment({
      merchantId: merchant.merchantId,
      razorpayOrderId: orderId,
      credits: 150,
    });

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
