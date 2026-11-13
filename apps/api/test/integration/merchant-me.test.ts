import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { createTestMerchant } from '../helpers/merchant.js';

describe('GET /v1/merchant/me', () => {
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

  it("returns the merchant's display name, email, credit balance, and lifetime usage", async () => {
    const { userId } = await createTestMerchant(app, { balance: 250 });
    await app.db
      .update(schema.users)
      .set({ displayName: 'Store Owner' })
      .where(eq(schema.users.id, userId));
    // Two debits and a credit — `used` must sum only the debits (150), not net
    // against the grant, and must ignore the positive entry entirely.
    await app.db.insert(schema.creditLedger).values([
      { userId, delta: -100, reason: 'JOB_DEBIT' },
      { userId, delta: -50, reason: 'JOB_DEBIT' },
      { userId, delta: 400, reason: 'ADMIN_GRANT' },
    ]);
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const token = await signAccess(secret, userId, { kind: 'access' }, '15m');

    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      displayName: string | null;
      email: string | null;
      balance: number;
      used: number;
    };
    expect(body.displayName).toBe('Store Owner');
    expect(body.balance).toBe(250);
    expect(body.used).toBe(150);
  });

  it("reports an ended monthly plan as 'expired' and an active one as 'active'", async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const meStatus = async (userId: string) => {
      const token = await signAccess(secret, userId, { kind: 'access' }, '15m');
      const res = await app.inject({
        method: 'GET',
        url: '/v1/merchant/me',
        headers: { authorization: `Bearer ${token}` },
      });
      return (res.json() as { unlimitedPlan: { status: string } }).unlimitedPlan.status;
    };

    const ended = await createTestMerchant(app, { balance: 10 });
    await app.db.insert(schema.unlimitedPlans).values({
      userId: ended.userId,
      startAt: new Date(Date.now() - 40 * DAY_MS),
      endAt: new Date(Date.now() - DAY_MS),
      grantedBy: ended.userId,
    });
    expect(await meStatus(ended.userId)).toBe('expired');

    const running = await createTestMerchant(app, { balance: 10 });
    await app.db.insert(schema.unlimitedPlans).values({
      userId: running.userId,
      startAt: new Date(Date.now() - DAY_MS),
      endAt: new Date(Date.now() + 20 * DAY_MS),
      grantedBy: running.userId,
    });
    expect(await meStatus(running.userId)).toBe('active');

    const none = await createTestMerchant(app, { balance: 10 });
    expect(await meStatus(none.userId)).toBe('none');
  });

  it('rejects a non-merchant account', async () => {
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: `plain${Date.now()}@example.com`, emailVerified: true, tier: 'free' })
      .returning();
    const token = await signAccess(secret, user?.id ?? '', { kind: 'access' }, '15m');

    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
