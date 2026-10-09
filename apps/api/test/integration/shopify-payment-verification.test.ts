import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantStore } from '../../src/modules/credits/shopify-ledger.js';
import { PartnerApiError } from '../../src/modules/shopify/partner-api.js';
import { verifyGrantedPurchases } from '../../src/modules/shopify/payment-verification.js';
import { grantForPurchase } from '../../src/modules/shopify/purchase.js';
import { buildTestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

let ctx: Containers;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let store: typeof schema.shopifyStores.$inferSelect;
let devStore: typeof schema.shopifyStores.$inferSelect;
let overflowStore: typeof schema.shopifyStores.$inferSelect;
let seq = 0;

type Row = typeof schema.shopifyCreditPurchases.$inferSelect;

async function makeStore(domain: string, shopId: number, partnerDevelopment = false) {
  const [s] = await app.db
    .insert(schema.shopifyStores)
    .values({
      shopDomain: domain,
      shopifyShopId: shopId,
      accessToken: 'enc:token',
      scope: 'read_products',
      partnerDevelopment,
    })
    .returning();
  return s;
}

async function purchase(
  overrides: Partial<Row> = {},
  forStore: typeof store = store,
): Promise<Row> {
  seq += 1;
  const [row] = await app.db
    .insert(schema.shopifyCreditPurchases)
    .values({
      storeId: forStore.id,
      packId: 'pack_10',
      credits: 800,
      priceUsdCents: 1000,
      status: 'ACTIVE',
      shopifyChargeId: `gid://shopify/AppPurchaseOneTime/${5000 + seq}`,
      paymentStatus: 'NOT_REQUIRED',
      ...overrides,
    })
    .returning();
  return row;
}

async function ledgerFor(row: Row) {
  return app.db
    .select()
    .from(schema.shopifyCreditLedger)
    .where(
      and(
        eq(schema.shopifyCreditLedger.storeId, row.storeId),
        eq(schema.shopifyCreditLedger.externalRef, `shopify_pack:${row.shopifyChargeId}`),
      ),
    );
}

async function reload(row: Row): Promise<Row> {
  const [fresh] = await app.db
    .select()
    .from(schema.shopifyCreditPurchases)
    .where(eq(schema.shopifyCreditPurchases.id, row.id));
  return fresh;
}

const observed = (row: Row, test = false) => ({
  id: row.shopifyChargeId as string,
  status: 'ACTIVE',
  test,
});

/** An app whose env has the given overrides, sharing everything else with the real one. */
function withEnv(overrides: Record<string, unknown>) {
  return Object.assign(Object.create(app), { env: { ...app.env, ...overrides } });
}

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
  store = await makeStore('verify-test.myshopify.com', 600000001);
  devStore = await makeStore('verify-dev.myshopify.com', 600000002, true);
  overflowStore = await makeStore('verify-overflow.myshopify.com', 600000003);
}, 60000);

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('grantForPurchase with SHOPIFY_VERIFY_PAYMENTS', () => {
  it('grants once and marks the purchase UNVERIFIED with the first check 15 minutes out', async () => {
    const row = await purchase();
    const before = Date.now();
    const granted = await grantForPurchase(
      withEnv({ SHOPIFY_VERIFY_PAYMENTS: true }),
      store,
      row,
      observed(row),
    );

    expect(granted).toBe(800);
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('UNVERIFIED');
    expect(fresh.paymentStatusSource).toBe('AUTO');
    const due = fresh.nextPaymentCheckAt?.getTime() ?? 0;
    expect(due).toBeGreaterThanOrEqual(before + 14 * 60_000);
    expect(due).toBeLessThanOrEqual(Date.now() + 16 * 60_000);
    const ledger = await ledgerFor(row);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 800, reason: 'SHOPIFY_PACK' });
  });

  it('a replay grants nothing more and leaves one ledger row', async () => {
    const row = await purchase();
    const verifyApp = withEnv({ SHOPIFY_VERIFY_PAYMENTS: true });
    expect(await grantForPurchase(verifyApp, store, row, observed(row))).toBe(800);
    // Same stale snapshot again (a webhook replay or a confirm revisit).
    expect(await grantForPurchase(verifyApp, store, row, observed(row))).toBe(0);
    expect(await ledgerFor(row)).toHaveLength(1);
    expect((await reload(row)).paymentStatus).toBe('UNVERIFIED');
  });

  it('two concurrent callers grant exactly once', async () => {
    const row = await purchase();
    const verifyApp = withEnv({ SHOPIFY_VERIFY_PAYMENTS: true });
    const results = await Promise.all([
      grantForPurchase(verifyApp, store, row, observed(row)),
      grantForPurchase(verifyApp, store, row, observed(row)),
    ]);
    expect(results.filter((n) => n > 0)).toHaveLength(1);
    expect(await ledgerFor(row)).toHaveLength(1);
  });

  it('still ends UNVERIFIED when the credits were already granted before the flag was on', async () => {
    const row = await purchase();
    await grantStore(app.db, store.id, 800, 'SHOPIFY_PACK', `shopify_pack:${row.shopifyChargeId}`);
    const granted = await grantForPurchase(
      withEnv({ SHOPIFY_VERIFY_PAYMENTS: true }),
      store,
      row,
      observed(row),
    );
    expect(granted).toBe(0); // the ledger entry already existed
    expect((await reload(row)).paymentStatus).toBe('UNVERIFIED');
    expect(await ledgerFor(row)).toHaveLength(1);
  });

  it('leaves a test charge on a development store untracked (it never gets a sale)', async () => {
    const row = await purchase({}, devStore);
    const granted = await grantForPurchase(
      withEnv({ SHOPIFY_VERIFY_PAYMENTS: true }),
      devStore,
      row,
      observed(row, true),
    );
    expect(granted).toBe(800);
    expect((await reload(row)).paymentStatus).toBe('NOT_REQUIRED');
    expect((await ledgerFor(row))[0]).toMatchObject({ reason: 'SHOPIFY_PACK_TEST' });
  });

  it('with the flag off behaves as before: grants and stays NOT_REQUIRED', async () => {
    const row = await purchase();
    expect(await grantForPurchase(app, store, row, observed(row))).toBe(800);
    expect((await reload(row)).paymentStatus).toBe('NOT_REQUIRED');
  });

  it('the hold takes precedence when both flags are on: held, not granted, not verified', async () => {
    const row = await purchase();
    const both = withEnv({ SHOPIFY_VERIFY_PAYMENTS: true, SHOPIFY_HOLD_UNTIL_PAID: true });
    expect(await grantForPurchase(both, store, row, observed(row))).toBe(0);
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
    expect(await ledgerFor(row)).toHaveLength(0);
  });

  it('rolls the UNVERIFIED mark back when the grant fails (one transaction)', async () => {
    // A balance at the 32-bit maximum makes the credit upsert overflow inside the grant.
    await app.db
      .insert(schema.shopifyStoreCredits)
      .values({ storeId: overflowStore.id, balance: 2147483647 });
    const row = await purchase({}, overflowStore);
    await expect(
      grantForPurchase(
        withEnv({ SHOPIFY_VERIFY_PAYMENTS: true }),
        overflowStore,
        row,
        observed(row),
      ),
    ).rejects.toThrow();
    expect((await reload(row)).paymentStatus).toBe('NOT_REQUIRED');
    expect(await ledgerFor(row)).toHaveLength(0);
  });
});

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** A granted purchase waiting for confirmation. Charge ids are unique per call. */
async function unverified(overrides: Partial<Row> = {}): Promise<Row> {
  return purchase({
    paymentStatus: 'UNVERIFIED',
    nextPaymentCheckAt: new Date(Date.now() - MIN_MS),
    ...overrides,
  });
}

