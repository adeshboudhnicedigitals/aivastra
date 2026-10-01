import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertShopifyStore } from '../src/modules/shopify/auth.routes.js';
import {
  runWebhookReconcileTick,
  startWebhookRegistrationReconciler,
} from '../src/modules/shopify/webhook-registration-reconciler.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

const ENC_KEY = Buffer.alloc(32, 7).toString('base64');
let c: Containers;
let app: TestApp;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c, {
    SHOPIFY_TOKEN_ENC_KEY: ENC_KEY,
    SHOPIFY_API_SECRET: 'test-secret',
    SHOPIFY_API_KEY: 'test-key',
    SHOPIFY_APP_URL: 'https://app.test',
  });
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('runWebhookReconcileTick', () => {
  it('registers only the topics missing from webhooks.json, leaving an already-complete store alone', async () => {
    const missing = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 1001,
        shopDomain: 'missing.myshopify.com',
        myshopifyDomain: 'missing.myshopify.com',
        name: 'Missing',
        email: 'missing@example.com',
      },
      'tok',
      'read_products',
    );
    const complete = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 1002,
        shopDomain: 'complete.myshopify.com',
        myshopifyDomain: 'complete.myshopify.com',
        name: 'Complete',
        email: 'complete@example.com',
      },
      'tok',
      'read_products',
    );

    const registeredTopics: Array<{ shop: string; topic: string }> = [];
    const originalFetch = global.fetch;
    global.fetch = (async (url: string, init?: RequestInit) => {
      const shop = new URL(url).hostname;
      if (!init || init.method === undefined) {
        // GET webhooks.json
        const existing =
          shop === complete.shopDomain
            ? [
                'app/uninstalled',
                'products/create',
                'products/update',
                'products/delete',
                'collections/update',
              ]
            : [];
        return new Response(JSON.stringify({ webhooks: existing.map((topic) => ({ topic })) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // POST webhooks.json (registration)
      const body = JSON.parse(String(init.body)) as { webhook: { topic: string } };
      registeredTopics.push({ shop, topic: body.webhook.topic });
      return new Response(JSON.stringify({ webhook: {} }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      await runWebhookReconcileTick(app);

      const missingShopTopics = registeredTopics
        .filter((r) => r.shop === missing.shopDomain)
        .map((r) => r.topic)
        .sort();
      expect(missingShopTopics).toEqual(
        [
          'app/uninstalled',
          'collections/update',
          'products/create',
          'products/delete',
          'products/update',
        ].sort(),
      );

      const completeShopTopics = registeredTopics.filter((r) => r.shop === complete.shopDomain);
      expect(completeShopTopics).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('startWebhookRegistrationReconciler', () => {
  it('runs one pass immediately on start, not just on the first interval tick', async () => {
    const store = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 1003,
        shopDomain: 'immediate.myshopify.com',
        myshopifyDomain: 'immediate.myshopify.com',
        name: 'Immediate',
        email: 'immediate@example.com',
      },
      'tok',
      'read_products',
    );

    let registeredForStore = false;
    const originalFetch = global.fetch;
    global.fetch = (async (url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return new Response(JSON.stringify({ webhooks: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (new URL(url).hostname === store.shopDomain) registeredForStore = true;
      return new Response(JSON.stringify({ webhook: {} }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      // Interval is deliberately huge — if this only ran on the timer, nothing
      // would happen within the test's lifetime, so any registration here
      // proves the immediate-on-start call, not the interval.
      const stop = startWebhookRegistrationReconciler(app, 1_000_000);
      // The initial call is fire-and-forget inside start(); give its promise
      // chain a tick to run before asserting and tearing down.
      await new Promise((resolve) => setTimeout(resolve, 50));
      stop();

      expect(registeredForStore).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
