import { createHmac } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveUnlimitedPlan } from '../../src/modules/credits/unlimited-plan.js';
import { applyUnlimitedPlanRenewalPayment } from '../../src/modules/credits/unlimited-plan-renewal.js';
import { adminAuthHeader } from '../helpers/admin';
import { buildTestApp, type TestApp } from '../helpers/api';
import { createVerifiedUserToken } from '../helpers/auth';
import { type Containers, startContainers } from '../helpers/containers';

const RAZORPAY_KEY_SECRET = 'test-razorpay-key-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('unlimited plan offers (agreed price the user pays) + Android renewal prompt', () => {
  let c: Containers;
  let app: TestApp;
  let admin: Record<string, string>;
  let n = 0;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, { RAZORPAY_KEY_SECRET, RAZORPAY_KEY_ID: 'test-razorpay-key-id' });
    admin = await adminAuthHeader(app);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function newUser() {
    const email = `offer-${Date.now()}-${n++}@x.com`;
    const { token, userId } = await createVerifiedUserToken(app, email);
    return { token, userId, auth: { authorization: `Bearer ${token}` } };
  }

  function mockRazorpayOrderCreate() {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === 'https://api.razorpay.com/v1/orders') {
        return new Response(JSON.stringify({ id: `order_offer_${Date.now()}_${Math.random()}` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch to: ${urlStr}`);
    });
  }

  const offer = (userId: string, body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/admin/users/${userId}/unlimited-plan/offer`,
      headers: admin,
      payload: body,
    });

  async function pay(auth: Record<string, string>) {
    mockRazorpayOrderCreate();
    const order = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/renew/order',
      headers: auth,
    });
    expect(order.statusCode).toBe(200);
    const orderId = order.json().orderId as string;
    const paymentId = `pay_${Math.random()}`;
    const sig = createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return { order: order.json(), orderId, paymentId, sig };
  }

  it('an offer grants nothing, but the pricing data shows the agreed price', async () => {
    const { userId, auth } = await newUser();
    const res = await offer(userId, { pricePaise: 400000, durationDays: 30 });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('offered');

    expect(await getActiveUnlimitedPlan(app.db, userId)).toBeNull();

    const credits = await app.inject({ method: 'GET', url: '/v1/credits', headers: auth });
    expect(credits.json().unlimitedPlan).toMatchObject({
      status: 'offered',
      pricePaise: 400000,
      durationDays: 30,
      startAt: null,
      endAt: null,
    });
  });

  it('paying the offer charges price + GST and starts the plan for durationDays', async () => {
    const { userId, auth } = await newUser();
    await offer(userId, { pricePaise: 400000, durationDays: 45 });

    const { order, orderId, paymentId, sig } = await pay(auth);
    expect(order.amount).toBe(472000); // 400000 + 18% GST

    const verify = await app.inject({
      method: 'POST',
      url: '/v1/unlimited-plan/renew/verify',
      headers: auth,
      payload: { razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: sig },
    });
    expect(verify.statusCode).toBe(200);

    const active = await getActiveUnlimitedPlan(app.db, userId);
    expect(active).not.toBeNull();
    const days = (active!.endAt.getTime() - active!.startAt.getTime()) / DAY_MS;
    expect(Math.round(days)).toBe(45);
    expect(active!.pricePaise).toBe(400000);
  });

  it('re-offering updates the open offer in place instead of stacking rows', async () => {
    const { userId } = await newUser();
    await offer(userId, { pricePaise: 400000, durationDays: 30 });
    await offer(userId, { pricePaise: 350000, durationDays: 60 });
    const rows = await app.db
      .select()
      .from(schema.unlimitedPlans)
      .where(eq(schema.unlimitedPlans.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'offered', pricePaise: 350000, durationDays: 60 });
  });

  it('only Super Admin and Admin may set or cancel an agreed price', async () => {
    const { userId } = await newUser();
    const support = await adminAuthHeader(app, 'SUPPORT');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${userId}/unlimited-plan/offer`,
      headers: support,
      payload: { pricePaise: 400000, durationDays: 30 },
    });
    expect(res.statusCode).toBe(403);

    const asAdmin = await app.inject({
      method: 'POST',
      url: `/admin/users/${userId}/unlimited-plan/offer`,
      headers: await adminAuthHeader(app, 'ADMIN'),
      payload: { pricePaise: 400000, durationDays: 30 },
    });
    expect(asAdmin.statusCode).toBe(200);

    const cancel = await app.inject({
      method: 'POST',
      url: `/admin/users/${userId}/unlimited-plan/offer/cancel`,
      headers: support,
    });
    expect(cancel.statusCode).toBe(403);
  });

  it('refuses an offer while a plan is in force', async () => {
    const { userId } = await newUser();
    const now = Date.now();
    await app.db.insert(schema.unlimitedPlans).values({
      userId,
      startAt: new Date(now - DAY_MS),
      endAt: new Date(now + 10 * DAY_MS),
      pricePaise: 100000,
      grantedBy: userId,
    });
    const res = await offer(userId, { pricePaise: 400000, durationDays: 30 });
    expect(res.statusCode).toBe(409);
  });

  it('a payment for an offer superseded by a direct grant extends that grant instead of failing', async () => {
    const { userId, auth } = await newUser();
    await offer(userId, { pricePaise: 400000, durationDays: 30 });
    const { orderId, paymentId, sig } = await pay(auth);

    const now = Date.now();
    const grant = await app.inject({
      method: 'POST',
      url: `/admin/users/${userId}/unlimited-plan`,
      headers: admin,
      payload: {
        startAt: new Date(now).toISOString(),
        endAt: new Date(now + 7 * DAY_MS).toISOString(),
        pricePaise: 0,
      },
    });
    expect(grant.statusCode).toBe(200);

    const result = await applyUnlimitedPlanRenewalPayment(app, orderId, paymentId, sig);
    expect(result).toEqual({ handled: true, applied: true });

    const actives = await app.db
      .select()
      .from(schema.unlimitedPlans)
      .where(
        and(eq(schema.unlimitedPlans.userId, userId), eq(schema.unlimitedPlans.status, 'active')),
      );
    expect(actives).toHaveLength(1);
  });

  it('cancelling an offer hides it from the pricing data', async () => {
    const { userId, auth } = await newUser();
    await offer(userId, { pricePaise: 400000, durationDays: 30 });
    const cancel = await app.inject({
      method: 'POST',
      url: `/admin/users/${userId}/unlimited-plan/offer/cancel`,
      headers: admin,
    });
    expect(cancel.statusCode).toBe(200);
    const credits = await app.inject({ method: 'GET', url: '/v1/credits', headers: auth });
    expect(credits.json().unlimitedPlan.status).toBe('revoked');
  });

  it('keeps an expired plan visible on the pricing data so it can be renewed', async () => {
    const { userId, auth } = await newUser();
    const now = Date.now();
    await app.db.insert(schema.unlimitedPlans).values({
      userId,
      startAt: new Date(now - 40 * DAY_MS),
      endAt: new Date(now - 10 * DAY_MS),
      status: 'expired',
      pricePaise: 250000,
      grantedBy: userId,
    });
    const credits = await app.inject({ method: 'GET', url: '/v1/credits', headers: auth });
    expect(credits.json().unlimitedPlan).toMatchObject({ status: 'expired', pricePaise: 250000 });
  });

  describe('GET /v1/app/renewal-prompt', () => {
    const setPrompt = (renewalPrompt: Record<string, unknown>) =>
      app.inject({
        method: 'PATCH',
        url: '/admin/config',
        headers: admin,
        payload: { renewalPrompt },
      });
    const base = {
      enabled: true,
      startsAt: null,
      blocking: true,
      title: 'Your free trial has ended',
      message: 'Renew to continue.',
      ctaLabel: 'Click here to renew',
      supportWhatsapp: '+91 7729883692',
      supportEmail: 'support@aivastra.com',
    };

    it('is off by default', async () => {
      const { auth } = await newUser();
      await app.redis.del('config:system');
      const res = await app.inject({ method: 'GET', url: '/v1/app/renewal-prompt', headers: auth });
      expect(res.json()).toEqual({ show: false });
    });

    it('shows to a user without an active plan once enabled, with the configured copy', async () => {
      const { auth } = await newUser();
      expect((await setPrompt(base)).statusCode).toBe(200);
      const res = await app.inject({ method: 'GET', url: '/v1/app/renewal-prompt', headers: auth });
      expect(res.json()).toEqual({
        show: true,
        blocking: true,
        title: base.title,
        message: base.message,
        ctaLabel: base.ctaLabel,
        supportWhatsapp: base.supportWhatsapp,
        supportEmail: base.supportEmail,
      });
    });

    it('stays hidden before startsAt', async () => {
      const { auth } = await newUser();
      await setPrompt({ ...base, startsAt: new Date(Date.now() + DAY_MS).toISOString() });
      const res = await app.inject({ method: 'GET', url: '/v1/app/renewal-prompt', headers: auth });
      expect(res.json()).toEqual({ show: false });
    });

    it('is hidden for a credits user who still has a balance, shown again at zero', async () => {
      const { userId, auth } = await newUser();
      await setPrompt(base);
      await app.db
        .insert(schema.userCredits)
        .values({ userId, balance: 50 })
        .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: 50 } });
      const withCredits = await app.inject({
        method: 'GET',
        url: '/v1/app/renewal-prompt',
        headers: auth,
      });
      expect(withCredits.json()).toEqual({ show: false });

      await app.db
        .update(schema.userCredits)
        .set({ balance: 0 })
        .where(eq(schema.userCredits.userId, userId));
      const empty = await app.inject({
        method: 'GET',
        url: '/v1/app/renewal-prompt',
        headers: auth,
      });
      expect(empty.json().show).toBe(true);
    });

    it('is hidden for a user whose plan is in force', async () => {
      const { userId, auth } = await newUser();
      await setPrompt(base);
      const now = Date.now();
      await app.db.insert(schema.unlimitedPlans).values({
        userId,
        startAt: new Date(now - DAY_MS),
        endAt: new Date(now + 10 * DAY_MS),
        grantedBy: userId,
      });
      const res = await app.inject({ method: 'GET', url: '/v1/app/renewal-prompt', headers: auth });
      expect(res.json()).toEqual({ show: false });
    });
  });
});
