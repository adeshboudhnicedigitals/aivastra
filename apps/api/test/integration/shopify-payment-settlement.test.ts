import { schema } from '@aivastra/db';
import { register } from '@aivastra/observability';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PartnerApiError } from '../../src/modules/shopify/partner-api.js';
import { checkPurchases, settlePaid } from '../../src/modules/shopify/payment-settlement.js';
import { runPaymentSettlementTick } from '../../src/modules/shopify/payment-settlement-scheduler.js';
import { grantForPurchase } from '../../src/modules/shopify/purchase.js';
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

async function awaitingRowCount(): Promise<number> {
  const [{ n }] = await app.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.shopifyCreditPurchases)
    .where(eq(schema.shopifyCreditPurchases.paymentStatus, 'AWAITING'));
  return n;
}

async function awaitingGauge(): Promise<number | undefined> {
  const metric = await register.getSingleMetric('shopify_purchases_awaiting_payment')?.get();
  return metric?.values[0]?.value;
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

describe('grantForPurchase with SHOPIFY_HOLD_UNTIL_PAID', () => {
  const active = (row: Row, test = false) => ({
    id: row.shopifyChargeId as string,
    status: 'ACTIVE',
    test,
  });

  async function freshRow(): Promise<Row> {
    return awaitingPurchase({ paymentStatus: 'NOT_REQUIRED', nextPaymentCheckAt: null });
  }

  it('flag on: a real ACTIVE charge becomes AWAITING and grants nothing', async () => {
    const holdApp = Object.assign(Object.create(app), {
      env: { ...app.env, SHOPIFY_HOLD_UNTIL_PAID: true },
    });
    const row = await freshRow();
    const granted = await grantForPurchase(holdApp, store, row, active(row));

    expect(granted).toBe(0);
    const fresh = await reload(row);
    expect(fresh.paymentStatus).toBe('AWAITING');
    expect(fresh.nextPaymentCheckAt).not.toBeNull();
    expect(await ledgerFor(row)).toHaveLength(0);
  });

  it('flag on: a replay on an already-PAID row is a no-op', async () => {
    const holdApp = Object.assign(Object.create(app), {
      env: { ...app.env, SHOPIFY_HOLD_UNTIL_PAID: true },
    });
    const row = await awaitingPurchase({ paymentStatus: 'PAID', nextPaymentCheckAt: null });
    expect(await grantForPurchase(holdApp, store, row, active(row))).toBe(0);
    expect((await reload(row)).paymentStatus).toBe('PAID');
  });

  it('flag on: a row already granted before the flag stays NOT_REQUIRED', async () => {
    const row = await freshRow();
    // Granted under the old behaviour (flag off) first…
    expect(await grantForPurchase(app, store, row, active(row))).toBe(800);
    const holdApp = Object.assign(Object.create(app), {
      env: { ...app.env, SHOPIFY_HOLD_UNTIL_PAID: true },
    });
    // …then a confirm revisit after the flag flipped must not pull it into AWAITING.
    expect(await grantForPurchase(holdApp, store, row, active(row))).toBe(0);
    expect((await reload(row)).paymentStatus).toBe('NOT_REQUIRED');
  });

  it('flag off: behaviour is unchanged — grants on ACTIVE', async () => {
    const row = await freshRow();
    expect(await grantForPurchase(app, store, row, active(row))).toBe(800);
    expect((await reload(row)).paymentStatus).toBe('NOT_REQUIRED');
  });

  it('flag off (rollback): a row already AWAITING is never granted on ACTIVE', async () => {
    const row = await awaitingPurchase();
    expect(await grantForPurchase(app, store, row, active(row))).toBe(0);
    expect(await ledgerFor(row)).toHaveLength(0);
    expect((await reload(row)).paymentStatus).toBe('AWAITING');
  });
});

describe('payment settlement tick', () => {
  it('settles due AWAITING rows and skips ones not yet due', async () => {
    const due = await awaitingPurchase({ nextPaymentCheckAt: new Date(Date.now() - 1000) });
    const later = await awaitingPurchase({ nextPaymentCheckAt: new Date(Date.now() + 3_600_000) });
    const sales = new Map(
      [due, later].map((r) => [
        (r.shopifyChargeId as string).split('/').pop() as string,
        { paidAt: new Date() },
      ]),
    );

    await runPaymentSettlementTick(app, { fetchSales: async () => sales });

    expect((await reload(due)).paymentStatus).toBe('PAID');
    expect((await reload(later)).paymentStatus).toBe('AWAITING');
    expect(await awaitingGauge()).toBe(await awaitingRowCount());
  });

  it('a Partner API outage fails closed: no grant, no park, schedule untouched', async () => {
    const dueAt = new Date(Date.now() - 60_000);
    // Older than 31 days, so an implementation that parks on failure would visibly flip to UNPAID.
    const row = await awaitingPurchase({
      nextPaymentCheckAt: dueAt,
      createdAt: new Date(Date.now() - 31 * 86_400_000),
    });
    const logError = vi.spyOn(app.log, 'error').mockImplementation(() => undefined);
    try {
      await expect(
        runPaymentSettlementTick(app, {
          fetchSales: async () => {
            throw new PartnerApiError('http', 'down');
          },
        }),
      ).resolves.toBeUndefined();

      const fresh = await reload(row);
      expect(fresh.paymentStatus).toBe('AWAITING');
      expect(fresh.nextPaymentCheckAt?.getTime()).toBe(dueAt.getTime());
      expect(await ledgerFor(row)).toHaveLength(0);

      expect(logError).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(PartnerApiError) }),
        'payment settlement check failed — purchases stay pending',
      );
      expect(await awaitingGauge()).toBe(await awaitingRowCount());
    } finally {
      logError.mockRestore();
      // Move the still-due row out of the window so later tests are unaffected.
      await app.db
        .update(schema.shopifyCreditPurchases)
        .set({ nextPaymentCheckAt: new Date('2099-01-01T00:00:00Z') })
        .where(eq(schema.shopifyCreditPurchases.id, row.id));
    }
  });
});
