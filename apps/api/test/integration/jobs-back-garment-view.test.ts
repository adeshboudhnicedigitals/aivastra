import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

// Covers resolveTryonPlan's garmentView='back' routing in
// apps/api/src/modules/jobs/create.ts: a back-facing pose must be fed the
// customer's BACK-view garment photo, not the front one already required for
// every job — and a merchant/Shopify-routed job (which never has a back photo
// to supply) is rejected by the exact same check, not a separate guard. See
// docs/superpowers/plans/2026-09-29-studio-back-pose-garment-view.md, Task 6.
describe('jobs — back-view garment routing', () => {
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
    // assertOwnsUploadKey (in verifyGarmentKey) checks the upload actually
    // exists in storage — mock it out like jobs-create.test.ts does.
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    if (realHeadObject) app.storage.headObject = realHeadObject;
  });

  // Distinct RFC 5737 TEST-NET-1 address per registerUser call keeps each
  // one in its own rate-limit bucket — same fix jobs-create.test.ts uses.
  let registerUserIpCounter = 0;
  async function registerUser(email: string) {
    const remoteAddress = `192.0.2.${++registerUserIpCounter}`;
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      remoteAddress,
      payload: { displayName: 'Back Garment User', email, password: 'password123' },
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
      userId: JSON.parse(atob(login.json().accessToken.split('.')[1])).sub as string,
    };
  }

  async function seedCreditPlan(slug: string) {
    await app.db
      .insert(schema.creditPlans)
      .values({ slug, name: slug, credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
  }

  async function grantCredits(userId: string, amount: number) {
    await app.db
      .insert(schema.userCredits)
      .values({ userId, balance: amount })
      .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: amount } });
  }

  async function bindUploadKey(userId: string, key: string) {
    await app.redis.set(`upload:owner:${key}`, userId, 'EX', 3600);
  }

  // INPUT_GARMENT_KEY only requires a UUID-shaped path segment, not literally
  // the caller's userId — randomUUID() gives each key in a test its own
  // distinct value, so a front and a back key are never accidentally equal.
  function freshGarmentKey() {
    return `inputs/${randomUUID()}/garment.jpg`;
  }

  async function seedWorkflow(opts: {
    slug: string;
    upperNodeIds: string[];
    lowerNodeId: string | null;
    garmentView: 'front' | 'back';
  }) {
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: opts.slug,
        label: opts.slug,
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: opts.upperNodeIds,
        lowerNodeId: opts.lowerNodeId,
        garmentPhasePromptNode: '6',
        garmentView: opts.garmentView,
      })
      .returning();
    if (!wf) throw new Error('workflow not created');
    return wf;
  }

  async function seedPose(label: string, workflowTemplateId: string) {
    const [p] = await app.db
      .insert(schema.modelPoseAssets)
      .values({ label, r2Key: `${label}.jpg`, thumbnailKey: `${label}.jpg`, workflowTemplateId })
      .returning();
    if (!p) throw new Error('pose not created');
    return p;
  }

  async function seedFaceAndBackground(suffix: string) {
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
    if (!face || !background) throw new Error('face/background not created');
    return { faceId: face.id, backgroundId: background.id };
  }

  async function seedLowerCatalogItem(suffix: string) {
    const [catalogType] = await app.db
      .insert(schema.catalogTypes)
      .values({ slug: `back-view-lower-${suffix}`, label: 'Lower' })
      .returning();
    if (!catalogType) throw new Error('catalog type not created');
    const [category] = await app.db
      .insert(schema.catalogCategories)
      .values({ typeId: catalogType.id, slug: `pants-${suffix}`, label: 'Pants' })
      .returning();
    if (!category) throw new Error('catalog category not created');
    const [item] = await app.db
      .insert(schema.catalogItems)
      .values({
        categoryId: category.id,
        type: 'lower',
        genderSlug: 'women',
        label: 'Test pants',
        r2Key: `catalog/pants-${suffix}.jpg`,
        thumbnailKey: `catalog/pants-thumb-${suffix}.jpg`,
      })
      .returning();
    if (!item) throw new Error('catalog item not created');
    return item;
  }

  it('rejects a back-view pose submitted with only the front upper photo', async () => {
    const sfx = `${Date.now()}-1`;
    await seedCreditPlan('free');
    const { token, userId } = await registerUser(`back-upper-missing-${sfx}@x.com`);
    await grantCredits(userId, 100);
    const { faceId, backgroundId } = await seedFaceAndBackground(sfx);
    const wf = await seedWorkflow({
      slug: `back-wf-${sfx}`,
      upperNodeIds: ['1'],
      lowerNodeId: '7',
      garmentView: 'back',
    });
    const pose = await seedPose(`back-pose-${sfx}`, wf.id);
    const frontKey = freshGarmentKey();
    await bindUploadKey(userId, frontKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: { upperGarmentKey: frontKey, faceId, looks: [{ poseId: pose.id, backgroundId }] },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('back-view upper garment');
  });

  it('rejects a lower-only back-view pose missing its back-view lower photo', async () => {
    // A back-view lower photo is only ever required for a genuinely lower-only
    // role (jeans, baggy — no upper node at all). A combined upper+lower pose's
    // lower role always uses the normal front/catalog resolution instead, even
    // when the pose itself is back-facing — see the "combined upper+lower back
    // pose only needs the upper back photo" test below.
    const sfx = `${Date.now()}-2`;
    await seedCreditPlan('free');
    const { token, userId } = await registerUser(`back-lower-only-missing-${sfx}@x.com`);
    await grantCredits(userId, 100);
    const { faceId, backgroundId } = await seedFaceAndBackground(sfx);
    const wf = await seedWorkflow({
      slug: `back-lower-only-wf-${sfx}`,
      upperNodeIds: [],
      lowerNodeId: '7',
      garmentView: 'back',
    });
    const pose = await seedPose(`back-lower-only-pose-${sfx}`, wf.id);
    // CreateTryOnJobInputs still requires SOME upperGarmentKey (the mannequinJobId
    // XOR), even though this pose's workflow has no upper node and never consumes it.
    const frontKey = freshGarmentKey();
    await bindUploadKey(userId, frontKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: { upperGarmentKey: frontKey, faceId, looks: [{ poseId: pose.id, backgroundId }] },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('back-view lower garment');
  });

  it('rejects a lowerCatalogId as the source for a lower-only back-view pose — catalog items have no back photo', async () => {
    const sfx = `${Date.now()}-3`;
    await seedCreditPlan('free');
    const { token, userId } = await registerUser(`back-lower-only-catalog-${sfx}@x.com`);
    await grantCredits(userId, 100);
    const { faceId, backgroundId } = await seedFaceAndBackground(sfx);
    const wf = await seedWorkflow({
      slug: `back-lower-only-wf-${sfx}`,
      upperNodeIds: [],
      lowerNodeId: '7',
      garmentView: 'back',
    });
    const pose = await seedPose(`back-lower-only-pose-${sfx}`, wf.id);
    const catalogItem = await seedLowerCatalogItem(sfx);
    const frontKey = freshGarmentKey();
    await bindUploadKey(userId, frontKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: frontKey,
          lowerCatalogId: catalogItem.id,
          faceId,
          looks: [{ poseId: pose.id, backgroundId }],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('back-view lower garment');
  });

  it('a combined upper+lower back pose only needs the upper back photo — its lower keeps the normal front/catalog flow', async () => {
    const sfx = `${Date.now()}-4`;
    await seedCreditPlan('free');
    const { token, userId } = await registerUser(`back-full-${sfx}@x.com`);
    await grantCredits(userId, 100);
    const { faceId, backgroundId } = await seedFaceAndBackground(sfx);
    const wf = await seedWorkflow({
      slug: `back-wf-${sfx}`,
      upperNodeIds: ['1'],
      lowerNodeId: '7',
      garmentView: 'back',
    });
    const pose = await seedPose(`back-pose-${sfx}`, wf.id);
    const catalogItem = await seedLowerCatalogItem(sfx);
    const frontKey = freshGarmentKey();
    const upperBackKey = freshGarmentKey();
    await bindUploadKey(userId, frontKey);
    await bindUploadKey(userId, upperBackKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: frontKey,
          upperGarmentBackKey: upperBackKey,
          lowerCatalogId: catalogItem.id,
          faceId,
          looks: [{ poseId: pose.id, backgroundId }],
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
    expect(inputs?.upperGarmentKey).toBe(upperBackKey);
    expect(inputs?.upperGarmentKey).not.toBe(frontKey);
    expect(inputs?.lowerCatalogId).toBe(catalogItem.id);
    expect(inputs?.lowerGarmentKey).toBeNull();
  });

  it('routes the correct UPPER photo per look when a batch mixes a front pose and a back pose', async () => {
    // Both poses have an upper role, so their lower role resolves the same way
    // (normal front/catalog flow) regardless of garmentView — only the upper
    // role differs per look here. See the lower-only tests above for where a
    // back-view lower photo actually applies.
    const sfx = `${Date.now()}-5`;
    await seedCreditPlan('free');
    const { token, userId } = await registerUser(`back-mixed-batch-${sfx}@x.com`);
    await grantCredits(userId, 100);
    const { faceId, backgroundId } = await seedFaceAndBackground(sfx);
    const frontWf = await seedWorkflow({
      slug: `front-wf-${sfx}`,
      upperNodeIds: ['1'],
      lowerNodeId: '7',
      garmentView: 'front',
    });
    const backWf = await seedWorkflow({
      slug: `back-wf-${sfx}`,
      upperNodeIds: ['1'],
      lowerNodeId: '7',
      garmentView: 'back',
    });
    const frontPose = await seedPose(`front-pose-${sfx}`, frontWf.id);
    const backPose = await seedPose(`back-pose-${sfx}`, backWf.id);
    const catalogItem = await seedLowerCatalogItem(sfx);

    const frontUpperKey = freshGarmentKey();
    const backUpperKey = freshGarmentKey();
    await bindUploadKey(userId, frontUpperKey);
    await bindUploadKey(userId, backUpperKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: frontUpperKey,
          upperGarmentBackKey: backUpperKey,
          lowerCatalogId: catalogItem.id, // shared lower — both looks' upper role has a node
          faceId,
          looks: [
            { poseId: frontPose.id, backgroundId },
            { poseId: backPose.id, backgroundId },
          ],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });
    expect(res.statusCode).toBe(201);
    const { jobIds } = res.json();
    expect(jobIds).toHaveLength(2);

    const [frontInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobIds[0]));
    expect(frontInputs?.upperGarmentKey).toBe(frontUpperKey);
    expect(frontInputs?.lowerCatalogId).toBe(catalogItem.id);
    expect(frontInputs?.lowerGarmentKey).toBeNull();

    const [backInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobIds[1]));
    expect(backInputs?.upperGarmentKey).toBe(backUpperKey);
    expect(backInputs?.upperGarmentKey).not.toBe(frontInputs?.upperGarmentKey);
    expect(backInputs?.lowerCatalogId).toBe(catalogItem.id);
    expect(backInputs?.lowerGarmentKey).toBeNull();
  });

  it('a lower-only back pose only requires the back-view lower photo, not an upper one', async () => {
    const sfx = `${Date.now()}-6`;
    await seedCreditPlan('free');
    const { token, userId } = await registerUser(`back-lower-only-${sfx}@x.com`);
    await grantCredits(userId, 100);
    const { faceId, backgroundId } = await seedFaceAndBackground(sfx);
    const wf = await seedWorkflow({
      slug: `back-lower-only-wf-${sfx}`,
      upperNodeIds: [],
      lowerNodeId: '7',
      garmentView: 'back',
    });
    const pose = await seedPose(`back-lower-only-pose-${sfx}`, wf.id);
    // CreateTryOnJobInputs still requires SOME upperGarmentKey (the mannequinJobId
    // XOR), even though this pose's workflow has no upper node and never consumes
    // it — mirrors how the front-side lower-only flow reuses the same upload.
    const frontKey = freshGarmentKey();
    const lowerBackKey = freshGarmentKey();
    await bindUploadKey(userId, frontKey);
    await bindUploadKey(userId, lowerBackKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: frontKey,
          lowerGarmentBackKey: lowerBackKey,
          faceId,
          looks: [{ poseId: pose.id, backgroundId }],
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
    // No upper role at all for this pose — the front key is never stored either.
    expect(inputs?.upperGarmentKey).toBeNull();
    expect(inputs?.lowerGarmentKey).toBe(lowerBackKey);
  });

  it('a merchant/Shopify-style caller that never supplies a back key is rejected by the same check, not a silent front-photo fallback', async () => {
    // Simulates the structural gap resolveTryonPlan relies on for merchant
    // safety: a caller whose body simply has no upperGarmentBackKey/
    // lowerGarmentBackKey field populated (merchant catalog auto-generation
    // constructs its inputs from a single synced product photo and has no
    // concept of a "back" key at all) must fail loudly, not ship a front
    // photo into a back-facing graph.
    const sfx = `${Date.now()}-7`;
    await seedCreditPlan('free');
    const { token, userId } = await registerUser(`back-no-guard-bypass-${sfx}@x.com`);
    await grantCredits(userId, 100);
    const { faceId, backgroundId } = await seedFaceAndBackground(sfx);
    const wf = await seedWorkflow({
      slug: `back-wf-${sfx}`,
      upperNodeIds: ['1'],
      lowerNodeId: null,
      garmentView: 'back',
    });
    const pose = await seedPose(`back-pose-${sfx}`, wf.id);
    const onlyPhotoTheCallerHas = freshGarmentKey();
    await bindUploadKey(userId, onlyPhotoTheCallerHas);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/tryon',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        inputs: {
          upperGarmentKey: onlyPhotoTheCallerHas,
          faceId,
          looks: [{ poseId: pose.id, backgroundId }],
        },
        aspectRatio: '1:1',
        resolution: '2K',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('back-view upper garment');
  });
});
