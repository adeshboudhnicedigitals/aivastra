import { createHmac } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyUnlimitedPlanRenewalPayment } from '../../src/modules/credits/unlimited-plan-renewal.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const RAZORPAY_KEY_SECRET = 'test-razorpay-key-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('unlimited plan self-serve renewal', () => {
  let c: Containers;
  let app: TestApp;
  let nextTestClient = 1;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      RAZORPAY_KEY_SECRET,
      RAZORPAY_KEY_ID: 'test-razorpay-key-id',
    });
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function registerUser(email: string) {
    const remoteAddress = `127.0.0.${nextTestClient++}`;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      remoteAddress,
      payload: { displayName: 'Unlimited Renewal User', email, password: 'password123' },
    });
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user.id));
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress,
      payload: { email, password: 'password123' },
    });
    return { token: loginRes.json().accessToken as string, userId: user.id as string };
  }

  async function seedPlan(
    userId: string,
    overrides: Partial<{
      startAt: Date;
      endAt: Date;
      status: string;
      pricePaise: number;
    }> = {},
  ) {
    const now = Date.now();
    const [plan] = await app.db
      .insert(schema.unlimitedPlans)
      .values({
        userId,
        startAt: overrides.startAt ?? new Date(now - 25 * DAY_MS),
        endAt: overrides.endAt ?? new Date(now + 5 * DAY_MS), // 30-day cycle
        status: overrides.status ?? 'active',
        pricePaise: overrides.pricePaise ?? 500000,
        grantedBy: userId,
      })
      .returning();
    return plan;
  }

  function signature(orderId: string, paymentId: string) {
    return createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
  }

  function mockRazorpayOrderCreate() {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === 'https://api.razorpay.com/v1/orders') {
        return new Response(
          JSON.stringify({ id: `order_unl_mock_${Date.now()}_${Math.random()}` }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      throw new Error(`Unexpected fetch to: ${urlStr}`);
    });
  }

  it("creates a Razorpay order for the plan's admin-set price plus 18% GST, like every other pack", async () => {
    mockRazorpayOrderCreate();
    const { token, userId } = await registerUser('renew-order@x.com');
    await seedPlan(userId, { pricePaise: 750000 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/renew/order',
      headers: { authorization: `Bearer ${token}` },
      payload: { gstin: '27AAPFU0939F1ZV' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().amount).toBe(885000); // 750000 + 18% GST (135000)
    expect(res.json().currency).toBe('INR');

    const [charge] = await app.db
      .select()
      .from(schema.unlimitedPlanCharges)
      .where(eq(schema.unlimitedPlanCharges.razorpayOrderId, res.json().orderId));
    expect(charge?.status).toBe('pending');
    expect(charge?.pricePaise).toBe(750000);
    expect(charge?.gstPaise).toBe(135000);
    expect(charge?.totalPaise).toBe(885000);
    expect(charge?.gstin).toBe('27AAPFU0939F1ZV');
    expect(charge?.chargeType).toBe('renewal');
    expect(charge?.chargedBy).toBe(userId);

    vi.restoreAllMocks();
  });

  it('creates an order with no GSTIN when none is provided', async () => {
    mockRazorpayOrderCreate();
    const { token, userId } = await registerUser('renew-order-no-gstin@x.com');
    await seedPlan(userId, { pricePaise: 100000 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/renew/order',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().amount).toBe(118000); // 100000 + 18% GST

    const [charge] = await app.db
      .select()
      .from(schema.unlimitedPlanCharges)
      .where(eq(schema.unlimitedPlanCharges.razorpayOrderId, res.json().orderId));
    expect(charge?.gstin).toBeNull();

    vi.restoreAllMocks();
  });

  it('rejects order creation when the plan has no price set', async () => {
    mockRazorpayOrderCreate();
    const { token, userId } = await registerUser('renew-no-price@x.com');
    await seedPlan(userId, { pricePaise: 0 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/renew/order',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);

    vi.restoreAllMocks();
  });

  it('rejects order creation when the plan was revoked', async () => {
    mockRazorpayOrderCreate();
    const { token, userId } = await registerUser('renew-revoked@x.com');
    await seedPlan(userId, { status: 'revoked' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/renew/order',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);

    vi.restoreAllMocks();
  });

  it('rejects order creation when the user never had an unlimited plan', async () => {
    const { token } = await registerUser('renew-none@x.com');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/renew/order',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('extends the plan by a fresh cycle of the same length and resets the reminder stage on verify', async () => {
    const { token, userId } = await registerUser('renew-verify@x.com');
    const startAt = new Date(Date.now() - 25 * DAY_MS);
    const endAt = new Date(Date.now() + 5 * DAY_MS); // 30-day cycle, 5 days left
    const plan = await seedPlan(userId, { startAt, endAt, pricePaise: 500000 });
    await app.db
      .update(schema.unlimitedPlans)
      .set({ lastReminderStage: 'three_day' })
      .where(eq(schema.unlimitedPlans.id, plan.id));

    const orderId = 'order_renew_verify_1';
    await app.db.insert(schema.unlimitedPlanCharges).values({
      unlimitedPlanId: plan.id,
      userId,
      pricePaise: 500000,
      chargeType: 'renewal',
      chargedBy: userId,
      status: 'pending',
      razorpayOrderId: orderId,
    });

    const paymentId = 'pay_renew_verify_1';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/renew/verify',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: signature(orderId, paymentId),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().unlimitedPlan.status).toBe('active');

    const [updated] = await app.db
      .select()
      .from(schema.unlimitedPlans)
      .where(eq(schema.unlimitedPlans.id, plan.id));
    expect(updated?.status).toBe('active');
    expect(updated?.lastReminderStage).toBe('none');
    // Fresh 30-day cycle starting ~now, not the old 5-days-left window extended.
    const newDurationDays = Math.round(
      (updated!.endAt.getTime() - updated!.startAt.getTime()) / DAY_MS,
    );
    expect(newDurationDays).toBe(30);
    expect(updated!.startAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

    const [charge] = await app.db
      .select()
      .from(schema.unlimitedPlanCharges)
      .where(eq(schema.unlimitedPlanCharges.razorpayOrderId, orderId));
    expect(charge?.status).toBe('paid');
    expect(charge?.razorpayPaymentId).toBe(paymentId);
  });

  it('rejects an invalid signature and does not extend the plan', async () => {
    const { token, userId } = await registerUser('renew-badsig@x.com');
    const plan = await seedPlan(userId);
    const orderId = 'order_renew_badsig_1';
    await app.db.insert(schema.unlimitedPlanCharges).values({
      unlimitedPlanId: plan.id,
      userId,
      pricePaise: 500000,
      chargeType: 'renewal',
      chargedBy: userId,
      status: 'pending',
      razorpayOrderId: orderId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/renew/verify',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        razorpayOrderId: orderId,
        razorpayPaymentId: 'pay_renew_badsig_1',
        razorpaySignature: 'not-a-valid-signature-not-a-valid-signature',
      },
    });
    expect(res.statusCode).toBe(400);

    const [charge] = await app.db
      .select()
      .from(schema.unlimitedPlanCharges)
      .where(eq(schema.unlimitedPlanCharges.razorpayOrderId, orderId));
    expect(charge?.status).toBe('pending');
  });

  it('applyUnlimitedPlanRenewalPayment is idempotent under a race (webhook + /verify both firing)', async () => {
    const { userId } = await registerUser('renew-idempotent@x.com');
    const plan = await seedPlan(userId, {
      startAt: new Date(Date.now() - 10 * DAY_MS),
      endAt: new Date(Date.now() + 10 * DAY_MS), // 20-day cycle
    });
    const orderId = 'order_renew_idempotent_1';
    await app.db.insert(schema.unlimitedPlanCharges).values({
      unlimitedPlanId: plan.id,
      userId,
      pricePaise: 500000,
      chargeType: 'renewal',
      chargedBy: userId,
      status: 'pending',
      razorpayOrderId: orderId,
    });

    const first = await applyUnlimitedPlanRenewalPayment(app, orderId, 'pay_x', 'sig_x');
    expect(first.handled).toBe(true);
    expect(first.applied).toBe(true);

    const [afterFirst] = await app.db
      .select()
      .from(schema.unlimitedPlans)
      .where(eq(schema.unlimitedPlans.id, plan.id));

    const second = await applyUnlimitedPlanRenewalPayment(app, orderId, 'pay_x', 'sig_x');
    expect(second.handled).toBe(true);
    expect(second.applied).toBe(false);

    const [afterSecond] = await app.db
      .select()
      .from(schema.unlimitedPlans)
      .where(eq(schema.unlimitedPlans.id, plan.id));
    // Second call must not extend the plan again.
    expect(afterSecond?.endAt.getTime()).toBe(afterFirst?.endAt.getTime());
  });

  it('returns handled: false for a razorpayOrderId that matches no charge', async () => {
    const result = await applyUnlimitedPlanRenewalPayment(app, 'order_does_not_exist', 'pay_y');
    expect(result.handled).toBe(false);
  });
});
