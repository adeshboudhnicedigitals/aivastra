import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runUsageReportTick } from '../../src/modules/shopify/usage-scheduler.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('runUsageReportTick', () => {
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
  beforeEach(async () => {
    await app.db.delete(schema.shopifyUsageEvents);
    await app.db.delete(schema.jobs);
    await app.db.delete(schema.shopifyStores);
  });

  async function seedPendingRow() {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `usage-tick-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now() + Math.floor(Math.random() * 100000),
        accessToken: 'enc',
        scope: 'read_products',
        billingMode: 'usage',
      })
      .returning();
    const [job] = await (app.db.insert(schema.jobs).values as never)({
      shopifyStoreId: store?.id,
      customerPhotoKey: 'x',
      status: 'COMPLETED',
      creditsCharged: 0,
    }).returning();
    const [row] = await app.db
      .insert(schema.shopifyUsageEvents)
      .values({ storeId: store?.id as string, jobId: job?.id as string, priceUsdCents: 10 })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: destructured arrays from .returning() are always populated
    return { store: store!, row: row! };
  }

  it('marks a row REPORTED when the report call succeeds', async () => {
    const { row } = await seedPendingRow();
    await runUsageReportTick(app, { report: async () => 'reported' });
    const [updated] = await app.db
      .select()
      .from(schema.shopifyUsageEvents)
      .where(eq(schema.shopifyUsageEvents.id, row.id));
    expect(updated?.status).toBe('REPORTED');
    expect(updated?.reportedAt).not.toBeNull();
  });

  it('leaves a row PENDING when the report call fails', async () => {
    const { row } = await seedPendingRow();
    await runUsageReportTick(app, { report: async () => 'failed' });
    const [updated] = await app.db
      .select()
      .from(schema.shopifyUsageEvents)
      .where(eq(schema.shopifyUsageEvents.id, row.id));
    expect(updated?.status).toBe('PENDING');
  });

  it('does not report rows for a test subscription when the allow-test gate is off', async () => {
    const { row, store } = await seedPendingRow();
    await app.db
      .update(schema.shopifyStores)
      .set({ subscriptionIsTest: true })
      .where(eq(schema.shopifyStores.id, store.id));
    const report = vi.fn(async () => 'reported' as const);
    await runUsageReportTick(app, { report });
    expect(report).not.toHaveBeenCalled();
    const [updated] = await app.db
      .select()
      .from(schema.shopifyUsageEvents)
      .where(eq(schema.shopifyUsageEvents.id, row.id));
    expect(updated?.status).toBe('PENDING');
  });
});
