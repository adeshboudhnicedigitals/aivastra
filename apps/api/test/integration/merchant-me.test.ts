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

  it("returns the merchant's display name, email, and credit balance", async () => {
    const { userId } = await createTestMerchant(app, { merchantBalance: 250 });
    await app.db
      .update(schema.users)
      .set({ displayName: 'Store Owner' })
      .where(eq(schema.users.id, userId));
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
    };
    expect(body.displayName).toBe('Store Owner');
    expect(body.balance).toBe(250);
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
