import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  reconcileStalePurchase,
  runReconcileTick,
} from '../../src/modules/shopify/autorefill-reconciler.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// A stranded PENDING autorefill row blocks every future refill for its store
// via shopify_credit_purchases_one_pending_autorefill. These cover the sweep
// that unblocks it.
describe('auto-refill reconciliation of stranded PENDING purchases', () => {
  let c: Containers;
  let app: TestApp;

  // Older than STALE_AFTER_MS (10m) so the tick's cutoff selects it.
  const STALE = new Date(Date.now() - 30 * 60 * 1000);

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  async function seedStrandedRow(opts: { lineItem: string | null; balance?: number }) {
    const nonce = crypto.randomUUID();
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `recon-${nonce}.myshopify.com`,
        shopifyShopId: Math.floor(Math.random() * 1_000_000_000),
        accessToken: 'iv:tag:enc',
        scope: 'read_products',
        autorefillStatus: 'ACTIVE',
        autorefillLineItemId: opts.lineItem,
        autorefillSubscriptionId: opts.lineItem ? `gid://Sub/${nonce}` : null,
      })
      .returning();
    await app.db
      .insert(schema.shopifyStoreCredits)
      .values({ storeId: store.id, balance: opts.balance ?? 0 });

    const [purchase] = await app.db
      .insert(schema.shopifyCreditPurchases)
      .values({
        storeId: store.id,
        source: 'autorefill',
        packId: 'pack-medium',
        credits: 100,
        priceUsdCents: 2500,
        status: 'PENDING',
        createdAt: STALE,
        updatedAt: STALE,
      })
      .returning();

    return { store, purchase };
  }

  const balanceOf = (storeId: string) =>
    app.db
      .select({ balance: schema.shopifyStoreCredits.balance })
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, storeId))
      .then(([r]) => r?.balance);

  const purchaseStatus = (id: string) =>
    app.db
      .select({ status: schema.shopifyCreditPurchases.status })
      .from(schema.shopifyCreditPurchases)
      .where(eq(schema.shopifyCreditPurchases.id, id))
      .then(([r]) => r?.status);

  it('replays under the original idempotency key and grants the credits', async () => {
    const { store, purchase } = await seedStrandedRow({ lineItem: 'gid://LineItem/1' });
    const seen: Array<{ idempotencyKey: string; amountUsd: number }> = [];

    const outcome = await reconcileStalePurchase(app, store, purchase, {
      charge: async (_app, _store, args) => {
        seen.push({ idempotencyKey: args.idempotencyKey, amountUsd: args.amountUsd });
        return { ok: true, recordId: 'gid://Record/abc' };
      },
    });

    expect(outcome).toBe('resolved_active');
    // The key must be the row's own, or Shopify would treat the replay as a
    // brand-new charge and bill the merchant twice.
    expect(seen).toEqual([{ idempotencyKey: `autorefill:${purchase.id}`, amountUsd: 25 }]);
    expect(await purchaseStatus(purchase.id)).toBe('ACTIVE');
    expect(await balanceOf(store.id)).toBe(100);

    const [row] = await app.db
      .select()
      .from(schema.shopifyCreditPurchases)
      .where(eq(schema.shopifyCreditPurchases.id, purchase.id));
    expect(row?.shopifyChargeId).toBe('gid://Record/abc');
  });

  it('grants only once when the same row is swept twice', async () => {
    const { store, purchase } = await seedStrandedRow({ lineItem: 'gid://LineItem/2' });
    const charge = async () => ({ ok: true as const, recordId: 'gid://Record/dup' });

    await reconcileStalePurchase(app, store, purchase, { charge });
    // Force it back to PENDING so the second pass is decided by the ledger's
    // external_ref guard, not merely by the status re-read.
    await app.db
      .update(schema.shopifyCreditPurchases)
      .set({ status: 'PENDING' })
      .where(eq(schema.shopifyCreditPurchases.id, purchase.id));
    await reconcileStalePurchase(app, store, purchase, { charge });

    expect(await balanceOf(store.id)).toBe(100);
    const ledger = await app.db
      .select()
      .from(schema.shopifyCreditLedger)
      .where(
        and(
          eq(schema.shopifyCreditLedger.storeId, store.id),
          eq(schema.shopifyCreditLedger.externalRef, 'shopify_autorefill:gid://Record/dup'),
        ),
      );
    expect(ledger).toHaveLength(1);
  });

  it('marks FAILED when Shopify rejects the replayed charge', async () => {
    const { store, purchase } = await seedStrandedRow({ lineItem: 'gid://LineItem/3' });

    const outcome = await reconcileStalePurchase(app, store, purchase, {
      charge: async () => ({ ok: false, capReached: false, message: 'line item not found' }),
    });

    expect(outcome).toBe('resolved_failed');
    expect(await purchaseStatus(purchase.id)).toBe('FAILED');
    expect(await balanceOf(store.id)).toBe(0);
  });

  it('records CAP_REACHED on the store when the ceiling is hit', async () => {
    const { store, purchase } = await seedStrandedRow({ lineItem: 'gid://LineItem/4' });

    const outcome = await reconcileStalePurchase(app, store, purchase, {
      charge: async () => ({ ok: false, capReached: true, message: 'capped' }),
    });

    expect(outcome).toBe('cap_reached');
    expect(await purchaseStatus(purchase.id)).toBe('FAILED');
    const [s] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(s?.autorefillStatus).toBe('CAP_REACHED');
  });

  it('leaves the row PENDING when the replay throws, for the next sweep', async () => {
    const { store, purchase } = await seedStrandedRow({ lineItem: 'gid://LineItem/5' });

    const outcome = await reconcileStalePurchase(app, store, purchase, {
      charge: async () => {
        throw new Error('ETIMEDOUT');
      },
    });

    expect(outcome).toBe('retry_later');
    expect(await purchaseStatus(purchase.id)).toBe('PENDING');
    expect(await balanceOf(store.id)).toBe(0);
  });

  it('never charges a store whose subscription is gone, and leaves it PENDING', async () => {
    const { store, purchase } = await seedStrandedRow({ lineItem: null });
    let charged = false;

    const outcome = await reconcileStalePurchase(app, store, purchase, {
      charge: async () => {
        charged = true;
        return { ok: true as const, recordId: 'gid://Record/never' };
      },
    });

    expect(outcome).toBe('unverifiable');
    expect(charged).toBe(false);
    // Deliberately not FAILED: we cannot tell whether the merchant was billed,
    // so this stays visible rather than being written off.
    expect(await purchaseStatus(purchase.id)).toBe('PENDING');
    expect(await balanceOf(store.id)).toBe(0);
  });

  it('does not touch a row that is already settled', async () => {
    const { store, purchase } = await seedStrandedRow({ lineItem: 'gid://LineItem/6' });
    await app.db
      .update(schema.shopifyCreditPurchases)
      .set({ status: 'ACTIVE' })
      .where(eq(schema.shopifyCreditPurchases.id, purchase.id));

    let charged = false;
    const outcome = await reconcileStalePurchase(app, store, purchase, {
      charge: async () => {
        charged = true;
        return { ok: true as const, recordId: 'gid://Record/no' };
      },
    });

    expect(outcome).toBe('skipped');
    expect(charged).toBe(false);
    expect(await balanceOf(store.id)).toBe(0);
  });

  it('the sweep skips rows younger than the staleness cutoff', async () => {
    const { store, purchase } = await seedStrandedRow({ lineItem: 'gid://LineItem/7' });
    await app.db
      .update(schema.shopifyCreditPurchases)
      .set({ updatedAt: new Date() })
      .where(eq(schema.shopifyCreditPurchases.id, purchase.id));

    await runReconcileTick(app, {
      charge: async () => ({ ok: true as const, recordId: 'gid://Record/fresh' }),
    });

    expect(await purchaseStatus(purchase.id)).toBe('PENDING');
    expect(await balanceOf(store.id)).toBe(0);
  });

  // The whole point of the sweep: the partial unique index
  // (store_id) WHERE status='PENDING' AND source='autorefill' rejects a second
  // in-flight row, so while one is stranded the store can never refill again.
  it('unblocks the next refill insert that the stranded row was rejecting', async () => {
    const { store, purchase } = await seedStrandedRow({ lineItem: 'gid://LineItem/9' });

    const insertNextRefill = () =>
      app.db
        .insert(schema.shopifyCreditPurchases)
        .values({
          storeId: store.id,
          source: 'autorefill',
          packId: 'pack-medium',
          credits: 100,
          priceUsdCents: 2500,
          status: 'PENDING',
        })
        .onConflictDoNothing()
        .returning({ id: schema.shopifyCreditPurchases.id });

    // Before: exactly the silent no-op runRefill hits — the insert is
    // swallowed by the index and the refill is skipped.
    expect(await insertNextRefill()).toHaveLength(0);

    await reconcileStalePurchase(app, store, purchase, {
      charge: async () => ({ ok: true as const, recordId: 'gid://Record/unblock' }),
    });

    expect(await insertNextRefill()).toHaveLength(1);
  });

  it('the sweep resolves a stale row end to end', async () => {
    const { store, purchase } = await seedStrandedRow({ lineItem: 'gid://LineItem/8' });

    await runReconcileTick(app, {
      charge: async () => ({ ok: true as const, recordId: `gid://Record/${purchase.id}` }),
    });

    expect(await purchaseStatus(purchase.id)).toBe('ACTIVE');
    expect(await balanceOf(store.id)).toBe(100);
  });
});
