import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { mintAccountLinkCode } from '../src/modules/shopify/customer-auth.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { createVerifiedUserToken } from './helpers/auth.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 7).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';

let c: Containers;
let app: TestApp;
let storeId: string;
let sessionToken: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 77,
      shopDomain: 'link-test.myshopify.com',
      myshopifyDomain: 'link-test.myshopify.com',
      name: 'Link Test',
      email: 'link@test.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  sessionToken = signSessionToken('link-test.myshopify.com', API_SECRET, API_KEY);
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('POST /v1/shopify/store/account/link', () => {
  it('sets ownerUserId given a valid code', async () => {
    const { userId } = await createVerifiedUserToken(app, 'merchant-link@test.com');
    const code = await mintAccountLinkCode(app.redis, userId);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/store/account/link',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { code },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const [store] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(store.ownerUserId).toBe(userId);
  });

  it('rejects an invalid or expired code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/store/account/link',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { code: 'not-a-real-code' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a code that was already burned by a previous exchange', async () => {
    const { userId } = await createVerifiedUserToken(app, 'merchant-link-2@test.com');
    const code = await mintAccountLinkCode(app.redis, userId);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/shopify/store/account/link',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { code },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/shopify/store/account/link',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { code },
    });
    expect(second.statusCode).toBe(401);
  });

  it('rejects a request with no session token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/store/account/link',
      payload: { code: 'irrelevant' },
    });
    expect(res.statusCode).toBe(401);
  });
});
