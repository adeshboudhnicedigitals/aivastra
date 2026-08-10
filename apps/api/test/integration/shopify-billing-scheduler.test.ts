import { schema } from '@aivastra/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBillingSyncTick } from '../../src/modules/shopify/billing-scheduler.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('runBillingSyncTick', () => {
  let c: Containers;
  let app: TestApp;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  // Both tests below assert an exact set/count of stores that runBillingSyncTick
  // touches — this file's Postgres DB is fresh per describe (containers.ts),
  // not per `it`, so a store seeded (and left installed) by one test would
  // otherwise still be picked up by the next test's blanket "every installed
  // store" query.
  beforeEach(async () => {
    await app.db.delete(schema.shopifyStores);
  });

  async function seedStore(overrides: Partial<typeof schema.shopifyStores.$inferInsert> = {}) {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `test-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now() + Math.floor(Math.random() * 1000),
        accessToken: 'enc',
        scope: 'read_products',
        ...overrides,
      })
      .returning();
    return store!;
  }

  it('syncs every installed store and skips uninstalled ones', async () => {
    const active = await seedStore();
    const uninstalled = await seedStore({ uninstalledAt: new Date() });

    const sync = vi.fn(async () => ({
      planHandle: 'starter',
      subscriptionStatus: 'active',
      creditsGranted: 0,
    }));

    await runBillingSyncTick(app, { sync, sleepImpl: async () => {} });

    const syncedIds = sync.mock.calls.map((call) => (call[2] as { id: string }).id);
    expect(syncedIds).toContain(active.id);
    expect(syncedIds).not.toContain(uninstalled.id);
  });

  it('continues past a single store failing to sync', async () => {
    const first = await seedStore();
    const second = await seedStore();
    let calls = 0;
    const sync = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('partner api down');
      return { planHandle: null, subscriptionStatus: 'cancelled', creditsGranted: 0 };
    });

    await expect(
      runBillingSyncTick(app, { sync, sleepImpl: async () => {} }),
    ).resolves.not.toThrow();
    expect(sync).toHaveBeenCalledTimes(2);
    void first;
    void second;
  });
});
