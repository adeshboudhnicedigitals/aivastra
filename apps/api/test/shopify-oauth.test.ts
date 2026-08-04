import { createHmac } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildPostInstallRedirect,
  upsertShopifyStore,
} from '../src/modules/shopify/auth.routes.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

const ENC_KEY = Buffer.alloc(32, 7).toString('base64');
const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';
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

function signedCallbackUrl(params: Record<string, string>): string {
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const hmac = createHmac('sha256', API_SECRET).update(message).digest('hex');
  return `/v1/shopify/auth/callback?${new URLSearchParams({ ...params, hmac })}`;
}

function stubOAuthCallbackFetch(options: {
  shopDomain: string;
  shopifyShopId: number;
  configStatus?: number;
}) {
  const published: { config: unknown; token: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/admin/oauth/access_token')) {
        return new Response(
          JSON.stringify({ access_token: 'fresh-token', scope: 'read_products' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/graphql.json')) {
        const body = JSON.parse(String(init?.body)) as {
          query?: string;
          variables?: { metafields?: { value: string }[] };
        };
        // Handle SHOP_DETAILS query (new GraphQL flow)
        if (body.query?.includes('ShopDetails')) {
          return new Response(
            JSON.stringify({
              data: {
                shop: {
                  id: `gid://shopify/Shop/${options.shopifyShopId}`,
                  myshopifyDomain: options.shopDomain,
                  name: 'Recovery Demo',
                  email: 'owner@example.com',
                  primaryDomain: null,
                  shopOwnerName: null,
                  billingAddress: null,
                  ianaTimezone: null,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        // Handle metafields mutation
        if (body.variables?.metafields) {
          published.push({
            config: JSON.parse(body.variables.metafields[0].value),
            token: new Headers(init?.headers).get('X-Shopify-Access-Token'),
          });
          if (options.configStatus && options.configStatus !== 200) {
            return new Response('failed', { status: options.configStatus });
          }
          return new Response(JSON.stringify({ data: { metafieldsSet: { userErrors: [] } } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return published;
}

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_KEY: API_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_APP_URL: 'https://app.example.com',
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('buildPostInstallRedirect', () => {
  it('returns the merchant to Shopify, which re-opens the app with host/id_token', () => {
    expect(buildPostInstallRedirect('demo.myshopify.com', 'apikey123')).toBe(
      'https://admin.shopify.com/store/demo/apps/apikey123',
    );
  });

  it('never points at our own SPA — App Bridge cannot handshake without Shopify supplying host', () => {
    const url = buildPostInstallRedirect('demo.myshopify.com', 'apikey123');
    expect(url.startsWith('https://admin.shopify.com/')).toBe(true);
    expect(url).not.toContain('aivastra');
    expect(url).not.toContain('/embedded');
  });

  it('keeps hyphenated store handles intact and strips only the myshopify suffix', () => {
    expect(buildPostInstallRedirect('my-cool-shop.myshopify.com', 'k')).toBe(
      'https://admin.shopify.com/store/my-cool-shop/apps/k',
    );
  });
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

describe('GET /v1/shopify/auth/callback', () => {
  it('republishes the committed widget config after reauthorization', async () => {
    const recoveryShop = 'recovery-demo.myshopify.com';
    const storedConfig = {
      copy: { heading: 'Saved before reauthorization', ctaLabel: 'Try it' },
      behavior: { addToCart: false },
    };
    const store = await upsertShopifyStore(
      app,
      {
        ...shop,
        shopifyShopId: 54321,
        shopDomain: recoveryShop,
        myshopifyDomain: recoveryShop,
        primaryDomain: undefined,
      },
      'expired-token',
      'read_products',
    );
    await app.db
      .update(schema.shopifyStores)
      .set({ settings: { widget: storedConfig } })
      .where(eq(schema.shopifyStores.id, store.id));

    const state = 'reauth-state';
    await app.redis.set(`shopify:nonce:${state}`, recoveryShop, 'EX', 600);
    const params: Record<string, string> = {
      code: 'fresh-code',
      shop: recoveryShop,
      state,
    };
    const published = stubOAuthCallbackFetch({
      shopDomain: recoveryShop,
      shopifyShopId: 54321,
    });

    const response = await app.inject({
      method: 'GET',
      url: signedCallbackUrl(params),
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `https://admin.shopify.com/store/recovery-demo/apps/${API_KEY}`,
    );
    expect(published).toEqual([{ config: storedConfig, token: 'fresh-token' }]);

    const [updated] = await app.db
      .select({ settings: schema.shopifyStores.settings })
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect((updated.settings as { widgetConfigSynced?: boolean }).widgetConfigSynced).toBe(true);
  });

  it('persists storefront drift when OAuth-time publication fails', async () => {
    const recoveryShop = 'recovery-failure.myshopify.com';
    const storedConfig = { copy: { heading: 'Still pending' } };
    const store = await upsertShopifyStore(
      app,
      {
        ...shop,
        shopifyShopId: 54322,
        shopDomain: recoveryShop,
        myshopifyDomain: recoveryShop,
        primaryDomain: undefined,
      },
      'expired-token',
      'read_products',
    );
    await app.db
      .update(schema.shopifyStores)
      .set({ settings: { widget: storedConfig } })
      .where(eq(schema.shopifyStores.id, store.id));

    const state = 'reauth-failure-state';
    await app.redis.set(`shopify:nonce:${state}`, recoveryShop, 'EX', 600);
    stubOAuthCallbackFetch({
      shopDomain: recoveryShop,
      shopifyShopId: 54322,
      configStatus: 500,
    });

    const response = await app.inject({
      method: 'GET',
      url: signedCallbackUrl({ code: 'fresh-code', shop: recoveryShop, state }),
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `https://admin.shopify.com/store/recovery-failure/apps/${API_KEY}`,
    );
    const [updated] = await app.db
      .select({ settings: schema.shopifyStores.settings })
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect((updated.settings as { widgetConfigSynced?: boolean }).widgetConfigSynced).toBe(false);
  });
});
