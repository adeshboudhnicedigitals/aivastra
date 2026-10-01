import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('jobs-accessory', () => {
  let c: Containers;
  let app: TestApp;
  let realHeadObject: typeof app.storage.headObject | undefined;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    realHeadObject = app.storage.headObject?.bind(app.storage);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  beforeEach(async () => {
    await app.redis.del('jobs:normal');
    await app.redis.del('jobs:priority');
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    if (realHeadObject) app.storage.headObject = realHeadObject;
  });

  let registerUserIpCounter = 0;
  async function registerUser(email: string) {
    const remoteAddress = `192.0.2.${++registerUserIpCounter}`;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      remoteAddress,
      payload: { displayName: 'Jobs Accessory User', email, password: 'password123' },
    });
    const [user] = await app.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (!user) throw new Error('user not found');
    await app.db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.id, user.id));
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress,
      payload: { email, password: 'password123' },
    });
    return {
      token: login.json().accessToken,
      userId: JSON.parse(atob(login.json().accessToken.split('.')[1])).sub,
    };
  }

  async function seedFaceAndLook(suffix = '') {
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({
        gender: 'women',
        label: `Face${suffix}`,
        r2Key: `f${suffix}.jpg`,
        thumbnailKey: `f${suffix}.jpg`,
      })
      .returning();
    const [background] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ label: `Bg${suffix}`, r2Key: `b${suffix}.jpg`, thumbnailKey: `b${suffix}.jpg` })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({ label: `Pose${suffix}`, r2Key: `p${suffix}.jpg`, thumbnailKey: `p${suffix}.jpg` })
      .returning();
    return { faceId: face.id, backgroundId: background.id, poseId: pose.id };
  }

  async function seedCreditPlan(slug: string) {
    await app.db
      .insert(schema.creditPlans)
      .values({ slug, name: slug, credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
  }

  async function bindUploadKey(userId: string, key: string) {
    await app.redis.set(`upload:owner:${key}`, userId, 'EX', 3600);
  }

  async function grantCredits(userId: string, amount: number) {
    await app.db
      .insert(schema.userCredits)
      .values({ userId, balance: amount })
      .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: amount } });
  }

  async function seedAccessoryItem(
    suffix: string,
    opts: { categoryId?: number; isActive?: boolean } = {},
  ) {
    const [item] = await app.db
      .insert(schema.catalogItems)
      .values({
        type: 'accessory',
        genderSlug: 'women',
        label: `Accessory ${suffix}`,
        r2Key: `accessory-${suffix}.jpg`,
        thumbnailKey: `accessory-${suffix}-thumb.jpg`,
        isActive: opts.isActive ?? true,
        categoryId: opts.categoryId ?? null,
      })
      .returning();
    return item;
  }

  it('accepts a valid accessory catalog item and stores it on job_inputs', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('accessory-ok@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('-ok');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);
    const item = await seedAccessoryItem('ok');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId,
          looks: [{ poseId, backgroundId }],
          accessoryCatalogIds: [item.id],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });

    expect(res.statusCode).toBe(201);
    const { jobIds } = res.json();
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobIds[0]));
    expect(inputs.accessoryCatalogIds).toEqual([item.id]);
  });

  it('rejects an inactive accessory catalog item', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('accessory-inactive@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('-inactive');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);
    const item = await seedAccessoryItem('inactive', { isActive: false });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId,
          looks: [{ poseId, backgroundId }],
          accessoryCatalogIds: [item.id],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects two selected items from the same accessory category', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('accessory-dup-category@x.com');
    await grantCredits(userId, 100);
    const { faceId, backgroundId, poseId } = await seedFaceAndLook('-dup');
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);
    const [accessoryType] = await app.db
      .select()
      .from(schema.catalogTypes)
      .where(eq(schema.catalogTypes.slug, 'accessory'));
    const [category] = await app.db
      .insert(schema.catalogCategories)
      .values({ typeId: accessoryType.id, slug: 'necklaces-dup-test', label: 'Necklaces' })
      .returning();
    const itemA = await seedAccessoryItem('dup-a', { categoryId: category.id });
    const itemB = await seedAccessoryItem('dup-b', { categoryId: category.id });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId,
          looks: [{ poseId, backgroundId }],
          accessoryCatalogIds: [itemA.id, itemB.id],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('does not require accessoryCatalogIds even when the resolved pose workflow has an accessoryNodeId', async () => {
    await seedCreditPlan('free');
    const { token, userId } = await registerUser('accessory-optional@x.com');
    await grantCredits(userId, 100);
    const [workflow] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `accessory-optional-wf-${Date.now()}`,
        label: 'Accessory optional workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
        accessoryNodeId: '9',
      })
      .returning();
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({ gender: 'women', label: 'Face-opt', r2Key: 'f-opt.jpg', thumbnailKey: 'f-opt.jpg' })
      .returning();
    const [background] = await app.db
      .insert(schema.modelBackgrounds)
      .values({ label: 'Bg-opt', r2Key: 'b-opt.jpg', thumbnailKey: 'b-opt.jpg' })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        label: 'Pose-opt',
        r2Key: 'p-opt.jpg',
        thumbnailKey: 'p-opt.jpg',
        workflowTemplateId: workflow.id,
      })
      .returning();
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: garmentKey,
          faceId: face.id,
          looks: [{ poseId: pose.id, backgroundId: background.id }],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });

    expect(res.statusCode).toBe(201);
  });
});
