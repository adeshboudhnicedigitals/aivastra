import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { signAccess } from '../../src/modules/auth/service.js';
import { generateApiKey } from '../../src/modules/dev/keys.js';
import type { TestApp } from './api.js';

export async function createTestMerchant(
  app: TestApp,
  opts: {
    isActive?: boolean;
    balance?: number;
    demoData?: boolean;
    jobRateLimitPerMin?: number;
  } = {},
) {
  const [user] = await app.db
    .insert(schema.users)
    .values({
      email: `merchant-${randomUUID()}@test.com`,
      displayName: 'Test Merchant',
      emailVerified: true,
    })
    .returning();
  if (!user) throw new Error('failed to create test user');

  const [merchant] = await app.db
    .insert(schema.merchants)
    .values({
      companyName: 'Test Co',
      contactName: 'Test Person',
      phone: '0000000000',
      businessAddress: 'Test Address',
      isActive: opts.isActive ?? true,
      demoData: opts.demoData ?? true,
      userId: user.id,
      jobRateLimitPerMin: opts.jobRateLimitPerMin,
    })
    .returning();
  if (!merchant) throw new Error('failed to create test merchant');

  // One pool: merchant spend (android tryon) and personal spend
  // (studio, catalogue generation) both draw from this balance.
  await app.db.insert(schema.userCredits).values({ userId: user.id, balance: opts.balance ?? 100 });

  return {
    merchantId: merchant.id,
    userId: user.id,
    async credits(n: number) {
      await app.db
        .update(schema.userCredits)
        .set({ balance: n })
        .where(eq(schema.userCredits.userId, user.id));
    },
  };
}

export async function createTestApiKey(
  app: TestApp,
  merchantId: string,
  opts: {
    revoked?: boolean;
    label?: string;
    scope?: 'full' | 'widget';
    integration?: 'generic' | 'wordpress';
    allowedOrigin?: string;
  } = {},
) {
  const { key, keyHash, keyPrefix } = generateApiKey();
  const [row] = await app.db
    .insert(schema.apiKeys)
    .values({
      merchantId,
      label: opts.label ?? 'test',
      keyHash,
      keyPrefix,
      revokedAt: opts.revoked ? new Date() : null,
      scope: opts.scope ?? 'full',
      integration: opts.integration ?? 'generic',
      allowedOrigin: opts.allowedOrigin ?? null,
    })
    .returning();
  if (!row) throw new Error('failed to create test api key');
  return { id: row.id, key };
}

/**
 * Creates a tryon category plus the workflow template it points at.
 *
 * workflow_templates has six NOT NULL columns with no default — slug, label,
 * jsonContent, poseNodeId, upperNodeIds, garmentPhasePromptNode — so the filler
 * values below are mandatory, not decorative. Shape follows the existing inserts
 * in apps/api/test/shopify-me.test.ts:112.
 */
export async function createTestTryonCategory(
  app: TestApp,
  opts: {
    slug: string;
    name?: string;
    isActive?: boolean;
    templateIsActive?: boolean;
    sortOrder?: number;
  },
) {
  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `wf-${randomUUID()}`,
      label: 'Test Tryon WF',
      jsonContent: {},
      poseNodeId: 'x',
      upperNodeIds: [],
      garmentPhasePromptNode: 'x',
      workflowType: 'tryon',
      isActive: opts.templateIsActive ?? true,
    })
    .returning();
  if (!wf) throw new Error('failed to create test workflow template');

  const [cat] = await app.db
    .insert(schema.tryonCategories)
    .values({
      name: opts.name ?? 'Test Category',
      slug: opts.slug,
      workflowTemplateId: wf.id,
      isActive: opts.isActive ?? true,
      sortOrder: opts.sortOrder ?? 0,
    })
    .returning();
  if (!cat) throw new Error('failed to create test tryon category');

  return { categoryId: cat.id, workflowTemplateId: wf.id };
}

/**
 * Creates a garment_subcategories row with requires_mannequin_step = true, plus
 * the saree_step1 workflow template it points at. Mirrors createTestTryonCategory
 * above, adapted for the mannequin-step shape (garment + output node only —
 * no pose/upper/lower/face-node fields apply to workflowType 'saree_step1').
 */
