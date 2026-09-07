import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { signSessionToken } from '../helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 12).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';

describe('POST /v1/shopify/support/session', () => {
  let c: Containers;
  let app: TestApp;
  let auth: { authorization: string };
  let shopDomain: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c, {
      SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
      SHOPIFY_API_SECRET: API_SECRET,
      SHOPIFY_API_KEY: API_KEY,
    });

    const tag = Date.now();
    shopDomain = `support-session-${tag}.myshopify.com`;
    await upsertShopifyStore(
      app,
      {
        shopifyShopId: tag,
        shopDomain,
        myshopifyDomain: shopDomain,
        name: 'Support Session Store',
        email: 'owner@support-session-test.com',
      },
      'tok',
      'read_products',
    );
    auth = { authorization: `Bearer ${signSessionToken(shopDomain, API_SECRET, API_KEY)}` };
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  it('creates a support user on first call and mints a valid platform access token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/support/session',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };
    expect(typeof token).toBe('string');

    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    expect(payload.kind).toBe('access');
    expect(typeof payload.sub).toBe('string');

    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.shopDomain, shopDomain));
    expect(store.supportUserId).toBe(payload.sub);

    const [user] = await app.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, store.supportUserId as string));
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerified).toBe(true);
    // Shop domain, not the opaque store id — this is the only signal that
    // distinguishes a Shopify ticket in ChatInboxPage's userEmail column.
    expect(user.email).toBe(`shopify-support+${shopDomain}@internal.aivastra.com`);
  });

  it('is idempotent — a second call returns the same support user', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/shopify/support/session',
      headers: auth,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/shopify/support/session',
      headers: auth,
    });
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const firstSub = (await jwtVerify((first.json() as { token: string }).token, secret)).payload
      .sub;
    const secondSub = (await jwtVerify((second.json() as { token: string }).token, secret)).payload
      .sub;
    expect(secondSub).toBe(firstSub);
  });

  it('rejects a request with no session token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/shopify/support/session' });
    expect(res.statusCode).toBe(401);
  });
});
