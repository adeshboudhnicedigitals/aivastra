import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runShopifyRetention } from '../../../dispatcher/src/shopify/retention.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

describe('shopify retention sweeper', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx);
  });
  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  async function seedStoreWithRetention(retention: Record<string, unknown>) {
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `ret-${Date.now()}-${Math.random()}.myshopify.com`,
        shopifyShopId: Date.now() + Math.floor(Math.random() * 1000),
        accessToken: 'enc',
        scope: 'read_products',
        settings: { retention },
      })
      .returning();
    return store;
  }

  it('deletes an expired shopper photo but keeps the billing row', async () => {
    const store = await seedStoreWithRetention({ shopperPhotoDays: 7 });
    const key = `shopify-inputs/${store.id}/old/photo`;
    await app.storage.putObject(key, Buffer.from('x'), 'image/jpeg');

    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        status: 'COMPLETED',
        shopifyStoreId: store.id,
        customerPhotoKey: key,
        creditsCharged: 1,
        source: 'shopify',
        createdAt: daysAgo(30),
      })
      .returning();

    await runShopifyRetention(app.db, app.storage, app.log);

    const [after] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(after).toBeDefined();
    expect(after.creditsCharged).toBe(1);
    expect(after.customerPhotoKey).toBeNull();
    await expect(app.storage.headObject(key)).rejects.toThrow();
  });

  it('leaves everything alone when the merchant configured no retention', async () => {
    const store = await seedStoreWithRetention({});
    const key = `shopify-inputs/${store.id}/keep/photo`;
    await app.storage.putObject(key, Buffer.from('x'), 'image/jpeg');
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        status: 'COMPLETED',
        shopifyStoreId: store.id,
        customerPhotoKey: key,
        creditsCharged: 1,
        source: 'shopify',
        createdAt: daysAgo(400),
      })
      .returning();

    await runShopifyRetention(app.db, app.storage, app.log);

    const [after] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(after.customerPhotoKey).toBe(key);
  });

  it('deletes expired shopper records and nulls the job link without deleting the job', async () => {
    const store = await seedStoreWithRetention({ shopperRecordDays: 90 });
    const [shopper] = await app.db
      .insert(schema.shopifyShoppers)
      .values({
        storeId: store.id,
        clientId: 'old-client',
        email: 'old@example.com',
        lastSeenAt: daysAgo(200),
      })
      .returning();
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        status: 'COMPLETED',
        shopifyStoreId: store.id,
        shopifyShopperId: shopper.id,
        creditsCharged: 1,
        source: 'shopify',
      })
      .returning();

    await runShopifyRetention(app.db, app.storage, app.log);

    const remaining = await app.db
      .select()
      .from(schema.shopifyShoppers)
      .where(eq(schema.shopifyShoppers.id, shopper.id));
    expect(remaining).toHaveLength(0);

    const [afterJob] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(afterJob).toBeDefined();
    expect(afterJob.shopifyShopperId).toBeNull();
  });

  it('nulls only the key whose delete succeeded when its sibling delete fails', async () => {
    const store = await seedStoreWithRetention({ resultDays: 30 });
    const resultKey = `shopify-results/${store.id}/old/result`;
    const thumbnailKey = `shopify-results/${store.id}/old/thumbnail`;
    await app.storage.putObject(resultKey, Buffer.from('x'), 'image/jpeg');
    await app.storage.putObject(thumbnailKey, Buffer.from('x'), 'image/jpeg');

    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        status: 'COMPLETED',
        shopifyStoreId: store.id,
        creditsCharged: 1,
        source: 'shopify',
        createdAt: daysAgo(100),
      })
      .returning();
    await app.db.insert(schema.jobOutputs).values({
      jobId: job.id,
      resultKey,
      thumbnailKey,
    });

    // Wraps the real storage so the thumbnail delete transiently fails while
    // the result delete succeeds — proves the two columns are nulled
    // independently rather than as an all-or-nothing pair.
    const flakyStorage: typeof app.storage = {
      ...app.storage,
      deleteObject: async (key: string) => {
        if (key === thumbnailKey) throw new Error('simulated transient failure');
        return app.storage.deleteObject(key);
      },
    };

    await runShopifyRetention(app.db, flakyStorage, app.log);

    const [after] = await app.db
      .select()
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, job.id));
    expect(after).toBeDefined();
    expect(after.resultKey).toBeNull();
    expect(after.thumbnailKey).toBe(thumbnailKey);
    await expect(app.storage.headObject(resultKey)).rejects.toThrow();
  });

  it('keeps a row in scope across passes when one key clears and its sibling keeps failing', async () => {
    const store = await seedStoreWithRetention({ resultDays: 30 });
    const resultKey = `shopify-results/${store.id}/old2/result`;
    const thumbnailKey = `shopify-results/${store.id}/old2/thumbnail`;
    await app.storage.putObject(resultKey, Buffer.from('x'), 'image/jpeg');
    await app.storage.putObject(thumbnailKey, Buffer.from('x'), 'image/jpeg');

    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        status: 'COMPLETED',
        shopifyStoreId: store.id,
        creditsCharged: 1,
        source: 'shopify',
        createdAt: daysAgo(100),
      })
      .returning();
    await app.db.insert(schema.jobOutputs).values({
      jobId: job.id,
      resultKey,
      thumbnailKey,
    });

    // thumbnailKey's delete fails on every call (permanent, not just
    // transient), so pass 1 should clear resultKey but leave thumbnailKey.
    // The bug this guards against: once resultKey goes null, a WHERE clause
    // that only checks isNotNull(resultKey) would drop the row from every
    // future pass, silently orphaning the still-populated thumbnailKey.
    const alwaysFailsThumbnail: typeof app.storage = {
      ...app.storage,
      deleteObject: async (key: string) => {
        if (key === thumbnailKey) throw new Error('permanent simulated failure');
        return app.storage.deleteObject(key);
      },
    };

    await runShopifyRetention(app.db, alwaysFailsThumbnail, app.log);
    await runShopifyRetention(app.db, alwaysFailsThumbnail, app.log);

    const [after] = await app.db
      .select()
      .from(schema.jobOutputs)
      .where(eq(schema.jobOutputs.jobId, job.id));
    expect(after).toBeDefined();
    expect(after.resultKey).toBeNull();
    // Still non-null after a SECOND pass proves the row was still selected
    // by the WHERE clause and its delete retried, not silently dropped.
    expect(after.thumbnailKey).toBe(thumbnailKey);
    await expect(app.storage.headObject(thumbnailKey)).resolves.toBeDefined();
  });
});
