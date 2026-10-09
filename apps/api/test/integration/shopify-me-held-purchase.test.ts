import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';
import { signSessionToken } from '../helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 14).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';

let c: Containers;
let app: TestApp;
let seq = 0;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_API_KEY: API_KEY,
  });
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

// One store per case so each store's "latest purchase" is exactly the row
// under test.
async function meFor(paymentStatus: 'NOT_REQUIRED' | 'AWAITING' | 'PAID' | 'UNPAID') {
  seq += 1;
  const domain = `held-${seq}.myshopify.com`;
  const store = await upsertShopifyStore(
    app,
    {
      shopifyShopId: 8000 + seq,
      shopDomain: domain,
      myshopifyDomain: domain,
      name: 'H',
      email: `h${seq}@h.com`,
    },
    'tok',
    'read_products',
  );
  await app.db.insert(schema.shopifyCreditPurchases).values({
    storeId: store.id,
    packId: 'pack_10',
    credits: 800,
    priceUsdCents: 1000,
    status: 'ACTIVE',
    shopifyChargeId: `gid://shopify/AppPurchaseOneTime/${7000 + seq}`,
    paymentStatus,
  });
  const res = await app.inject({
    method: 'GET',
    url: '/v1/shopify/me',
    headers: { authorization: `Bearer ${signSessionToken(domain, API_SECRET, API_KEY)}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('GET /v1/shopify/me - hasPurchasedPack with an ACTIVE charge', () => {
  it('is false while payment is AWAITING (held, no credits granted)', async () => {
    const body = await meFor('AWAITING');
    expect(body.hasPurchasedPack).toBe(false);
    expect(body.currentPack).toBeNull();
  });

  it('is false when payment is UNPAID (parked)', async () => {
    const body = await meFor('UNPAID');
    expect(body.hasPurchasedPack).toBe(false);
    expect(body.currentPack).toBeNull();
  });

  it('is true and reports the pack once PAID', async () => {
    const body = await meFor('PAID');
    expect(body.hasPurchasedPack).toBe(true);
    expect(body.currentPack).toEqual({ id: 'pack_10', label: 'Silver' });
  });

  it('is true for NOT_REQUIRED (legacy / test / autorefill)', async () => {
    const body = await meFor('NOT_REQUIRED');
    expect(body.hasPurchasedPack).toBe(true);
    expect(body.currentPack).toEqual({ id: 'pack_10', label: 'Silver' });
  });
});
