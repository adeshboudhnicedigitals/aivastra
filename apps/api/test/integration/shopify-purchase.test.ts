import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  app = await buildTestApp(ctx, { SHOPIFY_APP_URL: 'https://app.aivastra.test' });
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
