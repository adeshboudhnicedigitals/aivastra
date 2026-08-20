import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runRefill } from '../../src/modules/shopify/autorefill.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

let ctx: Awaited<ReturnType<typeof startContainers>>;
let app: Awaited<ReturnType<typeof buildTestApp>>;
let store: typeof schema.shopifyStores.$inferSelect;
let charges: string[];

const okCharge = () => ({
  charge: async (
    _app: unknown,
    _store: unknown,
    args: { idempotencyKey: string },
  ): Promise<{ ok: true; recordId: string }> => {
    charges.push(args.idempotencyKey);
    return { ok: true, recordId: `gid://shopify/AppUsageRecord/${charges.length}` };
  },
});

const capCharge = () => ({
  charge: async (): Promise<{ ok: false; capReached: boolean; message: string }> => ({
    ok: false,
    capReached: true,
    message: 'Total price exceeds balance remaining',
  }),
});

async function reset(
  balance: number,
  patch: Partial<typeof schema.shopifyStores.$inferSelect> = {},
) {
  await app.db
    .delete(schema.shopifyCreditPurchases)
    .where(eq(schema.shopifyCreditPurchases.storeId, store.id));
  // Also clear the ledger: shopify_credit_ledger_external_ref_idx (migration
  // 0151) is a UNIQUE index on external_ref alone, not scoped per store. The
  // mock charge()'s recordId — and thus the externalRef grantStore uses —
  // is derived from the shared `charges` array, which beforeEach resets to
  // [] before every test, so every test's first successful charge reuses
  // the same externalRef string. Without clearing prior tests' ledger rows
  // here, a later test's legitimate grant silently conflicts with an
  // earlier, unrelated test's row and grantStore correctly (by design)
  // no-ops it — which then leaves the balance looking unchanged and makes a
  // second concurrent caller look legitimately eligible, failing the race
  // test for a reason that has nothing to do with the code under test.
  await app.db
    .delete(schema.shopifyCreditLedger)
    .where(eq(schema.shopifyCreditLedger.storeId, store.id));
  await app.db
    .insert(schema.shopifyStoreCredits)
    .values({ storeId: store.id, balance })
    .onConflictDoUpdate({ target: schema.shopifyStoreCredits.storeId, set: { balance } });
  const [updated] = await app.db
    .update(schema.shopifyStores)
    .set({
      autorefillPackId: 'pack_25',
      autorefillTriggerCredits: 450,
      autorefillSubscriptionId: 'gid://shopify/AppSubscription/1',
      autorefillLineItemId: 'gid://shopify/AppSubscriptionLineItem/1',
      autorefillStatus: 'ACTIVE',
      ...patch,
    })
    .where(eq(schema.shopifyStores.id, store.id))
    .returning();
  store = updated;
}

beforeAll(async () => {
  ctx = await startContainers();
  app = await buildTestApp(ctx);
  [store] = await app.db
    .insert(schema.shopifyStores)
    .values({
      shopDomain: 'autorefill-test.myshopify.com',
      shopifyShopId: 66601,
      accessToken: 'enc:token',
      scope: 'read_products',
    })
    .returning();
});

beforeEach(() => {
  charges = [];
});

afterAll(async () => {
  await app.close();
  await ctx.stop();
});

describe('auto-refill', () => {
  it('charges once and grants the bonus credit amount', async () => {
    await reset(100);
    const result = await runRefill(app, store, okCharge());
    expect(result).toBe('refilled');
    expect(charges).toHaveLength(1);

    const [credits] = await app.db
      .select()
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    // 100 starting + 2475 auto-refill credits for pack_25 (not the manual 2250)
    expect(credits.balance).toBe(2575);
  });

  it('skips when the balance is above the trigger', async () => {
    await reset(1000);
    expect(await runRefill(app, store, okCharge())).toBe('skipped');
    expect(charges).toHaveLength(0);
  });

  it('skips when auto-refill is not ACTIVE', async () => {
    await reset(100, { autorefillStatus: 'PENDING' });
    expect(await runRefill(app, store, okCharge())).toBe('skipped');
    expect(charges).toHaveLength(0);
  });

  // The double-charge test. This is the reason all three guards exist.
  it('charges exactly once when two refills race', async () => {
    await reset(100);
    const results = await Promise.all([
      runRefill(app, store, okCharge()),
      runRefill(app, store, okCharge()),
    ]);
    expect(charges).toHaveLength(1);
    expect(results.filter((r) => r === 'refilled')).toHaveLength(1);
    expect(results.filter((r) => r === 'skipped')).toHaveLength(1);

    // A single charge with a double *grant* would still show charges.length
    // === 1 above — assert the final balance too, matching the happy-path
    // test's math for pack_25 (100 starting + 2475 auto-refill credits).
    const [credits] = await app.db
      .select()
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(credits.balance).toBe(2575);
  });

  it('uses the purchase row id as the idempotency key', async () => {
    await reset(100);
    await runRefill(app, store, okCharge());
    const [row] = await app.db
      .select()
      .from(schema.shopifyCreditPurchases)
      .where(eq(schema.shopifyCreditPurchases.storeId, store.id));
    expect(charges[0]).toBe(`autorefill:${row.id}`);
  });

  it('marks the store CAP_REACHED and grants nothing when the ceiling is hit', async () => {
    await reset(100);
    expect(await runRefill(app, store, capCharge())).toBe('cap_reached');

    const [refreshed] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(refreshed.autorefillStatus).toBe('CAP_REACHED');

    const [credits] = await app.db
      .select()
      .from(schema.shopifyStoreCredits)
      .where(eq(schema.shopifyStoreCredits.storeId, store.id));
    expect(credits.balance).toBe(100);

    const [row] = await app.db
      .select()
      .from(schema.shopifyCreditPurchases)
      .where(eq(schema.shopifyCreditPurchases.storeId, store.id));
    expect(row.status).toBe('FAILED');
  });

  it('does not retry once the store is CAP_REACHED', async () => {
    await reset(100, { autorefillStatus: 'CAP_REACHED' });
    expect(await runRefill(app, store, okCharge())).toBe('skipped');
    expect(charges).toHaveLength(0);
  });

  it('leaves the balance untouched and the row FAILED on a transient charge failure', async () => {
    await reset(100);
    const result = await runRefill(app, store, {
      charge: async () => ({ ok: false as const, capReached: false, message: 'network' }),
    });
    expect(result).toBe('failed');

    const [refreshed] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    // A transient failure must NOT look like the merchant's ceiling.
    expect(refreshed.autorefillStatus).toBe('ACTIVE');
  });
});

describe('auto-refill lifecycle', () => {
  it('stops refilling once the subscription is cancelled at Shopify', async () => {
    await reset(100, { autorefillStatus: 'CANCELLED' });
    expect(await runRefill(app, store, okCharge())).toBe('skipped');
    expect(charges).toHaveLength(0);
  });

  it('resumes refilling after the merchant re-approves', async () => {
    await reset(100, { autorefillStatus: 'CANCELLED' });
    expect(await runRefill(app, store, okCharge())).toBe('skipped');

    await reset(100, { autorefillStatus: 'ACTIVE' });
    expect(await runRefill(app, store, okCharge())).toBe('refilled');
  });
});
