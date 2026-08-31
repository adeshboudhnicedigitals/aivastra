import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redactShopperData } from '../../src/modules/shopify/gdpr.js';
import { runRedactionRetryTick } from '../../src/modules/shopify/gdpr-retry-scheduler.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// An erasure whose R2 deletes fail is left half-done. redactShopperData is
// retry-safe by construction, but before the redaction_requested_at stamp
// nothing could find the leftovers to re-run it on.
describe('gdpr redaction retry', () => {
  let c: Containers;
  let app: TestApp;

  // Swapped in per test so a delete can be made to fail on demand.
  let failDeletes = false;
  let realDelete: TestApp['storage']['deleteObject'];

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    realDelete = app.storage.deleteObject.bind(app.storage);
    app.storage.deleteObject = async (key: string) => {
      if (failDeletes) throw new Error('simulated R2 outage');
      return realDelete(key);
    };
  }, 90_000);

  afterAll(async () => {
    app.storage.deleteObject = realDelete;
    await app.close();
    await c.stop();
  });

  async function seedShopperWithPhoto() {
    const nonce = crypto.randomUUID();
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `gdpr-${nonce}.myshopify.com`,
        shopifyShopId: Math.floor(Math.random() * 1_000_000_000),
        accessToken: 'iv:tag:enc',
        scope: 'read_products',
      })
      .returning();
    const [shopper] = await app.db
      .insert(schema.shopifyShoppers)
      .values({
        storeId: store.id,
        clientId: `client-${nonce}`,
        email: `subject-${nonce}@example.com`,
      })
      .returning();

    const photoKey = `widget-inputs/${store.id}/${nonce}.jpg`;
    await app.storage.putObject(photoKey, Buffer.from('photo'), 'image/jpeg');

    // biome-ignore lint/suspicious/noExplicitAny: Drizzle infers non-null for nullable FKs
    const [job] = await (app.db.insert(schema.jobs).values as any)({
      shopifyStoreId: store.id,
      shopifyShopperId: shopper.id,
      status: 'COMPLETED',
      source: 'shopify',
      creditsCharged: 1,
      customerPhotoKey: photoKey,
    }).returning();

    return { store, shopper, job, photoKey, email: shopper.email as string };
  }

  const shopperRow = (id: string) =>
    app.db
      .select()
      .from(schema.shopifyShoppers)
      .where(eq(schema.shopifyShoppers.id, id))
      .then(([r]) => r);

  const jobPhotoKey = (id: string) =>
    app.db
      .select({ k: schema.jobs.customerPhotoKey })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id))
      .then(([r]) => r?.k);

  it('leaves a stamped survivor behind when the object delete fails', async () => {
    const { store, shopper, job, email } = await seedShopperWithPhoto();

    failDeletes = true;
    const result = await redactShopperData(app, store.id, { email });
    failDeletes = false;

    expect(result).toEqual({ removed: 0, incomplete: 1 });
    const row = await shopperRow(shopper.id);
    // The row survives, and it is stamped — that stamp is the only record that
    // an erasure was ever requested for this subject.
    expect(row).toBeDefined();
    expect(row?.redactionRequestedAt).toBeInstanceOf(Date);
    // The key must NOT be nulled while the object is still there: that pointer
    // is the only way back to it.
    expect(await jobPhotoKey(job.id)).not.toBeNull();
  });

  it('the retry tick finishes the erasure once deletes work again', async () => {
    const { store, shopper, job, photoKey, email } = await seedShopperWithPhoto();

    failDeletes = true;
    await redactShopperData(app, store.id, { email });
    failDeletes = false;

    expect(await shopperRow(shopper.id)).toBeDefined();

    const out = await runRedactionRetryTick(app);
    expect(out.shoppersAttempted).toBeGreaterThanOrEqual(1);

    // Subject fully erased: row gone, key cleared, object gone from storage.
    expect(await shopperRow(shopper.id)).toBeUndefined();
    expect(await jobPhotoKey(job.id)).toBeNull();
    await expect(app.storage.headObject(photoKey)).rejects.toThrow();
    void store;
  });

  it('keeps retrying while deletes still fail, without erasing the record of the request', async () => {
    const { store, shopper, email } = await seedShopperWithPhoto();

    failDeletes = true;
    await redactShopperData(app, store.id, { email });
    await runRedactionRetryTick(app);
    failDeletes = false;

    const row = await shopperRow(shopper.id);
    expect(row).toBeDefined();
    expect(row?.redactionRequestedAt).toBeInstanceOf(Date);
    void store;
  });

  it('does not touch shoppers who were never marked for erasure', async () => {
    const { shopper } = await seedShopperWithPhoto();

    await runRedactionRetryTick(app);

    const row = await shopperRow(shopper.id);
    expect(row).toBeDefined();
    expect(row?.redactionRequestedAt).toBeNull();
  });

  it('retries a whole-shop purge from the store stamp and clears it when clean', async () => {
    const { store, shopper, job, photoKey } = await seedShopperWithPhoto();
    await app.db
      .update(schema.shopifyStores)
      .set({ redactionRequestedAt: new Date() })
      .where(eq(schema.shopifyStores.id, store.id));

    failDeletes = true;
    await runRedactionRetryTick(app);
    failDeletes = false;

    // Still stamped: the purge could not finish, so the store must stay queued.
    const [midway] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(midway?.redactionRequestedAt).toBeInstanceOf(Date);
    expect(await shopperRow(shopper.id)).toBeDefined();

    const out = await runRedactionRetryTick(app);
    expect(out.storesCompleted).toBeGreaterThanOrEqual(1);

    const [after] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id));
    expect(after?.redactionRequestedAt).toBeNull();
    expect(await shopperRow(shopper.id)).toBeUndefined();
    expect(await jobPhotoKey(job.id)).toBeNull();
    await expect(app.storage.headObject(photoKey)).rejects.toThrow();
  });

  it('addresses retry subjects by row id, never by the email being erased', async () => {
    const { store, shopper, email } = await seedShopperWithPhoto();
    const other = await seedShopperWithPhoto();

    failDeletes = true;
    await redactShopperData(app, store.id, { email });
    failDeletes = false;

    // An explicit id list is the whole subject set — a second shopper in the
    // same store must not be swept up by the retry.
    await redactShopperData(app, store.id, { shopperIds: [shopper.id] });

    expect(await shopperRow(shopper.id)).toBeUndefined();
    expect(await shopperRow(other.shopper.id)).toBeDefined();
  });

  it('an empty id list erases nobody', async () => {
    const { store, shopper } = await seedShopperWithPhoto();

    const result = await redactShopperData(app, store.id, { shopperIds: [] });

    expect(result).toEqual({ removed: 0, incomplete: 0 });
    expect(await shopperRow(shopper.id)).toBeDefined();
  });
});