export async function createTestSareeMannequinGarmentType(
  app: TestApp,
  opts: { isActive?: boolean; templateIsActive?: boolean; withPersonNode?: boolean } = {},
) {
  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `saree-step1-${randomUUID()}`,
      label: 'Test Saree Step1 WF',
      jsonContent: {
        '31': { class_type: 'LoadImage', inputs: { image: 'placeholder.jpg' } },
        '134': { class_type: 'SaveImage', inputs: {} },
      },
      poseNodeId: 'x',
      upperNodeIds: [],
      garmentPhasePromptNode: 'x',
      workflowType: 'saree_step1',
      tryonPersonNodeId: opts.withPersonNode ? '1' : null,
      tryonGarmentNodeId: '31',
      tryonOutputNodeId: '134',
      isActive: opts.templateIsActive ?? true,
    })
    .returning();
  if (!wf) throw new Error('failed to create test saree step1 workflow template');

  const [garmentType] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: `flat-saree-${randomUUID()}`,
      label: 'Test Flat Saree',
      isActive: opts.isActive ?? true,
      requiresMannequinStep: true,
      mannequinWorkflowTemplateId: wf.id,
    })
    .returning();
  if (!garmentType) throw new Error('failed to create test flat-saree garment type');

  return { garmentTypeId: garmentType.id, workflowTemplateId: wf.id };
}

/**
 * Creates a dev tryon category plus the workflow template it points at.
 *
 * Mirrors createTestTryonCategory but targets the dev_tryon_categories table instead.
 */
export async function createTestDevTryonCategory(
  app: TestApp,
  opts: {
    slug: string;
    name?: string;
    isActive?: boolean;
    templateIsActive?: boolean;
    sortOrder?: number;
  },
) {
  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `wf-${randomUUID()}`,
      label: 'Test Dev Tryon WF',
      jsonContent: {},
      poseNodeId: 'x',
      upperNodeIds: [],
      garmentPhasePromptNode: 'x',
      workflowType: 'tryon',
      isActive: opts.templateIsActive ?? true,
    })
    .returning();
  if (!wf) throw new Error('failed to create test workflow template');

  const [cat] = await app.db
    .insert(schema.devTryonCategories)
    .values({
      name: opts.name ?? 'Test Dev Category',
      slug: opts.slug,
      workflowTemplateId: wf.id,
      isActive: opts.isActive ?? true,
      sortOrder: opts.sortOrder ?? 0,
    })
    .returning();
  if (!cat) throw new Error('failed to create test dev tryon category');

  return { categoryId: cat.id, workflowTemplateId: wf.id };
}

/**
 * Creates a dev_saree_mannequin_config row plus the saree_step1 workflow template it points at.
 *
 * Mirrors createTestSareeMannequinGarmentType but targets the dev_saree_mannequin_config
 * singleton config table instead of garment_subcategories.
 */
export async function createTestDevSareeMannequinConfig(
  app: TestApp,
  opts: { isActive?: boolean; templateIsActive?: boolean; withPersonNode?: boolean } = {},
) {
  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: `dev-saree-step1-${randomUUID()}`,
      label: 'Test Dev Saree Step1 WF',
      jsonContent: {
        '31': { class_type: 'LoadImage', inputs: { image: 'placeholder.jpg' } },
        '134': { class_type: 'SaveImage', inputs: {} },
      },
      poseNodeId: 'x',
      upperNodeIds: [],
      garmentPhasePromptNode: 'x',
      workflowType: 'saree_step1',
      tryonPersonNodeId: opts.withPersonNode ? '1' : null,
      tryonGarmentNodeId: '31',
      tryonOutputNodeId: '134',
      isActive: opts.templateIsActive ?? true,
    })
    .returning();
  if (!wf) throw new Error('failed to create test dev saree step1 workflow template');

  await app.db
    .insert(schema.devSareeMannequinConfig)
    .values({
      id: '00000000-0000-0000-0000-000000000002',
      workflowTemplateId: wf.id,
      isActive: opts.isActive ?? true,
    })
    .onConflictDoUpdate({
      target: schema.devSareeMannequinConfig.id,
      set: { workflowTemplateId: wf.id, isActive: opts.isActive ?? true, updatedAt: new Date() },
    });

  return { workflowTemplateId: wf.id };
}

export async function createTestBranch(
  app: TestApp,
  merchantId: string,
  opts: { name?: string; isActive?: boolean } = {},
) {
  const [branch] = await app.db
    .insert(schema.merchantBranches)
    .values({
      merchantId,
      name: opts.name ?? `Branch ${randomUUID().slice(0, 6)}`,
      isActive: opts.isActive ?? true,
    })
    .returning();
  if (!branch) throw new Error('failed to create test branch');
  return branch;
}

export async function memberAuthHeader(app: TestApp, userId: string) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);
  const token = await signAccess(secret, userId, { kind: 'access' }, '15m');
  return { authorization: `Bearer ${token}` };
}

