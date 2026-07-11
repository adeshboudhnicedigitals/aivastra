import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

const ENC_KEY = Buffer.alloc(32, 7).toString('base64');
let c: Containers;
let app: TestApp;

const shop = {
  shopifyShopId: 12345,
  shopDomain: 'demo.myshopify.com',
  myshopifyDomain: 'demo.myshopify.com',
  primaryDomain: 'demo.example.com',
  name: 'Demo',
  shopOwner: 'Jane',
  email: 'jane@demo.example.com',
  phone: '123',
  address: 'Somewhere',
};

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, { SHOPIFY_TOKEN_ENC_KEY: ENC_KEY });
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('upsertShopifyStore', () => {
  it('creates a store with allowedOrigins on first install', async () => {
    const store = await upsertShopifyStore(app, shop, 'shpat_token_1', 'read_products');
    expect(store.shopDomain).toBe('demo.myshopify.com');
    expect(store.allowedOrigins).toContain('https://demo.myshopify.com');
    expect(store.allowedOrigins).toContain('https://demo.example.com');
    expect(store.storeKey).toBeTruthy(); // auto-generated UUID
    // token stored encrypted, not plaintext
    expect(store.accessToken).not.toContain('shpat_token_1');
  });

  it('reactivates on reinstall without duplicating rows', async () => {
    await app.db
      .update(schema.shopifyStores)
      .set({ uninstalledAt: new Date() })
      .where(eq(schema.shopifyStores.shopifyShopId, 12345));
    const store2 = await upsertShopifyStore(app, shop, 'shpat_token_2', 'read_products');
    expect(store2.uninstalledAt).toBeNull();
    const all = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.shopifyShopId, 12345));
    expect(all).toHaveLength(1);
  });
});
