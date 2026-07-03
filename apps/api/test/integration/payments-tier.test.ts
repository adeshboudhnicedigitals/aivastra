import { createHmac } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const RAZORPAY_KEY_SECRET = 'test-razorpay-key-secret';

describe('payments -> tier promotion', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { RAZORPAY_KEY_SECRET });
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  // /v1/auth/register no longer returns a token — it only sends a verification
  // email — and /v1/auth/login requires emailVerified=true. Bypass the email
  // step directly in the DB, then log in for a real accessToken.
  async function registerUser(email: string) {
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user?.id));

    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    return { token: loginRes.json().accessToken as string, userId: user?.id };
  }

  async function seedPlan(slug: string) {
    const [plan] = await app.db
      .insert(schema.creditPlans)
      .values({
        slug,
        name: slug,
        credits: 1000,
        basePaise: 250000,
        queueStream: 'priority',
      })
      .returning();
    return plan;
  }

  async function seedPendingPayment(opts: {
    userId: string;
    planId: string;
    razorpayOrderId: string;
    credits: number;
  }) {
    const [payment] = await app.db
      .insert(schema.payments)
      .values({
        userId: opts.userId,
        planId: opts.planId,
        razorpayOrderId: opts.razorpayOrderId,
        basePaise: 250000,
        gstPaise: 45000,
        totalPaise: 295000,
        credits: opts.credits,
        status: 'created',
      })
      .returning();
    return payment;
  }

  function signature(orderId: string, paymentId: string) {
    return createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
  }

  it('promotes tier, credits the user, and writes a ledger entry on successful verify', async () => {
    const { token, userId } = await registerUser('tier-promo@x.com');
    const plan = await seedPlan('promo-plan');
    const orderId = 'order_promo_1';
    await seedPendingPayment({
      userId,
      planId: plan?.slug,
      razorpayOrderId: orderId,
      credits: 1000,
    });

    const paymentId = 'pay_promo_1';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments/verify',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: signature(orderId, paymentId),
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user?.tier).toBe(plan?.slug);

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(credits?.balance).toBe(1000);

    const ledger = await app.db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, userId));
    expect(ledger.some((l) => l.delta === 1000 && l.reason === 'PAYMENT')).toBe(true);
  });

  it('rejects an invalid signature (400) and does not promote the tier', async () => {
    const { token, userId } = await registerUser('tier-badsig@x.com');
    const plan = await seedPlan('badsig-plan');
    const orderId = 'order_badsig_1';
    await seedPendingPayment({
      userId,
      planId: plan?.slug,
      razorpayOrderId: orderId,
      credits: 500,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments/verify',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        razorpayOrderId: orderId,
        razorpayPaymentId: 'pay_badsig_1',
        razorpaySignature: 'not-a-valid-signature-not-a-valid-signature',
      },
    });

    expect(res.statusCode).toBe(400);
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user?.tier).toBe('free');
  });

  it('is idempotent — calling verify twice only credits once', async () => {
    const { token, userId } = await registerUser('tier-idempotent@x.com');
    const plan = await seedPlan('idempotent-plan');
    const orderId = 'order_idempotent_1';
    await seedPendingPayment({
      userId,
      planId: plan?.slug,
      razorpayOrderId: orderId,
      credits: 750,
    });

    const paymentId = 'pay_idempotent_1';
    const payload = {
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature(orderId, paymentId),
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/payments/verify',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().alreadyCredited).toBeFalsy();

    const second = await app.inject({
      method: 'POST',
      url: '/v1/payments/verify',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().alreadyCredited).toBe(true);

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(credits?.balance).toBe(750);
  });
});
