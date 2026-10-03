import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { createTestMerchant } from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let base: string;
let token: string;
let merchantId: string;

async function tokenFor(userId: string) {
  return signAccess(
    new TextEncoder().encode(app.env.JWT_SECRET),
    userId,
    { kind: 'access' },
    app.env.JWT_EXPIRY,
    'user',
  );
}

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  await app.ready();
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const m = await createTestMerchant(app, { balance: 500 });
  merchantId = m.merchantId;
  token = await tokenFor(m.userId);
});

afterAll(async () => {
  await app.close();
  await c.stop();
});

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

describe('POST /v1/merchant/wordpress-connect', () => {
  it('mints a full key and a widget key scoped to the site, returning only a one-time code', async () => {
    const res = await call('/v1/merchant/wordpress-connect', {
      method: 'POST',
      body: JSON.stringify({ siteUrl: 'https://my-shop.example.com/', siteName: 'My Shop' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.code).toBe('string');
    expect(body).not.toHaveProperty('fullKey');
    expect(body).not.toHaveProperty('widgetKey');

    const rows = await app.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.merchantId, merchantId));
    const full = rows.find((r) => r.scope === 'full' && r.integration === 'wordpress');
    const widget = rows.find((r) => r.scope === 'widget' && r.integration === 'wordpress');
    expect(full).toBeTruthy();
    expect(widget).toBeTruthy();
    expect(widget?.allowedOrigin).toBe('https://my-shop.example.com');
    expect(full?.allowedOrigin).toBeNull();
  });

  it('requires merchant auth', async () => {
    const res = await fetch(`${base}/v1/merchant/wordpress-connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteUrl: 'https://x.example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed siteUrl', async () => {
    const res = await call('/v1/merchant/wordpress-connect', {
      method: 'POST',
      body: JSON.stringify({ siteUrl: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/wordpress/connect/exchange', () => {
  it('redeems the code exactly once for the minted keys', async () => {
    const connectRes = await call('/v1/merchant/wordpress-connect', {
      method: 'POST',
      body: JSON.stringify({ siteUrl: 'https://exchange-test.example.com' }),
    });
    const { code } = await connectRes.json();

    const exchangeRes = await fetch(`${base}/v1/wordpress/connect/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(exchangeRes.status).toBe(200);
    const payload = await exchangeRes.json();
    expect(payload.fullKey).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
    expect(payload.widgetKey).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
    expect(payload.fullKey).not.toBe(payload.widgetKey);
    expect(payload.companyName).toBe('Test Co');
    expect(payload.credits).toBe(500);

    // One-time: a second exchange with the same code must fail.
    const second = await fetch(`${base}/v1/wordpress/connect/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(second.status).toBe(400);
  });

  it('rejects an unknown code', async () => {
    const res = await fetch(`${base}/v1/wordpress/connect/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '00000000-0000-4000-8000-000000000000' }),
    });
    expect(res.status).toBe(400);
  });

  it('the exchanged full+widget keys authenticate against the dev API', async () => {
    const connectRes = await call('/v1/merchant/wordpress-connect', {
      method: 'POST',
      body: JSON.stringify({ siteUrl: 'https://auth-check.example.com' }),
    });
    const { code } = await connectRes.json();
    const { fullKey, widgetKey } = await (
      await fetch(`${base}/v1/wordpress/connect/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
    ).json();

    const meRes = await fetch(`${base}/v1/dev/me`, {
      headers: { authorization: `Bearer ${fullKey}` },
    });
    expect(meRes.status).toBe(200);

    // Widget-scoped key must not reach a full-only route.
    const widgetMeRes = await fetch(`${base}/v1/dev/me`, {
      headers: { authorization: `Bearer ${widgetKey}` },
    });
    expect(widgetMeRes.status).toBe(403);
  });
});
