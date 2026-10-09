import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PartnerApiError } from '../../src/modules/shopify/partner-api.js';
import { checkPurchases, settlePaid } from '../../src/modules/shopify/payment-settlement.js';
import { buildTestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

let ctx: Containers;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let store: typeof schema.shopifyStores.$inferSelect;
let seq = 0;

type Row = typeof schema.shopifyCreditPurchases.$inferSelect;

async function awaitingPurchase(overrides: Partial<Row> = {}): Promise<Row> {
  seq += 1;
  const [row] = await app.db
    .insert(schema.shopifyCreditPurchases)
    .values({
      storeId: store.id,
      packId: 'pack_10',
      credits: 800,
      priceUsdCents: 1000,
      status: 'ACTIVE',
      shopifyChargeId: `gid://shopify/AppPurchaseOneTime/${9000 + seq}`,
      paymentStatus: 'AWAITING',
      nextPaymentCheckAt: new Date(),
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
        eq(schema.shopifyCreditLedger.storeId, store.id),
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

const saleFor =
  (row: Row, paidAt = new Date('2026-10-09T06:39:29Z')) =>
  async () =>
    new Map([[(row.shopifyChargeId as string).split('/').pop() as string, { paidAt }]]);
const noSales = async () => new Map();

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
  [store] = await app.db
    .insert(schema.shopifyStores)
    .values({
      shopDomain: 'settle-test.myshopify.com',
      shopifyShopId: 555000111,
      accessToken: 'enc:token',
      scope: 'read_products',
    })
    .returning();
}, 60000);

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('payment settlement', () => {
  it('a matching sale marks PAID, sets paid_at and grants exactly once', async () => {
    const row = await awaitingPurchase();
    const result = await checkPurchases(app, [row], { fetchSales: saleFor(row) });

    expect(result.get(row.id)).toBe('PAID');
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('PAID');
    expect(fresh.paidAt?.toISOString()).toBe('2026-10-09T06:39:29.000Z');
    expect(fresh.nextPaymentCheckAt).toBeNull();
    const ledger = await ledgerFor(row);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 800, reason: 'SHOPIFY_PACK' });
  });

  it('two concurrent settlements grant once', async () => {
    const row = await awaitingPurchase();
    const results = await Promise.all([
      settlePaid(app.db, row, new Date()),
      settlePaid(app.db, row, new Date()),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await ledgerFor(row)).toHaveLength(1);
  });

  it('no sale reschedules a young purchase and grants nothing', async () => {
    const row = await awaitingPurchase();
    const now = new Date(row.createdAt.getTime() + 60_000);
    const result = await checkPurchases(app, [row], { fetchSales: noSales, now });

    expect(result.get(row.id)).toBe('AWAITING');
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('AWAITING');
    expect(fresh.nextPaymentCheckAt?.getTime()).toBe(now.getTime() + 60_000);
    expect(await ledgerFor(row)).toHaveLength(0);
  });

  it('no sale after 30 days parks the purchase as UNPAID', async () => {
    const row = await awaitingPurchase({ createdAt: new Date(Date.now() - 31 * 86_400_000) });
    const result = await checkPurchases(app, [row], { fetchSales: noSales });

    expect(result.get(row.id)).toBe('UNPAID');
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('UNPAID');
    expect(fresh.nextPaymentCheckAt).toBeNull();
  });

  it('a parked UNPAID purchase still settles when a sale appears later', async () => {
    const row = await awaitingPurchase({ paymentStatus: 'UNPAID', nextPaymentCheckAt: null });
    await checkPurchases(app, [row], { fetchSales: saleFor(row) });
    expect((await reload(row)).paymentStatus).toBe('PAID');
    expect(await ledgerFor(row)).toHaveLength(1);
  });

  it('a Partner API failure leaves the row untouched (fail closed) and rethrows', async () => {
    const row = await awaitingPurchase({ createdAt: new Date(Date.now() - 31 * 86_400_000) });
    const before = await reload(row);
    await expect(
      checkPurchases(app, [row], {
        fetchSales: async () => {
          throw new PartnerApiError('http', 'down');
        },
      }),
    ).rejects.toBeInstanceOf(PartnerApiError);

    const after = await reload(row);
    expect(after.paymentStatus).toBe('AWAITING'); // not parked despite age
    expect(after.nextPaymentCheckAt?.getTime()).toBe(before.nextPaymentCheckAt?.getTime());
    expect(await ledgerFor(row)).toHaveLength(0);
  });

  it('missing Partner config fails closed', async () => {
    // buildTestApp sets no SHOPIFY_PARTNER_*, so the real client throws missing_config.
    const row = await awaitingPurchase();
    await expect(checkPurchases(app, [row])).rejects.toMatchObject({ reason: 'missing_config' });
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
  });
});
