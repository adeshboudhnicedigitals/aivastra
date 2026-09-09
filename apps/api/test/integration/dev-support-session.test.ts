import { jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { createTestApiKey, createTestMerchant } from '../helpers/merchant.js';

describe('POST /v1/dev/support/session', () => {
  let c: Containers;
  let app: TestApp;
  let fullKey: string;
  let widgetKey: string;
  let merchantUserId: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    await app.ready();

    const m = await createTestMerchant(app);
    merchantUserId = m.userId;
    ({ key: fullKey } = await createTestApiKey(app, m.merchantId, { scope: 'full' }));
    ({ key: widgetKey } = await createTestApiKey(app, m.merchantId, { scope: 'widget' }));
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  it('mints a valid platform access token for the merchant behind a widget-scoped key', async () => {
    // No requireDevScope() on this route — the WordPress plugin only ever
    // holds a widget-scoped key day-to-day, same reasoning as
    // /v1/dev/balance and /v1/dev/plans.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/support/session',
      headers: { authorization: `Bearer ${widgetKey}` },
    });
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    expect(typeof token).toBe('string');

    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    expect(payload.kind).toBe('access');
    // Unlike Shopify's synthetic support user, this points straight at the
    // merchant's own real users.id.
    expect(payload.sub).toBe(merchantUserId);
  });

  it('also accepts a full-scoped key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/support/session',
      headers: { authorization: `Bearer ${fullKey}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a request with no API key', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/dev/support/session' });
    expect(res.statusCode).toBe(401);
  });
});
