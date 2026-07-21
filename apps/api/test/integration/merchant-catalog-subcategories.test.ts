import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const JWT_SECRET = 'test-jwt-secret-0123456789abcdef-32min';
const secret = new TextEncoder().encode(JWT_SECRET);

async function createMerchant(app: TestApp, email: string) {
  const [merchantUser] = await app.db
    .insert(schema.users)
    .values({ email, passwordHash: 'unused' })
    .returning();
  const [merchant] = await app.db
    .insert(schema.merchants)
    .values({
      companyName: 'Merchant Co',
      contactName: 'Merchant Owner',
      phone: '9999999999',
      websiteUrl: 'https://example.com',
      companySize: '1-10',
      purpose: 'merchant tests',
      businessAddress: 'Test Street',
      isActive: true,
      userId: merchantUser.id,
    })
    .returning();
  await app.db.insert(schema.merchantCredits).values({ merchantId: merchant.id, balance: 0 });
  return merchant;
}

async function authHeader(userId: string) {
  const token = await signAccess(secret, userId, { kind: 'access' }, '15m');
  return { authorization: `Bearer ${token}` };
}

// Merchant catalogue subcategories only accept garment types with
// requiresMannequinStep = true — see the matching filter on the
// GET/POST/PATCH routes in catalog.routes.ts.
async function seedGarmentType(app: TestApp, genderSlug: string) {
  const [row] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug,
      slug: `saree-${randomUUID()}`,
      label: 'Saree',
      requiresMannequinStep: true,
    })
    .returning();
  return row;
}

describe('merchant catalog subcategories', () => {
  let c: Containers;
  let app: TestApp;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  it('creates, lists, updates, and isolates subcategories per merchant', async () => {
    const merchantA = await createMerchant(app, 'subcat-a@example.com');
    const merchantB = await createMerchant(app, 'subcat-b@example.com');
    const authA = await authHeader(merchantA.userId);
    const authB = await authHeader(merchantB.userId);
    const garmentType = await seedGarmentType(app, 'men');

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/catalog/subcategories',
      headers: authA,
      payload: { category: 'men', name: 'Casual Shirts', garmentSubcategoryId: garmentType.id },
    });
    expect(created.statusCode).toBe(201);
    const subcat = created.json() as { id: string; name: string; productCount: number };
    expect(subcat.name).toBe('Casual Shirts');
    expect(subcat.productCount).toBe(0);

    const listedA = await app.inject({
      method: 'GET',
      url: '/v1/merchant/catalog/subcategories',
      headers: authA,
    });
    expect(listedA.statusCode).toBe(200);
    expect((listedA.json() as { items: unknown[] }).items).toHaveLength(1);

    const listedB = await app.inject({
      method: 'GET',
      url: '/v1/merchant/catalog/subcategories',
      headers: authB,
    });
    expect((listedB.json() as { items: unknown[] }).items).toHaveLength(0);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/catalog/subcategories/${subcat.id}`,
      headers: authA,
      payload: { name: 'Party Shirts' },
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as { name: string }).name).toBe('Party Shirts');

    const crossMerchantPatch = await app.inject({
      method: 'PATCH',
      url: `/v1/merchant/catalog/subcategories/${subcat.id}`,
      headers: authB,
      payload: { name: 'Should not work' },
    });
    expect(crossMerchantPatch.statusCode).toBe(404);
  });

  it('allows two subcategories to point at the same garment type (many-to-one)', async () => {
    const merchant = await createMerchant(app, 'subcat-manytoone@example.com');
    const auth = await authHeader(merchant.userId);
    const garmentType = await seedGarmentType(app, 'women');

    const first = await app.inject({
      method: 'POST',
      url: '/v1/merchant/catalog/subcategories',
      headers: auth,
      payload: { category: 'women', name: 'Casual', garmentSubcategoryId: garmentType.id },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/merchant/catalog/subcategories',
      headers: auth,
      payload: { category: 'women', name: 'Party', garmentSubcategoryId: garmentType.id },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
  });

  it('deletes a subcategory and cascades its products, cleaning up R2 objects', async () => {
    const merchant = await createMerchant(app, 'subcat-delete@example.com');
    const auth = await authHeader(merchant.userId);
    const garmentType = await seedGarmentType(app, 'men');

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/catalog/subcategories',
      headers: auth,
      payload: { category: 'men', name: 'To Delete', garmentSubcategoryId: garmentType.id },
    });
    const subcatId = (created.json() as { id: string }).id;

    const imageKey = `merchant-catalog/${merchant.id}/delete-test/image.jpg`;
    const thumbKey = `merchant-catalog/${merchant.id}/delete-test/thumb.jpg`;
    await app.storage.putObject(imageKey, Buffer.from('img'), 'image/jpeg');
    await app.storage.putObject(thumbKey, Buffer.from('thumb'), 'image/jpeg');
    await app.db.insert(schema.merchantCatalogItems).values({
      merchantId: merchant.id,
      subcategoryId: subcatId,
      label: 'Product',
      actualPricePaise: 100000,
      offerPricePaise: 90000,
      r2Key: imageKey,
      thumbnailKey: thumbKey,
    });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/merchant/catalog/subcategories/${subcatId}`,
      headers: auth,
    });
    expect(deleted.statusCode).toBe(204);

    const remainingProducts = await app.db
      .select()
      .from(schema.merchantCatalogItems)
      .where(eq(schema.merchantCatalogItems.subcategoryId, subcatId));
    expect(remainingProducts).toHaveLength(0);

    await expect(app.storage.headObject(imageKey)).rejects.toThrow();
  });
});