export async function createTestStaff(
  app: TestApp,
  merchantId: string,
  branchId: string,
  opts: { isActive?: boolean } = {},
) {
  const [user] = await app.db
    .insert(schema.users)
    .values({
      email: `staff-${randomUUID()}@test.com`,
      displayName: 'Test Staff',
      emailVerified: true,
    })
    .returning();
  if (!user) throw new Error('failed to create staff user');
  await app.db.insert(schema.userCredits).values({ userId: user.id, balance: 0 });
  const [staff] = await app.db
    .insert(schema.merchantStaff)
    .values({ merchantId, branchId, userId: user.id, isActive: opts.isActive ?? true })
    .returning();
  if (!staff) throw new Error('failed to create staff row');
  return { staffId: staff.id, userId: user.id, auth: await memberAuthHeader(app, user.id) };
}

export async function createTestDevice(
  app: TestApp,
  merchantId: string,
  branchId: string,
  opts: { isActive?: boolean; name?: string } = {},
) {
  const token = `dvc_${randomBytes(32).toString('base64url')}`;
  const [device] = await app.db
    .insert(schema.merchantDevices)
    .values({
      merchantId,
      branchId,
      name: opts.name ?? `Device ${randomUUID().slice(0, 6)}`,
      deviceTokenHash: createHash('sha256').update(token).digest('hex'),
      isActive: opts.isActive ?? true,
    })
    .returning();
  if (!device) throw new Error('failed to create test device');
  return { deviceId: device.id, token, auth: { authorization: `Device ${token}` } };
}

/** A garment type wired to an active tryon workflow, as merchant-tryon.test.ts seeds it. */
export async function createTestGarmentType(app: TestApp) {
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
  const [category] = await app.db
    .insert(schema.tryonCategories)
    .values({
      name: `category-${randomUUID()}`,
      slug: `category-${randomUUID()}`,
      workflowTemplateId: template!.id,
      isActive: true,
    })
    .returning();
  const [garmentType] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: `shirt-${randomUUID()}`,
      label: 'Shirt',
      tryonCategoryId: category!.id,
    })
    .returning();
  return garmentType!;
}

export async function createTestCatalogItem(
  app: TestApp,
  merchantId: string,
  garmentTypeId: string,
) {
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
      subcategoryId: subcategory!.id,
      label: 'Red Shirt',
      actualPricePaise: 200000,
      offerPricePaise: 180000,
      r2Key: imageKey,
      thumbnailKey: thumbKey,
    })
    .returning();
  return item!;
}

/** A customer photo this merchant "presigned": object in storage + the redis owner record. */
export async function stageCustomerPhoto(app: TestApp, merchantId: string) {
  const r2Key = keys.merchantTryonInput(merchantId, randomUUID(), 'jpg');
  await app.storage.putObject(r2Key, Buffer.from('photo'), 'image/jpeg');
  await app.redis.set(`upload:owner:${r2Key}`, merchantId, 'EX', 600);
  return r2Key;
}

/**
 * Two-input (body + pallu) garment type: a drape template plus the category's ordinary
 * single-garment try-on template. Copied from merchant-tryon.test.ts's seedTwoInputGarmentType.
 */
export async function createTestTwoInputGarmentType(app: TestApp) {
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
      isActive: true,
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
      workflowTemplateId: tryonTemplate!.id,
      isActive: true,
    })
    .returning();
  const [garmentType] = await app.db
    .insert(schema.garmentSubcategories)
    .values({
      genderSlug: 'women',
      slug: `saree-${randomUUID()}`,
      label: 'Saree',
      tryonCategoryId: tryonCategory!.id,
      mannequinTwoInputWorkflowTemplateId: mannequinTemplate!.id,
    })
    .returning();
  return {
    garmentType: garmentType!,
    mannequinTemplate: mannequinTemplate!,
    tryonTemplate: tryonTemplate!,
  };
}

export async function createTestCatalogItemWithSecondImage(
  app: TestApp,
  merchantId: string,
  garmentTypeId: string,
) {
  const [subcategory] = await app.db
    .insert(schema.merchantCatalogSubcategories)
    .values({ merchantId, category: 'women', name: 'Sarees', garmentSubcategoryId: garmentTypeId })
    .returning();
  const base = `merchant-catalog/${merchantId}/${randomUUID()}`;
  const k = {
    image: `${base}/image.jpg`,
    thumb: `${base}/thumb.jpg`,
    second: `${base}/second.jpg`,
    secondThumb: `${base}/second-thumb.jpg`,
  };
  for (const key of Object.values(k)) {
    await app.storage.putObject(key, Buffer.from('img'), 'image/jpeg');
  }
  const [item] = await app.db
    .insert(schema.merchantCatalogItems)
    .values({
      merchantId,
      subcategoryId: subcategory!.id,
      label: 'Two-Input Saree',
      actualPricePaise: 200000,
      offerPricePaise: 180000,
      r2Key: k.image,
      thumbnailKey: k.thumb,
      secondR2Key: k.second,
      secondThumbnailKey: k.secondThumb,
    })
    .returning();
  return item!;
}
