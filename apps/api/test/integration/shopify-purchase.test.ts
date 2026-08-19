import { createHmac } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { upsertShopifyStore } from '../../src/modules/shopify/auth.routes.js';
import {
  confirmPurchase,
  createPurchase,
  grantForPurchase,
} from '../../src/modules/shopify/purchase.js';
import { buildTestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

let ctx: Containers;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let store: typeof schema.shopifyStores.$inferSelect;

// Fixed 32-byte key so upsertShopifyStore's encryptToken round-trips through
// getValidAccessToken in the webhook-route test below — see
// shopify-widget-config.test.ts for the same convention.
const TOKEN_ENC_KEY = Buffer.alloc(32, 11).toString('base64');
const WEBHOOK_SECRET = 'webhook-test-secret';

const fakeCharge = (overrides: Partial<{ id: string; status: string; test: boolean }> = {}) => ({
  id: 'gid://shopify/AppPurchaseOneTime/1',
  status: 'ACTIVE',
  test: false,
  ...overrides,
});

beforeAll(async () => {
  ctx = await startContainers();
  // createPurchase (purchase.ts, Task 3) requires SHOPIFY_APP_URL to build the
  // Shopify return URL — buildTestApp does not set it by default, so it must be
  // supplied here or every createPurchase call in this file throws CONFIG 500.
  // SHOPIFY_API_SECRET/SHOPIFY_TOKEN_ENC_KEY are only exercised by the HTTP-layer
  // webhook test below (real HMAC verification + real token decryption) — every
  // other test in this file goes through dependency-injected fakes and never
  // touches either.
  app = await buildTestApp(ctx, {
    SHOPIFY_APP_URL: 'https://app.aivastra.test',
    SHOPIFY_API_SECRET: WEBHOOK_SECRET,
    SHOPIFY_TOKEN_ENC_KEY: TOKEN_ENC_KEY,
  });
  [store] = await app.db
    .insert(schema.shopifyStores)
    .values({
      shopDomain: 'purchase-test.myshopify.com',
      shopifyShopId: 987654321,
      accessToken: 'enc:token',
      scope: 'read_products',
    })
    .returning();
}, 60000);

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('credit pack purchase', () => {
  it('writes a PENDING row and returns the confirmation URL', async () => {
    const result = await createPurchase(app, store, 'pack_25', {
      createCharge: async () => ({
        confirmationUrl: 'https://shopify.test/confirm',
        purchase: fakeCharge(),
      }),
    });

    expect(result.confirmationUrl).toBe('https://shopify.test/confirm');

    const [row] = await app.db
      .select()
      .from(schema.shopifyCreditPurchases)
      .where(eq(schema.shopifyCreditPurchases.id, result.purchaseId));

    expect(row.status).toBe('PENDING');
    expect(row.credits).toBe(2250);
    expect(row.priceUsdCents).toBe(2500);
    expect(row.source).toBe('manual');
  });

  it('rejects an unknown pack id without writing a row', async () => {
    const before = await app.db.select().from(schema.shopifyCreditPurchases);
    await expect(createPurchase(app, store, 'pack_999')).rejects.toThrow();
    const after = await app.db.select().from(schema.shopifyCreditPurchases);
    expect(after.length).toBe(before.length);
  });

  it('grants credits once on an ACTIVE charge, and never twice', async () => {
    const chargeId = 'gid://shopify/AppPurchaseOneTime/double';
    const { purchaseId } = await createPurchase(app, store, 'pack_10', {
      createCharge: async () => ({
        confirmationUrl: 'https://shopify.test/c',
        purchase: fakeCharge({ id: chargeId }),
      }),
    });
    const deps = { fetchPurchase: async () => fakeCharge({ id: chargeId }) };

    const first = await confirmPurchase(app, store, purchaseId, deps);
    expect(first.creditsGranted).toBe(800);

    const second = await confirmPurchase(app, store, purchaseId, deps);
    expect(second.creditsGranted).toBe(0);
    expect(second.creditBalance).toBe(first.creditBalance);
  });

  it('grants nothing while the charge is still PENDING', async () => {
    const { purchaseId } = await createPurchase(app, store, 'pack_10', {
      createCharge: async () => ({
        confirmationUrl: 'https://shopify.test/c',
        purchase: fakeCharge({ id: 'gid://shopify/AppPurchaseOneTime/pending' }),
      }),
    });
    const result = await confirmPurchase(app, store, purchaseId, {
      fetchPurchase: async () =>
        fakeCharge({ id: 'gid://shopify/AppPurchaseOneTime/pending', status: 'PENDING' }),
    });
    expect(result.creditsGranted).toBe(0);
    expect(result.status).toBe('PENDING');
  });

  it('grants nothing for a DECLINED charge', async () => {
    const { purchaseId } = await createPurchase(app, store, 'pack_10', {
      createCharge: async () => ({
        confirmationUrl: 'https://shopify.test/c',
        purchase: fakeCharge({ id: 'gid://shopify/AppPurchaseOneTime/declined' }),
      }),
    });
    const result = await confirmPurchase(app, store, purchaseId, {
      fetchPurchase: async () =>
        fakeCharge({ id: 'gid://shopify/AppPurchaseOneTime/declined', status: 'DECLINED' }),
    });
    expect(result.creditsGranted).toBe(0);
  });

  it('grants nothing for a test charge when the env gate is off', async () => {
    const { purchaseId } = await createPurchase(app, store, 'pack_10', {
      createCharge: async () => ({
        confirmationUrl: 'https://shopify.test/c',
        purchase: fakeCharge({ id: 'gid://shopify/AppPurchaseOneTime/test' }),
      }),
    });
    const result = await confirmPurchase(app, store, purchaseId, {
      fetchPurchase: async () =>
        fakeCharge({ id: 'gid://shopify/AppPurchaseOneTime/test', test: true }),
    });
    expect(result.creditsGranted).toBe(0);
  });

  it("returns 404 for another store's purchase row", async () => {
    const [other] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: 'other-purchase-test.myshopify.com',
        shopifyShopId: 987654322,
        accessToken: 'enc:token',
        scope: 'read_products',
      })
      .returning();
    const { purchaseId } = await createPurchase(app, store, 'pack_10', {
      createCharge: async () => ({
        confirmationUrl: 'https://shopify.test/c',
        purchase: fakeCharge({ id: 'gid://shopify/AppPurchaseOneTime/other' }),
      }),
    });
    await expect(confirmPurchase(app, other, purchaseId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  // The one guarantee in this module a future refactor could quietly undo.
  it('grants the snapshotted credits even after an admin edits the pack', async () => {
    const { purchaseId } = await createPurchase(app, store, 'pack_10', {
      createCharge: async () => ({
        confirmationUrl: 'https://shopify.test/c',
        purchase: fakeCharge({ id: 'gid://shopify/AppPurchaseOneTime/snapshot' }),
      }),
    });

    await app.redis.set(
      'config:system',
      JSON.stringify({ shopify: { packCredits: { pack_10: { credits: 999999 } } } }),
    );

    const result = await confirmPurchase(app, store, purchaseId, {
      fetchPurchase: async () => fakeCharge({ id: 'gid://shopify/AppPurchaseOneTime/snapshot' }),
    });
    expect(result.creditsGranted).toBe(800);

    await app.redis.del('config:system');
  });
});

describe('one-time purchase webhook', () => {
  it('grants credits for a merchant who never returned to the confirm route', async () => {
    const chargeId = 'gid://shopify/AppPurchaseOneTime/webhook';
    const { purchaseId } = await createPurchase(app, store, 'pack_50', {
      createCharge: async () => ({
        confirmationUrl: 'https://shopify.test/c',
        purchase: fakeCharge({ id: chargeId }),
      }),
    });

    const [row] = await app.db
      .select()
      .from(schema.shopifyCreditPurchases)
      .where(eq(schema.shopifyCreditPurchases.id, purchaseId));

    const granted = await grantForPurchase(app, row, {
      id: chargeId,
      status: 'ACTIVE',
      test: false,
    });
    expect(granted).toBe(4800);

    // The merchant later opens the app and hits confirm — must not double-grant.
    const confirmResult = await confirmPurchase(app, store, purchaseId, {
      fetchPurchase: async () => fakeCharge({ id: chargeId }),
    });
    expect(confirmResult.creditsGranted).toBe(0);
  });
});

describe('app_purchases_one_time_update webhook — HTTP layer', () => {
  // Everything above this block exercises grantForPurchase/confirmPurchase
  // directly, hand-constructing the {id, status, test} shape the route is
  // actually responsible for producing — it never proves the route parses a
  // real Shopify delivery correctly. This is the test that would have caught
  // C1 (payload nested under app_purchase_one_time, not at the root) and C2
  // (no `test` field on the payload at all — reading one off it silently
  // defeats the dev-store abuse gate). It POSTs an HMAC-signed, correctly
  // shaped body straight at the registered route.
  it("grants credits for a real, HMAC-signed webhook delivery shaped like Shopify's documented sample payload", async () => {
    const webhookStore = await upsertShopifyStore(
      app,
      {
        shopifyShopId: 555111222,
        shopDomain: 'webhook-http-test.myshopify.com',
        myshopifyDomain: 'webhook-http-test.myshopify.com',
        name: 'Webhook HTTP Test',
        email: 'webhook-http-test@example.com',
      },
      'real-offline-token',
      'read_products',
    );

    const chargeId = 'gid://shopify/AppPurchaseOneTime/http-webhook';
    const { purchaseId } = await createPurchase(app, webhookStore, 'pack_50', {
      createCharge: async () => ({
        confirmationUrl: 'https://shopify.test/c',
        purchase: fakeCharge({ id: chargeId, status: 'PENDING' }),
      }),
    });

    // The webhook handler re-fetches the charge's real state from Shopify via
    // node(id:) (purchase.ts's defaultFetchPurchase) rather than trusting
    // anything in the delivered payload except the charge id — this stubs
    // that GraphQL call. Never inspects the webhook body itself.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { node: { id: chargeId, status: 'ACTIVE', test: false } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    // Shopify's documented sample shape for app_purchases_one_time/update —
    // the whole resource nested under app_purchase_one_time, not at the
    // payload root, and with no `test` field at all.
    const body = JSON.stringify({
      app_purchase_one_time: {
        admin_graphql_api_id: chargeId,
        name: 'Webhook Test',
        status: 'ACTIVE',
        admin_graphql_api_shop_id: 'gid://shopify/Shop/555111222',
        created_at: '2026-08-19T00:00:00-04:00',
        updated_at: '2026-08-19T00:00:01-04:00',
      },
    });
    const hmac = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('base64');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/webhooks/app_purchases_one_time_update',
      headers: {
        'content-type': 'application/json',
        'x-shopify-hmac-sha256': hmac,
        'x-shopify-shop-domain': webhookStore.shopDomain,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    const [purchaseRow] = await app.db
      .select()
      .from(schema.shopifyCreditPurchases)
      .where(eq(schema.shopifyCreditPurchases.id, purchaseId));
    expect(purchaseRow.status).toBe('ACTIVE');

    const [creditRow] = await app.db
      .select()
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, webhookStore.id));
    expect(creditRow.balance).toBe(4800);
  });
});
