import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

const JWT_SECRET = 'test-jwt-secret-0123456789abcdef-32min';
const secret = new TextEncoder().encode(JWT_SECRET);

async function createMerchant(app: TestApp, email: string, balance = 100) {
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
  await app.db.insert(schema.userCredits).values({ userId: merchantUser.id, balance });
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
      slug: `template-${randomUUID()}`,
      label: 'Try-on workflow',
      jsonContent: {},
      poseNodeId: 'pose',
      upperNodeIds: [],
      garmentPhasePromptNode: 'garment',
      workflowType: 'tryon',
      isActive: true,
    })
    .returning();
  const [tryonCategory] = await app.db
    .insert(schema.tryonCategories)
    .values({
      name: `category-${randomUUID()}`,
      slug: `category-${randomUUID()}`,
      workflowTemplateId: template.id,
      isActive: true,
    })
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

// Two-input (body+pallu) garment type. No single-pass 3-input (customer + body +
// pallu) template exists in this system — see resolveTryonGarment.ts's
// ResolvedTwoInputTryonGarment doc comment — so a two-input catalog item goes
// through the two-step pipeline: a mannequin-drape template (body+pallu, no
// person node) followed by the garment type's ordinary tryonCategory
// single-garment template (person+garment, same as any other tryon).
async function seedTwoInputGarmentType(
  app: TestApp,
  opts: { mannequinTemplateActive?: boolean } = {},
) {
  const [mannequinTemplate] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `two-input-mannequin-${randomUUID()}`,
      label: 'Two-input mannequin drape',
      jsonContent: {},
      poseNodeId: 'pose',
      upperNodeIds: [],
      garmentPhasePromptNode: 'garment',
      workflowType: 'saree_step1_two_input',
      tryonGarmentNodeId: '30',
      tryonGarmentNodeId2: '27',
      tryonOutputNodeId: '25',
      isActive: opts.mannequinTemplateActive ?? true,
    })
    .returning();
  const [tryonTemplate] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `two-input-tryon-${randomUUID()}`,
      label: 'Tryon workflow for two-input garment type',
      jsonContent: {},
      poseNodeId: 'pose',
      upperNodeIds: [],
      garmentPhasePromptNode: 'garment',
      workflowType: 'tryon',
      tryonPersonNodeId: '26',
      tryonGarmentNodeId: '30',
      tryonOutputNodeId: '25',
      isActive: true,
    })
    .returning();
  const [tryonCategory] = await app.db
    .insert(schema.tryonCategories)
    .values({
      name: `two-input-category-${randomUUID()}`,
      slug: `two-input-category-${randomUUID()}`,
      workflowTemplateId: tryonTemplate.id,
      isActive: true,
    })
    .returning();
  const [garmentType] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: `saree-${randomUUID()}`,
      label: 'Saree',
      tryonCategoryId: tryonCategory.id,
      mannequinTwoInputWorkflowTemplateId: mannequinTemplate.id,
    })
    .returning();
  return { garmentType, mannequinTemplate, tryonTemplate };
}

async function seedCatalogItemWithSecondImage(
  app: TestApp,
  merchantId: string,
  garmentTypeId: string,
) {
  const [subcategory] = await app.db
    .insert(schema.merchantCatalogSubcategories)
    .values({
      merchantId,
      category: 'women',
      name: 'Sarees',
      garmentSubcategoryId: garmentTypeId,
    })
    .returning();
  const imageKey = `merchant-catalog/${merchantId}/${randomUUID()}/image.jpg`;
  const thumbKey = `merchant-catalog/${merchantId}/${randomUUID()}/thumb.jpg`;
  const secondImageKey = `merchant-catalog/${merchantId}/${randomUUID()}/second.jpg`;
  const secondThumbKey = `merchant-catalog/${merchantId}/${randomUUID()}/second-thumb.jpg`;
  await app.storage.putObject(imageKey, Buffer.from('body'), 'image/jpeg');
  await app.storage.putObject(thumbKey, Buffer.from('body-thumb'), 'image/jpeg');
  await app.storage.putObject(secondImageKey, Buffer.from('pallu'), 'image/jpeg');
  await app.storage.putObject(secondThumbKey, Buffer.from('pallu-thumb'), 'image/jpeg');
  const [item] = await app.db
    .insert(schema.merchantCatalogItems)
    .values({
      merchantId,
      subcategoryId: subcategory.id,
      label: 'Two-Input Saree',
      actualPricePaise: 200000,
      offerPricePaise: 180000,
      r2Key: imageKey,
      thumbnailKey: thumbKey,
      secondR2Key: secondImageKey,
      secondThumbnailKey: secondThumbKey,
    })
    .returning();
  return item;
}

