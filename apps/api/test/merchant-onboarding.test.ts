import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../src/modules/auth/service.js';
import { adminAuthHeader } from './helpers/admin.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { createTestMerchant } from './helpers/merchant.js';

let c: Containers;
let app: TestApp;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
});

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function tokenFor(userId: string) {
  return signAccess(
    new TextEncoder().encode(app.env.JWT_SECRET),
    userId,
    { kind: 'access' },
    app.env.JWT_EXPIRY,
  );
}

async function createGoogleUser(displayName: string | null = 'Google Person') {
  const [user] = await app.db
    .insert(schema.users)
    .values({
      email: `onb-${randomUUID()}@example.com`,
      displayName,
      passwordHash: null,
      emailVerified: true,
    })
    .returning();
  if (!user) throw new Error('failed to create user');
  return { userId: user.id, token: await tokenFor(user.id) };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('GET /v1/merchant/onboarding', () => {
  it('reports ONBOARDING_REQUIRED with a prefill before onboarding', async () => {
    const { token } = await createGoogleUser('Prefill Person');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/onboarding',
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      merchantStatus: 'ONBOARDING_REQUIRED',
      prefill: { contactName: 'Prefill Person', companyName: 'Prefill Person', phone: '' },
    });
  });

  it('reports ACTIVE once a merchant exists', async () => {
    const merchant = await createTestMerchant(app, { isActive: true });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/merchant/onboarding',
      headers: auth(await tokenFor(merchant.userId)),
    });
    expect(res.json().merchantStatus).toBe('ACTIVE');
  });

  it('401s without a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/merchant/onboarding' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/merchant/onboarding', () => {
  it('creates an active merchant from the phone number alone', async () => {
    const { userId, token } = await createGoogleUser('Only Name');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/onboarding',
      headers: auth(token),
      payload: { phone: '9876543210' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().merchantStatus).toBe('ACTIVE');

    const [merchant] = await app.db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.userId, userId));
    expect(merchant).toMatchObject({
      contactName: 'Only Name',
      companyName: 'Only Name',
      businessAddress: 'Not Provided',
      phone: '9876543210',
      isActive: true,
      signupSource: 'android_google',
    });

    const [credits] = await app.db
      .select()
      .from(schema.merchantCredits)
      .where(eq(schema.merchantCredits.merchantId, merchant?.id ?? ''));
    expect(credits?.balance).toBe(0);

    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user?.phone).toBe('9876543210');
  });

  it('uses all four supplied fields when given', async () => {
    const { userId, token } = await createGoogleUser();
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/onboarding',
      headers: auth(token),
      payload: {
        phone: '9000000001',
        contactName: 'Real Contact',
        companyName: 'Real Shop',
        businessAddress: '1 Real Street',
      },
    });

    const [merchant] = await app.db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.userId, userId));
    expect(merchant).toMatchObject({
      contactName: 'Real Contact',
      companyName: 'Real Shop',
      businessAddress: '1 Real Street',
    });
  });

  it('unblocks requireMerchant immediately', async () => {
    const { token } = await createGoogleUser();
    const before = await app.inject({
      method: 'GET',
      url: '/v1/merchant/catalog',
      headers: auth(token),
    });
    expect(before.statusCode).toBe(403);

    await app.inject({
      method: 'POST',
      url: '/v1/merchant/onboarding',
      headers: auth(token),
      payload: { phone: '9000000002' },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/v1/merchant/catalog',
      headers: auth(token),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().items).toEqual([]);
  });

  it('409s on a second submit', async () => {
    const { token } = await createGoogleUser();
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/onboarding',
      headers: auth(token),
      payload: { phone: '9000000003' },
    });
    const again = await app.inject({
      method: 'POST',
      url: '/v1/merchant/onboarding',
      headers: auth(token),
      payload: { phone: '9000000003' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('CONFLICT');
  });

  it('409s for an admin-created merchant and leaves signupSource as admin', async () => {
    const merchant = await createTestMerchant(app, { isActive: true });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/merchant/onboarding',
      headers: auth(await tokenFor(merchant.userId)),
      payload: { phone: '9000000004' },
    });
    expect(res.statusCode).toBe(409);

    const [row] = await app.db
      .select({ signupSource: schema.merchants.signupSource })
      .from(schema.merchants)
      .where(eq(schema.merchants.id, merchant.merchantId));
    expect(row?.signupSource).toBe('admin');
  });

  it('rejects an arbitrary signup source at the database boundary', async () => {
    const { userId } = await createGoogleUser();

    await expect(
      app.db.insert(schema.merchants).values({
        companyName: 'Invalid Source Shop',
        contactName: 'Invalid Source Person',
        phone: '9000000005',
        businessAddress: '1 Constraint Street',
        signupSource: 'unapproved' as never,
        userId,
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('400s on a missing or malformed phone number', async () => {
    const { token } = await createGoogleUser();
    for (const payload of [{}, { phone: '123' }, { phone: 'not-a-number' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/merchant/onboarding',
        headers: auth(token),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('GET /admin/merchants signupSource', () => {
  it('reports android_google for a self-serve signup and admin for the rest', async () => {
    const adminHeaders = await adminAuthHeader(app, 'SUPER_ADMIN');
    const seeded = await createTestMerchant(app, { isActive: true });
    const { token } = await createGoogleUser();
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/onboarding',
      headers: auth(token),
      payload: { phone: '9000000005' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/merchants',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);

    const rows = res.json().clients as Array<{ id: string; signupSource: string }>;
    expect(rows.find((row) => row.id === seeded.merchantId)?.signupSource).toBe('admin');
    expect(rows.some((row) => row.signupSource === 'android_google')).toBe(true);
  });
});

describe('GET /admin/users signupSource', () => {
  it('reports a merchant user signup source', async () => {
    const adminHeaders = await adminAuthHeader(app, 'SUPER_ADMIN');
    const seeded = await createTestMerchant(app, { isActive: true });
    const selfServe = await createGoogleUser();
    const nonMerchant = await createGoogleUser();
    await app.inject({
      method: 'POST',
      url: '/v1/merchant/onboarding',
      headers: auth(selfServe.token),
      payload: { phone: '9000000006' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);

    const rows = res.json().items as Array<{ id: string; signupSource: string | null }>;
    expect(rows.find((row) => row.id === seeded.userId)?.signupSource).toBe('admin');
    expect(rows.find((row) => row.id === selfServe.userId)?.signupSource).toBe('android_google');
    expect(rows.find((row) => row.id === nonMerchant.userId)?.signupSource).toBeNull();
  });
});
