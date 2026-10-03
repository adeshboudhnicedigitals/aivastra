import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

let c: Containers;
let app: TestApp;
let base: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app.close();
  await c.stop();
});

// Distinct RFC 5737 test IPs per call — the route's own 5/min rate limit buckets
// by cf-connecting-ip (falling back to req.ip), and this suite makes more than
// 5 calls against one app instance in well under a minute.
let testIp = 1;
const post = (body: Record<string, unknown>) =>
  fetch(`${base}/v1/merchant/wordpress-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${testIp++}` },
    body: JSON.stringify(body),
  });

async function createUser(opts: {
  email: string;
  password: string;
  emailVerified?: boolean;
  isBanned?: boolean;
}) {
  const passwordHash = await hashPassword(opts.password);
  const [user] = await app.db
    .insert(schema.users)
    .values({
      email: opts.email,
      passwordHash,
      displayName: 'Existing Merchant',
      emailVerified: opts.emailVerified ?? true,
      isBanned: opts.isBanned ?? false,
    })
    .returning();
  if (!user) throw new Error('failed to create test user');
  await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 250 });
  return user;
}

describe('POST /v1/merchant/wordpress-login', () => {
  it('registers a brand-new account and sends it to email verification', async () => {
    const email = `new-${randomUUID()}@test.com`;
    const res = await post({
      email,
      password: 'password123',
      siteUrl: 'https://brand-new.example.com/',
      siteName: 'Brand New Shop',
      phone: '1234567890',
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'verification_required' });

    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user) throw new Error('user not created');
    expect(user.emailVerified).toBe(false);

    const [merchant] = await app.db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.userId, user.id));
    expect(merchant?.signupSource).toBe('wordpress');
    expect(merchant?.phone).toBe('1234567890');
  });

  it('creates a brand-new merchant without a phone number', async () => {
    const email = `new-${randomUUID()}@test.com`;
    const res = await post({
      email,
      password: 'password123',
      siteUrl: 'https://brand-new.example.com/',
    });
    expect(res.status).toBe(202);

    const [user] = await app.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user) throw new Error('user not created');

    const [merchant] = await app.db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.userId, user.id));
    expect(merchant?.signupSource).toBe('wordpress');
    expect(merchant?.phone).toBe('Not Provided');
  });

  it('logs an existing, verified merchant in and mints site-scoped keys', async () => {
    const email = `existing-${randomUUID()}@test.com`;
    const password = 'correct horse battery staple';
    const user = await createUser({ email, password });
    await app.db.insert(schema.merchants).values({
      companyName: 'Acme Co',
      contactName: 'Acme Admin',
      phone: '0000000000',
      businessAddress: 'Test Address',
      isActive: true,
      demoData: false,
      userId: user.id,
    });

    const res = await post({
      email,
      password,
      siteUrl: 'https://existing-shop.example.com/',
      siteName: 'Existing Shop',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('connected');
    expect(body.companyName).toBe('Acme Co');
    expect(body.credits).toBe(250);
    expect(body.fullKey).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
    expect(body.widgetKey).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
  });

  it('rejects a wrong password with a generic error', async () => {
    const email = `existing-${randomUUID()}@test.com`;
    const user = await createUser({ email, password: 'the-real-password' });
    await app.db.insert(schema.merchants).values({
      companyName: 'Acme Co',
      contactName: 'Acme Admin',
      phone: '0000000000',
      businessAddress: 'Test Address',
      isActive: true,
      demoData: false,
      userId: user.id,
    });

    const res = await post({
      email,
      password: 'totally-wrong',
      siteUrl: 'https://existing-shop.example.com/',
    });
    expect(res.status).toBe(401);
  });

  it('rejects a banned account with the same generic error as a wrong password', async () => {
    const email = `banned-${randomUUID()}@test.com`;
    await createUser({ email, password: 'password123', isBanned: true });

    const res = await post({
      email,
      password: 'password123',
      siteUrl: 'https://existing-shop.example.com/',
    });
    expect(res.status).toBe(401);
  });

  it('blocks an unverified existing account and resends the verification email', async () => {
    const email = `unverified-${randomUUID()}@test.com`;
    await createUser({ email, password: 'password123', emailVerified: false });

    const res = await post({
      email,
      password: 'password123',
      siteUrl: 'https://existing-shop.example.com/',
    });
    expect(res.status).toBe(403);
  });

  it('self-serve creates a merchant row for an existing verified account with no phone number', async () => {
    const email = `no-merchant-${randomUUID()}@test.com`;
    const user = await createUser({ email, password: 'password123' });

    const res = await post({
      email,
      password: 'password123',
      siteUrl: 'https://existing-shop.example.com/',
    });
    expect(res.status).toBe(200);

    const [merchant] = await app.db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.userId, user.id));
    expect(merchant?.phone).toBe('Not Provided');
  });

  it('self-serve creates a merchant row for an existing verified account given a phone number', async () => {
    const email = `no-merchant-${randomUUID()}@test.com`;
    const user = await createUser({ email, password: 'password123' });

    const res = await post({
      email,
      password: 'password123',
      siteUrl: 'https://existing-shop.example.com/',
      phone: '9999999999',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('connected');

    const [merchant] = await app.db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.userId, user.id));
    expect(merchant?.signupSource).toBe('wordpress');
    expect(merchant?.phone).toBe('9999999999');
  });

  it('rejects a deactivated merchant account', async () => {
    const email = `inactive-${randomUUID()}@test.com`;
    const user = await createUser({ email, password: 'password123' });
    await app.db.insert(schema.merchants).values({
      companyName: 'Deactivated Co',
      contactName: 'Deactivated Admin',
      phone: '0000000000',
      businessAddress: 'Test Address',
      isActive: false,
      demoData: false,
      userId: user.id,
    });

    const res = await post({
      email,
      password: 'password123',
      siteUrl: 'https://existing-shop.example.com/',
    });
    expect(res.status).toBe(403);
  });

  it('rejects a malformed siteUrl', async () => {
    const res = await post({
      email: `malformed-${randomUUID()}@test.com`,
      password: 'password123',
      siteUrl: 'not-a-url',
      phone: '1234567890',
    });
    expect(res.status).toBe(400);
  });
});