async function presignAndUploadCustomerPhoto(app: TestApp, auth: Record<string, string>) {
  const presigned = await app.inject({
    method: 'POST',
    url: '/v1/merchant/tryon/presign',
    headers: auth,
    payload: { contentType: 'image/jpeg', contentLength: 1024 },
  });
  const { r2Key } = presigned.json() as { r2Key: string };
  await app.storage.putObject(r2Key, Buffer.from('photo'), 'image/jpeg');
  return r2Key;
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

  it('presigns a customer photo, creates a job charging the admin-configured tryon cost, and rejects a photo key from a different merchant', async () => {
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
    expect(jobRow.creditsCharged).toBe(5); // SIMPLE_TRYON_COST default, no config:system override in this test
    expect(jobRow.merchantId).toBe(merchant.id);
    expect(jobRow.userId).toBe(merchantUser.id);
    expect(jobRow.source).toBe('merchant_tryon');

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, merchantUser.id));
    expect(credits.balance).toBe(95);

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

  it('402s with no job row when merchant credits are insufficient', async () => {
    const { merchant, merchantUser } = await createMerchant(
      app,
      'tryon-low-balance@example.com',
      2,
    );
    const auth = await authHeader(merchantUser.id);
    const garmentType = await seedGarmentTypeWithWorkflow(app);
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
    expect(created.statusCode).toBe(402);
    expect(created.json()).toMatchObject({
      error: { code: 'INSUFFICIENT_CREDITS', message: 'insufficient credits' },
    });

    const jobs = await app.db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.merchantId, merchant.id));
    expect(jobs).toHaveLength(0);

    const [credits] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, merchantUser.id));
    expect(credits.balance).toBe(2);
  });

  it('rejects a customer photo above the admin-configured limit', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-limit@example.com');
    const auth = await authHeader(merchantUser.id);
    const garmentType = await seedGarmentTypeWithWorkflow(app);
    const item = await seedCatalogItem(app, merchant.id, garmentType.id);

    await app.redis.set(
      'config:system',
      JSON.stringify({ uploadLimits: { merchantTryonMaxBytes: 1024 } }),
    );
    try {
      const presigned = await app.inject({
        method: 'POST',
        url: '/v1/merchant/tryon/presign',
        headers: auth,
        payload: { contentType: 'image/jpeg', contentLength: 2048 },
      });
      expect(presigned.statusCode).toBe(200);
      const { r2Key } = presigned.json() as { r2Key: string };
      await app.storage.putObject(r2Key, Buffer.alloc(2048), 'image/jpeg');

      const jobRes = await app.inject({
        method: 'POST',
        url: '/v1/merchant/tryon/jobs',
        headers: auth,
        payload: { merchantCatalogItemId: item.id, customerPhotoKey: r2Key },
      });
      expect(jobRes.statusCode).toBe(413);
      expect(jobRes.json().error.message).toContain('MB limit');
    } finally {
      await app.redis.del('config:system');
    }
  });

  it('returns job status scoped to the owning merchant, 404s for another merchant', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-e@example.com');
    const auth = await authHeader(merchantUser.id);
    const garmentType = await seedGarmentTypeWithWorkflow(app);
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
    const { jobId } = created.json() as { jobId: string };

    const status = await app.inject({
      method: 'GET',
      url: `/v1/merchant/tryon/jobs/${jobId}`,
      headers: auth,
    });
    expect(status.statusCode).toBe(200);
    const body = status.json() as { status: string; liked: boolean; inCart: boolean };
    expect(body.status).toBe('QUEUED');
    expect(body.liked).toBe(false);
    expect(body.inCart).toBe(false);

    const otherAuth = await authHeader(
      (await createMerchant(app, 'tryon-f@example.com')).merchantUser.id,
    );
    const crossMerchant = await app.inject({
      method: 'GET',
      url: `/v1/merchant/tryon/jobs/${jobId}`,
      headers: otherAuth,
    });
    expect(crossMerchant.statusCode).toBe(404);
  });
  it('cancels a queued job and refunds the charged credits', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-g@example.com');
    const auth = await authHeader(merchantUser.id);
    const garmentType = await seedGarmentTypeWithWorkflow(app);
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
    const { jobId } = created.json() as { jobId: string };

    const [creditsAfterCreate] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, merchantUser.id));
    expect(creditsAfterCreate.balance).toBe(95); // 100 - 5 (SIMPLE_TRYON_COST default)

    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/v1/merchant/tryon/jobs/${jobId}`,
      headers: auth,
    });
    expect(cancelled.statusCode).toBe(200);
    expect((cancelled.json() as { status: string }).status).toBe('CANCELLED');

    const [creditsAfterCancel] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, merchantUser.id));
    expect(creditsAfterCancel.balance).toBe(100); // fully refunded

    const [ledgerRow] = await app.db
      .select()
      .from(schema.creditLedger)
      .where(
        and(
          eq(schema.creditLedger.jobId, jobId),
          eq(schema.creditLedger.reason, 'REFUND_CANCELLED'),
        ),
      );
    expect(ledgerRow).toBeDefined();
    expect(ledgerRow.delta).toBe(5);

    const cancelledAgain = await app.inject({
      method: 'DELETE',
      url: `/v1/merchant/tryon/jobs/${jobId}`,
      headers: auth,
    });
    expect(cancelledAgain.statusCode).toBe(409);

    const [creditsAfterSecondCancel] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, merchantUser.id));
    expect(creditsAfterSecondCancel.balance).toBe(100); // unaffected by failed second cancel
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
  it('resolves a presigned GET URL for a customer photo the merchant owns, rejects other merchants', async () => {
    const { merchantUser } = await createMerchant(app, 'tryon-h@example.com');
    const auth = await authHeader(merchantUser.id);
    const presigned = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/presign',
      headers: auth,
      payload: { contentType: 'image/jpeg', contentLength: 1024 },
    });
    const { r2Key } = presigned.json() as { r2Key: string };
    await app.storage.putObject(r2Key, Buffer.from('photo'), 'image/jpeg');

    const resolved = await app.inject({
      method: 'GET',
      url: `/v1/merchant/tryon/photo-url?r2Key=${encodeURIComponent(r2Key)}`,
      headers: auth,
    });
    expect(resolved.statusCode).toBe(200);
    expect(typeof (resolved.json() as { url: string }).url).toBe('string');

    const otherAuth = await authHeader(
      (await createMerchant(app, 'tryon-i@example.com')).merchantUser.id,
    );
    const forbidden = await app.inject({
      method: 'GET',
      url: `/v1/merchant/tryon/photo-url?r2Key=${encodeURIComponent(r2Key)}`,
      headers: otherAuth,
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('creates a mannequin-drape job plus a PENDING_MANNEQUIN tryon job carrying the real customer photo when the catalog item has a second image', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-two-input-a@example.com');
    const auth = await authHeader(merchantUser.id);
    const { garmentType, mannequinTemplate, tryonTemplate } = await seedTwoInputGarmentType(app);
    const item = await seedCatalogItemWithSecondImage(app, merchant.id, garmentType.id);
    const r2Key = await presignAndUploadCustomerPhoto(app, auth);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/jobs',
      headers: auth,
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: r2Key },
    });
    expect(created.statusCode).toBe(201);
    const { jobId } = created.json() as { jobId: string };

    const [tryonJob] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(tryonJob.status).toBe('PENDING_MANNEQUIN');
    expect(tryonJob.customerPhotoKey).toBe(r2Key);
    expect(tryonJob.merchantId).toBe(merchant.id);

    const [tryonInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    expect(tryonInputs.upperGarmentKey).toBeNull();
    expect(tryonInputs.thirdGarmentKey).toBeNull();
    const tryonParams = tryonInputs.params as {
      workflowTemplateId: string;
      mannequinJobId: string;
    };
    expect(tryonParams.workflowTemplateId).toBe(tryonTemplate.id);

    const [mannequinJob] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, tryonParams.mannequinJobId));
    expect(mannequinJob.status).toBe('QUEUED');
    expect(mannequinJob.creditsCharged).toBe(0);
    expect(mannequinJob.source).toBe('saree_mannequin');

    const [mannequinInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, tryonParams.mannequinJobId));
    expect(mannequinInputs.upperGarmentKey).toBe(item.r2Key);
    expect(mannequinInputs.thirdGarmentKey).toBe(item.secondR2Key);
    expect((mannequinInputs.params as { workflowTemplateId: string }).workflowTemplateId).toBe(
      mannequinTemplate.id,
    );
  });

  it('creates an ordinary single-image job (not the two-step pipeline) for a single-image catalog item on a two-input-capable garment type', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-two-input-b@example.com');
    const auth = await authHeader(merchantUser.id);
    const { garmentType, tryonTemplate } = await seedTwoInputGarmentType(app);
    // Single-image item — same garment type, but no secondR2Key on this particular item.
    const item = await seedCatalogItem(app, merchant.id, garmentType.id);
    const r2Key = await presignAndUploadCustomerPhoto(app, auth);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/jobs',
      headers: auth,
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: r2Key },
    });
    expect(created.statusCode).toBe(201);
    const { jobId } = created.json() as { jobId: string };

    const [jobRow] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(jobRow.status).toBe('QUEUED');

    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    expect(inputs.upperGarmentKey).toBe(item.r2Key);
    expect(inputs.thirdGarmentKey).toBeNull();
    expect((inputs.params as { workflowTemplateId: string }).workflowTemplateId).toBe(
      tryonTemplate.id,
    );
  });

  it('rejects a two-input catalog item when the garment type has no two-input mannequin workflow configured', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-two-input-c@example.com');
    const auth = await authHeader(merchantUser.id);
    // No mannequinTwoInputWorkflowTemplateId set at all.
    const [garmentType] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'women', slug: `unconfigured-saree-${randomUUID()}`, label: 'Saree' })
      .returning();
    const item = await seedCatalogItemWithSecondImage(app, merchant.id, garmentType.id);
    const r2Key = await presignAndUploadCustomerPhoto(app, auth);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/jobs',
      headers: auth,
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: r2Key },
    });
    expect(created.statusCode).toBe(400);
    const body = created.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toBe('garment type has no two-input mannequin workflow configured');

    const jobs = await app.db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.merchantId, merchant.id));
    expect(jobs).toHaveLength(0);
  });

  it('rejects a two-input catalog item when the two-input mannequin workflow template is inactive', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-two-input-d@example.com');
    const auth = await authHeader(merchantUser.id);
    const { garmentType } = await seedTwoInputGarmentType(app, { mannequinTemplateActive: false });
    const item = await seedCatalogItemWithSecondImage(app, merchant.id, garmentType.id);
    const r2Key = await presignAndUploadCustomerPhoto(app, auth);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/jobs',
      headers: auth,
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: r2Key },
    });
    expect(created.statusCode).toBe(400);
    const body = created.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toBe('two-input mannequin workflow is inactive');
  });

  it('promotes the step-2 job to QUEUED with the mannequin output as upperGarmentKey, and the real customer photo untouched, once the mannequin job completes (simulated)', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-two-input-e@example.com');
    const auth = await authHeader(merchantUser.id);
    const { garmentType, tryonTemplate } = await seedTwoInputGarmentType(app);
    const item = await seedCatalogItemWithSecondImage(app, merchant.id, garmentType.id);
    const r2Key = await presignAndUploadCustomerPhoto(app, auth);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/jobs',
      headers: auth,
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: r2Key },
    });
    expect(created.statusCode).toBe(201);
    const { jobId: step2JobId } = created.json() as { jobId: string };

    const [step2Inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, step2JobId));
    const mannequinJobId = (step2Inputs.params as Record<string, unknown>).mannequinJobId as string;

    // Simulate the dispatcher completing the mannequin job (dispatcher is not
    // running in this integration test — same convention as
    // merchant-catalog-generate.test.ts's own two-step promotion test).
    const mannequinResultKey = `outputs/${mannequinJobId}/result.png`;
    await app.storage.putObject(mannequinResultKey, Buffer.from('drape-output'), 'image/png');
    await app.db
      .update(schema.jobs)
      .set({ status: 'COMPLETED' })
      .where(eq(schema.jobs.id, mannequinJobId));

    // Run the actual promoter sweep against the real dispatcher config shape.
    const { promoteSareeStep2Jobs } = await import(
      '../../../dispatcher/src/job/saree-step2-promoter.js'
    );
    await promoteSareeStep2Jobs({
      db: app.db,
      redis: app.redis,
      pub: app.redis,
      log: app.log,
    } as never);

    const [step2] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, step2JobId));
    expect(step2.status).toBe('QUEUED');
    expect(step2.customerPhotoKey).toBe(r2Key);

    const [step2InputsAfter] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, step2JobId));
    expect(step2InputsAfter.upperGarmentKey).toBe(mannequinResultKey);
    expect(step2InputsAfter.thirdGarmentKey).toBeNull();
    expect((step2InputsAfter.params as { workflowTemplateId: string }).workflowTemplateId).toBe(
      tryonTemplate.id,
    );

    const stream = await app.redis.xrange('jobs:normal', '-', '+');
    const enqueuedJobIds = stream.map(([, fields]) => fields[fields.indexOf('jobId') + 1]);
    expect(enqueuedJobIds).toContain(step2JobId);

    // The promoter also caches the drape output onto the catalog item itself, so
    // the next customer's try-on of this same product can skip step 1 entirely.
    const [itemAfter] = await app.db
      .select()
      .from(schema.merchantCatalogItems)
      .where(eq(schema.merchantCatalogItems.id, item.id));
    expect(itemAfter.mannequinResultKey).toBe(mannequinResultKey);
  });

  it('goes straight to a single ordinary job, skipping the mannequin step entirely, when a cached drape already exists for the catalog item', async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-two-input-f@example.com');
    const auth = await authHeader(merchantUser.id);
    const { garmentType, tryonTemplate } = await seedTwoInputGarmentType(app);
    const item = await seedCatalogItemWithSecondImage(app, merchant.id, garmentType.id);
    const cachedDrapeKey = `outputs/${randomUUID()}/result.png`;
    await app.db
      .update(schema.merchantCatalogItems)
      .set({ mannequinResultKey: cachedDrapeKey })
      .where(eq(schema.merchantCatalogItems.id, item.id));
    const r2Key = await presignAndUploadCustomerPhoto(app, auth);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/merchant/tryon/jobs',
      headers: auth,
      payload: { merchantCatalogItemId: item.id, customerPhotoKey: r2Key },
    });
    expect(created.statusCode).toBe(201);
    const { jobId } = created.json() as { jobId: string };

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.status).toBe('QUEUED');
    expect(job.customerPhotoKey).toBe(r2Key);

    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    expect(inputs.upperGarmentKey).toBe(cachedDrapeKey);
    expect(inputs.thirdGarmentKey).toBeNull();
    expect((inputs.params as { workflowTemplateId: string }).workflowTemplateId).toBe(
      tryonTemplate.id,
    );

    // No second (mannequin) job was created for this request — only the one
    // ordinary job above exists for this merchant.
    const jobs = await app.db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.merchantId, merchant.id));
    expect(jobs).toHaveLength(1);
  });

  it("returns mannequinResultUrl as null before the drape is cached and a presigned URL after, in the catalog item's serialized response", async () => {
    const { merchant, merchantUser } = await createMerchant(app, 'tryon-two-input-g@example.com');
    const auth = await authHeader(merchantUser.id);
    const { garmentType } = await seedTwoInputGarmentType(app);
    const item = await seedCatalogItemWithSecondImage(app, merchant.id, garmentType.id);

    const before = await app.inject({
      method: 'GET',
      url: '/v1/merchant/catalog',
      headers: auth,
    });
    expect(before.statusCode).toBe(200);
    const beforeItem = (before.json() as { items: { id: string; mannequinResultUrl: unknown }[] })
      .items[0];
    expect(beforeItem.id).toBe(item.id);
    expect(beforeItem.mannequinResultUrl).toBeNull();

    const cachedDrapeKey = `outputs/${randomUUID()}/result.png`;
    await app.storage.putObject(cachedDrapeKey, Buffer.from('drape-output'), 'image/png');
    await app.db
      .update(schema.merchantCatalogItems)
      .set({ mannequinResultKey: cachedDrapeKey })
      .where(eq(schema.merchantCatalogItems.id, item.id));

    const after = await app.inject({
      method: 'GET',
      url: '/v1/merchant/catalog',
      headers: auth,
    });
    expect(after.statusCode).toBe(200);
    const afterItem = (
      after.json() as { items: { id: string; mannequinResultUrl: string | null }[] }
    ).items[0];
    expect(afterItem.mannequinResultUrl).not.toBeNull();
  });
});
