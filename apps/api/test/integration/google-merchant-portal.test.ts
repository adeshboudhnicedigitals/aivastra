import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { createTestBranch, createTestMerchant, createTestStaff } from '../helpers/merchant.js';

const MERCHANT_WEB = 'http://localhost:3010';
const STATE = 'merchant-portal-state';

describe('Merchant Web — Google sign-in', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:4000/v1/auth/google/callback',
      WEB_URL: 'http://localhost:3000',
      MERCHANT_WEB_URL: MERCHANT_WEB,
    });
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  afterEach(() => vi.restoreAllMocks());

  function mockGoogle(identity: { sub: string; email: string }) {
    vi.spyOn(global, 'fetch').mockImplementation((async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'g-access' }), { status: 200 });
      }
      if (u.includes('/oauth2/v3/userinfo')) {
        return new Response(JSON.stringify({ ...identity, name: 'G User' }), { status: 200 });
      }
      throw new Error(`Unexpected fetch to: ${u}`);
    }) as typeof fetch);
  }

  const callback = () =>
    app.inject({
      method: 'GET',
      url: `/v1/auth/google/callback?code=c&state=${STATE}`,
      headers: { cookie: `google_state=${STATE}; google_portal=merchant` },
    });

  it('init with portal=merchant sets the portal cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/google/init?portal=merchant' });
    expect(res.statusCode).toBe(302);
    expect(res.cookies.find((ck) => ck.name === 'google_portal')?.value).toBe('merchant');
  });

  it('init without portal clears the portal cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/google/init' });
    const ck = res.cookies.find((x) => x.name === 'google_portal');
    expect(ck?.value ?? '').toBe('');
  });

  it('owner with the same email is linked and handed to Merchant Web', async () => {
    const { userId } = await createTestMerchant(app);
    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.id, userId));
    mockGoogle({ sub: `sub-${randomUUID()}`, email: user?.email ?? '' });
    const res = await callback();
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location.startsWith(`${MERCHANT_WEB}/api/auth/google/callback?code=`)).toBe(true);
    const otp = new URL(location).searchParams.get('code');
    expect(await app.redis.get(`oauth:otp:${otp}`)).toBe(userId);
  });

  it('unknown Google account is refused and no user is created', async () => {
    const email = `stranger-${randomUUID()}@example.com`;
    mockGoogle({ sub: `sub-${randomUUID()}`, email });
    const res = await callback();
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location.startsWith(`${MERCHANT_WEB}/login`)).toBe(true);
    expect(location).toContain('error=not_a_merchant');
    const rows = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(rows).toHaveLength(0);
  });

  it('non-merchant existing user is refused', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    await app.db.insert(schema.users).values({ email, emailVerified: true });
    mockGoogle({ sub: `sub-${randomUUID()}`, email });
    const res = await callback();
    expect(res.headers.location as string).toContain('error=not_a_merchant');
  });

  it('staff email cannot link Google', async () => {
    const { merchantId } = await createTestMerchant(app);
    const branch = await createTestBranch(app, merchantId);
    const staff = await createTestStaff(app, merchantId, branch.id);
    const [user] = await app.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, staff.userId));
    mockGoogle({ sub: `sub-${randomUUID()}`, email: user?.email ?? '' });
    const res = await callback();
    expect(res.headers.location as string).toContain('error=not_a_merchant');
    const links = await app.db
      .select()
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.userId, staff.userId));
    expect(links).toHaveLength(0);
  });

  it('exchange portal=merchant: owner gets a web session, shopper gets 403', async () => {
    const { userId } = await createTestMerchant(app);
    await app.redis.set('oauth:otp:mp-owner', userId, 'EX', 60);
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/auth/google/exchange',
      payload: { code: 'mp-owner', portal: 'merchant' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.map((ck) => ck.name)).toContain('refresh');

    const [shopper] = await app.db
      .insert(schema.users)
      .values({ email: `s-${randomUUID()}@example.com`, emailVerified: true })
      .returning();
    await app.redis.set('oauth:otp:mp-shopper', shopper?.id ?? '', 'EX', 60);
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/auth/google/exchange',
      payload: { code: 'mp-shopper', portal: 'merchant' },
    });
    expect(denied.statusCode).toBe(403);
  });
});