const saleFor =
  (row: Row, paidAt = new Date('2026-10-09T06:39:29Z')) =>
  async () =>
    new Map([[(row.shopifyChargeId as string).split('/').pop() as string, { paidAt }]]);
const noSales = async () => new Map();

describe('verifyGrantedPurchases', () => {
  it('a sale marks the purchase PAID with the sale time and never grants again', async () => {
    const row = await unverified();
    await verifyGrantedPurchases(app, [row], { fetchSales: saleFor(row) });

    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('PAID');
    expect(fresh.paidAt?.toISOString()).toBe('2026-10-09T06:39:29.000Z');
    expect(fresh.nextPaymentCheckAt).toBeNull();
    expect(await ledgerFor(row)).toHaveLength(0); // credits were given at approval, not here
  });

  it('a sale also rescues a NOT_RECEIVED purchase', async () => {
    const row = await unverified({ paymentStatus: 'NOT_RECEIVED' });
    await verifyGrantedPurchases(app, [row], { fetchSales: saleFor(row) });
    expect((await reload(row)).paymentStatus).toBe('PAID');
  });

  it('no sale inside the window keeps it UNVERIFIED and re-checks in 15 minutes', async () => {
    const row = await unverified({ createdAt: new Date() });
    const now = new Date();
    await verifyGrantedPurchases(app, [row], { fetchSales: noSales, now });
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('UNVERIFIED');
    expect(fresh.nextPaymentCheckAt?.getTime()).toBe(now.getTime() + 15 * MIN_MS);
  });

  it('no sale once the window has passed marks it NOT_RECEIVED and re-checks tomorrow', async () => {
    const row = await unverified({ createdAt: new Date(Date.now() - 4 * HOUR_MS) });
    const now = new Date();
    await verifyGrantedPurchases(app, [row], { fetchSales: noSales, now });
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('NOT_RECEIVED');
    expect(fresh.nextPaymentCheckAt?.getTime()).toBe(now.getTime() + DAY_MS);
    expect(await ledgerFor(row)).toHaveLength(0);
  });

  it('stops re-checking a NOT_RECEIVED purchase after 30 days', async () => {
    const row = await unverified({
      paymentStatus: 'NOT_RECEIVED',
      createdAt: new Date(Date.now() - 31 * DAY_MS),
    });
    await verifyGrantedPurchases(app, [row], { fetchSales: noSales });
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('NOT_RECEIVED');
    expect(fresh.nextPaymentCheckAt).toBeNull();
  });

  it('fails closed: a Partner API failure changes nothing, even for a past-window row', async () => {
    const row = await unverified({ createdAt: new Date(Date.now() - 5 * HOUR_MS) });
    const before = await reload(row);
    await expect(
      verifyGrantedPurchases(app, [row], {
        fetchSales: async () => {
          throw new PartnerApiError('http', 'down');
        },
      }),
    ).rejects.toBeInstanceOf(PartnerApiError);

    const after = await reload(row);
    expect(after.paymentStatus).toBe('UNVERIFIED'); // NOT marked NOT_RECEIVED
    expect(after.nextPaymentCheckAt?.getTime()).toBe(before.nextPaymentCheckAt?.getTime());
  });

  it('leaves an admin override alone even when a sale exists', async () => {
    const row = await unverified({ paymentStatus: 'NOT_RECEIVED', paymentStatusSource: 'MANUAL' });
    await verifyGrantedPurchases(app, [row], { fetchSales: saleFor(row) });
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('NOT_RECEIVED');
    expect(fresh.paymentStatusSource).toBe('MANUAL');
    expect(fresh.paidAt).toBeNull();
  });

  it('never touches a held (hold-until-paid) row', async () => {
    const row = await purchase({
      paymentStatus: 'AWAITING',
      nextPaymentCheckAt: new Date(Date.now() - MIN_MS),
    });
    await verifyGrantedPurchases(app, [row], { fetchSales: saleFor(row) });
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
  });
});
