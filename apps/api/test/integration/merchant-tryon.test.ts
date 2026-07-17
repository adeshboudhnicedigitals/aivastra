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
      businessAddress: 'Test Street',
      isActive: true,
      userId: merchantUser.id,
    })
    .returning();
  return { merchant, merchantUser };
}

async function authHeader(userId: string) {
  const token = await signAccess(secret, userId, { kind: 'access' }, '15m');
  return { authorization: `Bearer ${token}` };
}

async function seedGarmentTypeWithWorkflow(app: TestApp) {
  const [template] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      name: `template-${randomUUID()}`,
      workflowType: 'tryon',
      jsonContent: {},
      isActive: true,
    })
    .returning();
  const [tryonCategory] = await app.db
    .insert(schema.tryonCategories)
    .values({ name: `category-${randomUUID()}`, workflowTemplateId: template.id, isActive: true })
    .returning();
  const [garmentType] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: `shirt-${randomUUID()}`,
      label: 'Shirt',
      tryonCategoryId: tryonCategory.id,
    })
    .returning();
  return garmentType;
}

async function seedCatalogItem(app: TestApp, merchantId: string, garmentTypeId: string) {
  const [subcategory] = await app.db
    .insert(schema.merchantCatalogSubcategories)
    .values({
      merchantId,
      category: 'women',
      name: 'Casual Shirts',
      garmentSubcategoryId: garmentTypeId,
    })
    .returning();
  const imageKey = `merchant-catalog/${merchantId}/${randomUUID()}/image.jpg`;
  const thumbKey = `merchant-catalog/${merchantId}/${randomUUID()}/thumb.jpg`;
  await app.storage.putObject(imageKey, Buffer.from('img'), 'image/jpeg');
  await app.storage.putObject(thumbKey, Buffer.from('thumb'), 'image/jpeg');
  const [item] = await app.db
    .insert(schema.merchantCatalogItems)
    .values({
      merchantId,
      subcategoryId: subcategory.id,
      label: 'Red Shirt',
      actualPricePaise: 200000,
      offerPricePaise: 180000,
      r2Key: imageKey,
      thumbnailKey: thumbKey,
    })
    .returning();
  return item;
}

describe('merchant try-on jobs', () => {
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

  it('presigns a customer photo, creates a job with zero credits charged, and rejects a photo key from a different merchant', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-a@example.com');
    const { merchant: otherMerchant } = await createMerchant(app, 'tryon-b@example.com');
    const auth = await authHeader(merchantUser.id);
    const garmentType = await seedGarmentTypeWithWorkflow(app);
    const item = await seedCatalogItem(app, merchant.id, garmentType.id);

    const presigned = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/presign',
      headers: auth,
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    expect(presigned.statusCode).toBe(200);
    const { r2Key } = presigned.json() as { r2Key: string; uploadUrl: string };
    expect(r2Key.startsWith(`merchant-inputs/${merchant.id}/`)).toBe(true);
    await app.storage.putObject(r2Key, Buffer.from('photo'), 'image/jpeg');

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/jobs',
      headers: auth,
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: r2Key },
    });
    expect(created.statusCode).toBe(201);
    const { jobId } = created.json() as { jobId: string };

    const [jobRow] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(jobRow.creditsCharged).toBe(0);
    expect(jobRow.merchantId).toBe(merchant.id);
    expect(jobRow.userId).toBe(merchantUser.id);
    expect(jobRow.source).toBe('merchant_tryon');

    const otherAuth = await authHeader(
      (await createMerchant(app, 'tryon-c@example.com')).merchantUser.id,
    );
    const crossMerchant = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/jobs',
      headers: otherAuth,
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: r2Key },
    });
    expect(crossMerchant.statusCode).toBe(404);
    void otherMerchant;
  });

  it('rejects a job when the garment type has no tryon category configured', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-d@example.com');
    const auth = await authHeader(merchantUser.id);
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'women', slug: `unmapped-${randomUUID()}`, label: 'Unmapped' })
      .returning();
    const item = await seedCatalogItem(app, merchant.id, garmentType.id);

    const presigned = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/presign',
      headers: auth,
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    const { r2Key } = presigned.json() as { r2Key: string };
    await app.storage.putObject(r2Key, Buffer.from('photo'), 'image/jpeg');

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/jobs',
      headers: auth,
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: r2Key },
    });
    expect(created.statusCode).toBe(400);
    expect((created.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });
});
