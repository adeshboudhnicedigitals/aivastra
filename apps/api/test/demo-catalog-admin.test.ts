import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';
import { createTestMerchant } from './helpers/merchant.js';

let c: Containers;
let app: TestApp;
let garmentTypeId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);

  const [gt] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: `demo-gt-${randomUUID()}`,
      label: 'Demo Garment Type',
      isActive: true,
    })
    .returning();
  if (!gt) throw new Error('failed to seed garment type');
  garmentTypeId = gt.id;
});

afterAll(async () => {
  await app?.close();
  await c?.stop();
});

async function seedSet() {
  const [set] = await app.db
    .insert(schema.demoCatalogSets)
    .values({ name: `Set ${randomUUID()}` })
    .returning();
  if (!set) throw new Error('failed to seed set');
  const [sub] = await app.db
    .insert(schema.demoCatalogSubcategories)
    .values({
      setId: set.id,
      category: 'women',
      name: 'Sarees',
      garmentSubcategoryId: garmentTypeId,
    })
    .returning();
  if (!sub) throw new Error('failed to seed subcategory');
  const [item] = await app.db
    .insert(schema.demoCatalogItems)
    .values({
      subcategoryId: sub.id,
      label: 'Demo Saree',
      actualPricePaise: 250000,
      offerPricePaise: 199000,
      r2Key: keys.demoCatalogItem(randomUUID()),
      thumbnailKey: keys.demoCatalogItemThumb(randomUUID()),
    })
    .returning();
  if (!item) throw new Error('failed to seed item');
  return { setId: set.id, subcategoryId: sub.id, itemId: item.id };
}

describe('demo catalog schema', () => {
  it('defaults a new set to active and a new item to active+approved', async () => {
    const { setId, itemId } = await seedSet();
    const [set] = await app.db
      .select()
      .from(schema.demoCatalogSets)
      .where(eq(schema.demoCatalogSets.id, setId));
    expect(set?.isActive).toBe(true);
    expect(set?.sortOrder).toBe(0);

    const [item] = await app.db
      .select()
      .from(schema.demoCatalogItems)
      .where(eq(schema.demoCatalogItems.id, itemId));
    expect(item?.isActive).toBe(true);
    expect(item?.sku).toBeNull();
  });

  it('cascades set deletion down to subcategories and items', async () => {
    const { setId, subcategoryId, itemId } = await seedSet();
    await app.db.delete(schema.demoCatalogSets).where(eq(schema.demoCatalogSets.id, setId));

    const subs = await app.db
      .select()
      .from(schema.demoCatalogSubcategories)
      .where(eq(schema.demoCatalogSubcategories.id, subcategoryId));
    const items = await app.db
      .select()
      .from(schema.demoCatalogItems)
      .where(eq(schema.demoCatalogItems.id, itemId));
    expect(subs).toHaveLength(0);
    expect(items).toHaveLength(0);
  });

  it('cascades merchant deletion down to assignments only', async () => {
    const { setId } = await seedSet();
    const merchant = await createTestMerchant(app);
    await app.db
      .insert(schema.demoCatalogAssignments)
      .values({ setId, merchantId: merchant.merchantId });

    await app.db.delete(schema.merchants).where(eq(schema.merchants.id, merchant.merchantId));

    const assignments = await app.db
      .select()
      .from(schema.demoCatalogAssignments)
      .where(eq(schema.demoCatalogAssignments.setId, setId));
    expect(assignments).toHaveLength(0);

    const sets = await app.db
      .select()
      .from(schema.demoCatalogSets)
      .where(eq(schema.demoCatalogSets.id, setId));
    expect(sets).toHaveLength(1);
  });

  it('rejects assigning the same set to the same merchant twice', async () => {
    const { setId } = await seedSet();
    const merchant = await createTestMerchant(app);
    await app.db
      .insert(schema.demoCatalogAssignments)
      .values({ setId, merchantId: merchant.merchantId });
    await expect(
      app.db
        .insert(schema.demoCatalogAssignments)
        .values({ setId, merchantId: merchant.merchantId }),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('storage keys', () => {
  it('namespaces demo objects under demo-catalog/', () => {
    expect(keys.demoCatalogItem('abc')).toBe('demo-catalog/abc/image.jpg');
    expect(keys.demoCatalogItemThumb('abc')).toBe('demo-catalog/abc/thumb.jpg');
  });
});
