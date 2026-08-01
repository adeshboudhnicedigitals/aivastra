import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { signSessionToken } from './helpers/shopify-session.js';

const ENC_KEY = Buffer.alloc(32, 11).toString('base64');
const API_SECRET = 'test-secret';
const API_KEY = 'test-key';
let c: Containers;
let app: TestApp;
let storeId: string;
let token: string;

// Every metafieldsSet call in this file goes through the stubbed global fetch,
// following apps/api/test/shopify-catalog-publish.test.ts. Without the stub the
// tests would make real network calls to m.myshopify.com.
function stubShopifyOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { metafieldsSet: { userErrors: [] } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  );
}

function stubShopifyFailure() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
}

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
      shopDomain: 'w.myshopify.com',
      myshopifyDomain: 'w.myshopify.com',
      name: 'W',
      email: 'w@w.com',
    },
    'tok',
    'read_products',
  );
  storeId = store.id;
  token = signSessionToken('w.myshopify.com', API_SECRET, API_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app.close();
  await c.stop();
});

async function patch(body: unknown) {
  return app.inject({
    method: 'PATCH',
    url: '/v1/shopify/widget-config',
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
}

async function readSettings() {
  const [row] = await app.db
    .select({ settings: schema.shopifyStores.settings })
    .from(schema.shopifyStores)
    .where(eq(schema.shopifyStores.id, storeId));
  return row.settings;
}

describe('PATCH /v1/shopify/widget-config', () => {
  it('stores config and reports synced', async () => {
    stubShopifyOk();
    const res = await patch({ theme: { accentColor: '#123abc' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      widget: { theme: { accentColor: '#123abc' } },
      synced: true,
    });
    expect((await readSettings()).widget?.theme?.accentColor).toBe('#123abc');
  });

  it('merges within a sub-object instead of replacing it', async () => {
    stubShopifyOk();
    await patch({ copy: { heading: 'Hello' } });
    await patch({ copy: { subheading: 'World' } });
    const settings = await readSettings();
    expect(settings.widget?.copy).toEqual({ heading: 'Hello', subheading: 'World' });
  });

  it('serializes concurrent patches so neither config change is lost', async () => {
    stubShopifyOk();
    await app.db
      .update(schema.shopifyStores)
      .set({ settings: {} })
      .where(eq(schema.shopifyStores.id, storeId));

    const [first, second] = await Promise.all([
      patch({ copy: { heading: 'First' } }),
      patch({ copy: { subheading: 'Second' } }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect((await readSettings()).widget?.copy).toEqual({
      heading: 'First',
      subheading: 'Second',
    });
  });

  it('does not clobber sibling settings keys', async () => {
    stubShopifyOk();
    await app.db
      .update(schema.shopifyStores)
      .set({
        settings: {
          themeBlockConfirmed: true,
          limits: { storeDailyCap: 50 },
          retention: { resultDays: 30 },
        },
      })
      .where(eq(schema.shopifyStores.id, storeId));

    await patch({ behavior: { addToCart: false } });

    const settings = await readSettings();
    expect(settings.themeBlockConfirmed).toBe(true);
    expect(settings.limits?.storeDailyCap).toBe(50);
    expect(settings.retention?.resultDays).toBe(30);
    expect(settings.widget?.behavior?.addToCart).toBe(false);
  });

  it('rejects a malformed accent color', async () => {
    stubShopifyOk();
    const res = await patch({ theme: { accentColor: 'red' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects over-length copy', async () => {
    stubShopifyOk();
    const res = await patch({ copy: { heading: 'x'.repeat(61) } });
    expect(res.statusCode).toBe(400);
  });

  it('still saves and returns synced:false when the metafield write fails', async () => {
    stubShopifyFailure();
    const res = await patch({ copy: { ctaLabel: 'Go' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().synced).toBe(false);
    expect((await readSettings()).widget?.copy?.ctaLabel).toBe('Go');
  });
});

describe('POST /v1/shopify/widget-config/republish', () => {
  it('pushes the stored config without writing the row', async () => {
    stubShopifyOk();
    await patch({ copy: { heading: 'Stable' } });
    const before = await readSettings();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/widget-config/republish',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ synced: true });
    expect(await readSettings()).toEqual(before);
  });
});
