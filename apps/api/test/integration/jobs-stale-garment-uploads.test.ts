import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// A studio form that keeps a lower/dupatta upload from a previously selected garment
// type must not have it reach the job: the server drops a lower upload the type doesn't
// take (it would override the catalog lower) and a third upload the type doesn't take.
describe('POST /v1/jobs/tryon — stale lower/third uploads from an earlier garment type', () => {
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
  beforeEach(async () => {
    await app.redis.del('jobs:normal');
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });

  async function registerUser(email: string) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, emailVerified: true, tier: 'free' })
      .returning();
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const accessToken = await signAccess(secret, user.id, { kind: 'access' }, app.env.JWT_EXPIRY);
    return { token: accessToken, userId: user.id };
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

  async function seedCreditPlan() {
    await app.db
      .insert(schema.creditPlans)
      .values({ slug: 'free', name: 'free', credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing();
  }

  const newKey = () => `inputs/${randomUUID()}/garment.jpg`;

  async function seedScenario(opts: {
    upperNodeIds: string[];
    requiresLowerUpload: boolean;
    requiresThirdUpload: boolean;
  }) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `stale-${stamp}`,
        label: 'Stale keys',
        jsonContent: {},
        workflowType: 'regular',
        faceNodeId: '',
        poseNodeId: '1',
        bgNodeId: '',
        upperNodeIds: opts.upperNodeIds,
        lowerNodeId: '7',
        thirdNodeId: '11',
        facePhasePromptNode: '',
        garmentPhasePromptNode: '',
      })
      .returning();
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({ gender: 'women', label: 'F', r2Key: 'f.jpg', thumbnailKey: 'f.jpg' })
      .returning();
    const [bg] = await app.db
      .insert(schema.modelBackgrounds)
      .values({
        genderSlug: 'women',
        label: 'BG',
        r2Key: 'bg.jpg',
        thumbnailKey: 'bg.jpg',
        isActive: true,
      })
      .returning();
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        genderSlug: 'women',
        label: 'Pose',
        r2Key: 'pose.jpg',
        thumbnailKey: 'pose.jpg',
        isActive: true,
        workflowTemplateId: wf.id,
      })
      .returning();
    const [gt] = await app.db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'women',
        slug: `stale-${stamp}`,
        label: 'Shirt',
        requiresLowerUpload: opts.requiresLowerUpload,
        requiresThirdUpload: opts.requiresThirdUpload,
      })
      .returning();
    const [type] = await app.db
      .insert(schema.catalogTypes)
      .values({ slug: `stale-lower-${stamp}`, label: 'Lower' })
      .returning();
    const [category] = await app.db
      .insert(schema.catalogCategories)
      .values({ typeId: type.id, slug: `pants-${stamp}`, label: 'Pants' })
      .returning();
    const [lowerItem] = await app.db
      .insert(schema.catalogItems)
      .values({
        categoryId: category.id,
        type: 'lower',
        genderSlug: 'women',
        label: 'Pants',
        r2Key: `catalog/pants-${stamp}.jpg`,
        thumbnailKey: `catalog/pants-thumb-${stamp}.jpg`,
      })
      .returning();
    return {
      faceId: face.id,
      backgroundId: bg.id,
      poseId: pose.id,
      garmentTypeId: gt.id,
      lowerCatalogId: lowerItem.id,
    };
  }

  async function post(token: string, inputs: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: { inputs, aspectRatio: '1:1', resolution: '2K' },
    });
  }

  async function jobInputsFor(jobId: string) {
    const [row] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    return row;
  }

  it('a stale lower upload does not override the catalog lower on a combined upper+lower pose', async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('stale-lower@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({
      upperNodeIds: ['10'],
      requiresLowerUpload: false,
      requiresThirdUpload: false,
    });
    const upper = newKey();
    const staleLower = newKey();
    await Promise.all([upper, staleLower].map((k) => bindUploadKey(userId, k)));

    const res = await post(token, {
      upperGarmentKey: upper,
      lowerGarmentKey: staleLower,
      lowerCatalogId: s.lowerCatalogId,
      faceId: s.faceId,
      backgroundId: s.backgroundId,
      poseIds: [s.poseId],
      garmentTypeId: s.garmentTypeId,
    });

    expect(res.statusCode).toBeLessThan(300);
    const row = await jobInputsFor(res.json().jobIds[0]);
    expect(row?.lowerGarmentKey).toBeNull();
    expect(row?.lowerCatalogId).toBe(s.lowerCatalogId);
  });

  it('an expired (unbound) stale lower key is dropped rather than failing ownership', async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('stale-lower-expired@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({
      upperNodeIds: ['10'],
      requiresLowerUpload: false,
      requiresThirdUpload: false,
    });
    const upper = newKey();
    await bindUploadKey(userId, upper);

    const res = await post(token, {
      upperGarmentKey: upper,
      lowerGarmentKey: newKey(), // never bound — its upload session "expired"
      lowerCatalogId: s.lowerCatalogId,
      faceId: s.faceId,
      backgroundId: s.backgroundId,
      poseIds: [s.poseId],
      garmentTypeId: s.garmentTypeId,
    });

    expect(res.statusCode).toBeLessThan(300);
    expect((await jobInputsFor(res.json().jobIds[0]))?.lowerGarmentKey).toBeNull();
  });

  it('keeps the lower upload for a garment type that requires one', async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('lower-required@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({
      upperNodeIds: ['10'],
      requiresLowerUpload: true,
      requiresThirdUpload: false,
    });
    const upper = newKey();
    const lower = newKey();
    await Promise.all([upper, lower].map((k) => bindUploadKey(userId, k)));

    const res = await post(token, {
      upperGarmentKey: upper,
      lowerGarmentKey: lower,
      faceId: s.faceId,
      backgroundId: s.backgroundId,
      poseIds: [s.poseId],
      garmentTypeId: s.garmentTypeId,
    });

    expect(res.statusCode).toBeLessThan(300);
    expect((await jobInputsFor(res.json().jobIds[0]))?.lowerGarmentKey).toBe(lower);
  });

  it('keeps the single upload as the lower garment for a lower-only pose', async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('lower-only@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({
      upperNodeIds: [],
      requiresLowerUpload: false,
      requiresThirdUpload: false,
    });
    const garment = newKey();
    await bindUploadKey(userId, garment);

    // The studio sends the one upload box in both slots for a lower-only role.
    const res = await post(token, {
      upperGarmentKey: garment,
      lowerGarmentKey: garment,
      faceId: s.faceId,
      backgroundId: s.backgroundId,
      poseIds: [s.poseId],
      garmentTypeId: s.garmentTypeId,
    });

    expect(res.statusCode).toBeLessThan(300);
    expect((await jobInputsFor(res.json().jobIds[0]))?.lowerGarmentKey).toBe(garment);
  });

  it('nulls a stale dupatta for a garment type that does not take a third upload', async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('stale-third@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({
      upperNodeIds: ['10'],
      requiresLowerUpload: false,
      requiresThirdUpload: false,
    });
    const upper = newKey();
    await bindUploadKey(userId, upper);

    const res = await post(token, {
      upperGarmentKey: upper,
      thirdGarmentKey: newKey(), // stale; never bound
      lowerCatalogId: s.lowerCatalogId,
      faceId: s.faceId,
      backgroundId: s.backgroundId,
      poseIds: [s.poseId],
      garmentTypeId: s.garmentTypeId,
    });

    expect(res.statusCode).toBeLessThan(300);
    expect((await jobInputsFor(res.json().jobIds[0]))?.thirdGarmentKey).toBeNull();
  });

  it('keeps the third upload for a garment type that requires one', async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('third-required@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({
      upperNodeIds: ['10'],
      requiresLowerUpload: false,
      requiresThirdUpload: true,
    });
    const upper = newKey();
    const third = newKey();
    await Promise.all([upper, third].map((k) => bindUploadKey(userId, k)));

    const res = await post(token, {
      upperGarmentKey: upper,
      thirdGarmentKey: third,
      lowerCatalogId: s.lowerCatalogId,
      faceId: s.faceId,
      backgroundId: s.backgroundId,
      poseIds: [s.poseId],
      garmentTypeId: s.garmentTypeId,
    });

    expect(res.statusCode).toBeLessThan(300);
    expect((await jobInputsFor(res.json().jobIds[0]))?.thirdGarmentKey).toBe(third);
  });

  it('without a garmentTypeId nothing is dropped — the server cannot tell what the type takes', async () => {
    await seedCreditPlan();
    const { token, userId } = await registerUser('no-type@x.com');
    await grantCredits(userId, 100);
    const s = await seedScenario({
      upperNodeIds: ['10'],
      requiresLowerUpload: false,
      requiresThirdUpload: false,
    });
    const upper = newKey();
    const lower = newKey();
    const third = newKey();
    await Promise.all([upper, lower, third].map((k) => bindUploadKey(userId, k)));

    const res = await post(token, {
      upperGarmentKey: upper,
      lowerGarmentKey: lower,
      thirdGarmentKey: third,
      faceId: s.faceId,
      looks: [{ poseId: s.poseId, backgroundId: s.backgroundId }],
    });

    expect(res.statusCode).toBeLessThan(300);
    const row = await jobInputsFor(res.json().jobIds[0]);
    expect(row?.lowerGarmentKey).toBe(lower);
    expect(row?.thirdGarmentKey).toBe(third);
  });
});
