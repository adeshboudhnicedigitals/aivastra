import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminAuthHeader } from './helpers/admin.js';
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

describe('admin demo set + subcategory routes', () => {
  let authHeaders: Record<string, string>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    authHeaders = await adminAuthHeader(app, 'SUPER_ADMIN');
  });

  beforeEach(() => {
    infoSpy = vi.spyOn(app.log, 'info');
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  const auth = () => authHeaders;

  it('creates, lists, patches and deletes a set', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/demo-catalog/sets',
      headers: auth(),
      payload: { name: 'Womens Showroom', description: 'Sales demo' },
    });
    expect(created.statusCode).toBe(201);
    const setId = created.json().id;
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: expect.any(String),
        demoSetId: setId,
        fields: ['name', 'description'],
      }),
      'demo set created',
    );

    const listed = await app.inject({
      method: 'GET',
      url: '/admin/demo-catalog/sets',
      headers: auth(),
    });
    const row = listed.json().items.find((s: { id: string }) => s.id === setId);
    expect(row).toMatchObject({
      name: 'Womens Showroom',
      isActive: true,
      subcategoryCount: 0,
      productCount: 0,
      assignedMerchantCount: 0,
    });

    const patched = await app.inject({
      method: 'PATCH',
      url: `/admin/demo-catalog/sets/${setId}`,
      headers: auth(),
      payload: { isActive: false, name: 'Renamed' },
    });
    expect(patched.statusCode).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: expect.any(String),
        demoSetId: setId,
        fields: expect.arrayContaining(['isActive', 'name']),
      }),
      'demo set updated',
    );

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/admin/demo-catalog/sets/${setId}`,
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(204);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: expect.any(String),
        demoSetId: setId,
        fields: expect.arrayContaining(['id', 'name']),
      }),
      'demo set deleted',
    );

    const gone = await app.inject({
      method: 'PATCH',
      url: `/admin/demo-catalog/sets/${setId}`,
      headers: auth(),
      payload: { name: 'x' },
    });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects an empty patch body', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/demo-catalog/sets',
      headers: auth(),
      payload: { name: 'Empty patch target' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/demo-catalog/sets/${created.json().id}`,
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates, lists, patches and deletes subcategories under a set', async () => {
    const set = await app.inject({
      method: 'POST',
      url: '/admin/demo-catalog/sets',
      headers: auth(),
      payload: { name: 'With subs' },
    });
    const setId = set.json().id;

    const created = await app.inject({
      method: 'POST',
      url: '/admin/demo-catalog/subcategories',
      headers: auth(),
      payload: { setId, category: 'women', name: 'Sarees', garmentSubcategoryId: garmentTypeId },
    });
    expect(created.statusCode).toBe(201);
    const subcategoryId = created.json().id;
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: expect.any(String),
        demoSetId: setId,
        demoSubcategoryId: subcategoryId,
        fields: ['setId', 'category', 'name', 'garmentSubcategoryId'],
      }),
      'demo subcategory created',
    );

    const listed = await app.inject({
      method: 'GET',
      url: `/admin/demo-catalog/sets/${setId}/subcategories`,
      headers: auth(),
    });
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0]).toMatchObject({ name: 'Sarees', productCount: 0 });

    const patched = await app.inject({
      method: 'PATCH',
      url: `/admin/demo-catalog/subcategories/${subcategoryId}`,
      headers: auth(),
      payload: { name: 'Silk Sarees' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ id: subcategoryId, name: 'Silk Sarees' });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: expect.any(String),
        demoSubcategoryId: subcategoryId,
        fields: ['name'],
      }),
      'demo subcategory updated',
    );

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/admin/demo-catalog/subcategories/${subcategoryId}`,
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(204);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: expect.any(String),
        demoSubcategoryId: subcategoryId,
        fields: expect.arrayContaining(['id', 'name']),
      }),
      'demo subcategory deleted',
    );

    const gone = await app.inject({
      method: 'PATCH',
      url: `/admin/demo-catalog/subcategories/${subcategoryId}`,
      headers: auth(),
      payload: { name: 'Gone' },
    });
    expect(gone.statusCode).toBe(404);
  });

  it('404s a subcategory pointed at a set that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/demo-catalog/subcategories',
      headers: auth(),
      payload: {
        setId: randomUUID(),
        category: 'women',
        name: 'Orphan',
        garmentSubcategoryId: garmentTypeId,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400s an unknown category', async () => {
    const set = await app.inject({
      method: 'POST',
      url: '/admin/demo-catalog/sets',
      headers: auth(),
      payload: { name: 'Bad category' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/demo-catalog/subcategories',
      headers: auth(),
      payload: {
        setId: set.json().id,
        category: 'aliens',
        name: 'Nope',
        garmentSubcategoryId: garmentTypeId,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('401s without a token and 403s a SUPPORT admin', async () => {
    const anon = await app.inject({ method: 'GET', url: '/admin/demo-catalog/sets' });
    expect(anon.statusCode).toBe(401);

    const supportHeaders = await adminAuthHeader(app, 'SUPPORT');
    const support = await app.inject({
      method: 'GET',
      url: '/admin/demo-catalog/sets',
      headers: supportHeaders,
    });
    expect(support.statusCode).toBe(403);
  });
});
