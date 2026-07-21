import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('POST /v1/jobs/saree-mannequin', () => {
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

  async function seedCreditPlan(slug: string, watermark: boolean) {
    await app.db
      .insert(schema.creditPlans)
      .values({ slug, name: slug, credits: 1000, basePaise: 0, watermark })
      .onConflictDoUpdate({ target: schema.creditPlans.slug, set: { watermark } });
  }

  async function seedFlatSareeGarmentType(
    requiresMannequinStep: boolean,
    mannequinWorkflowTemplateId: string | null,
  ) {
    const [gt] = await app.db
      .insert(schema.garmentSubcategories)
      .values({
        genderSlug: 'women',
        slug: `flat-saree-${Date.now()}`,
        label: 'Flat Saree',
        requiresMannequinStep,
        mannequinWorkflowTemplateId,
      })
      .returning();
    return gt.id;
  }

  async function seedFace() {
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({ gender: 'women', label: 'F', r2Key: 'f.jpg', thumbnailKey: 'f.jpg' })
      .returning();
    return face.id;
  }

  async function seedActiveBackground() {
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
    return bg.id;
  }

  async function seedActivePose() {
    const [pose] = await app.db
      .insert(schema.modelPoseAssets)
      .values({
        genderSlug: 'women',
        label: 'Pose',
        r2Key: 'pose.jpg',
        thumbnailKey: 'pose.jpg',
        isActive: true,
      })
      .returning();
    return pose.id;
  }

  it('creates a 0-credit mannequin job + PENDING_MANNEQUIN step-2 job(s), only the mannequin job enqueued', async () => {
    await seedCreditPlan('free', false);
    const { token, userId } = await registerUser('mannequin-happy@x.com');
    await grantCredits(userId, 100);
    const faceId = await seedFace();
    const backgroundId = await seedActiveBackground();
    const poseId = await seedActivePose();
    const garmentTypeId = await seedFlatSareeGarmentType(true, null);
    const [wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `saree-step1-${Date.now()}`,
        label: 'Step1',
        jsonContent: {},
        workflowType: 'saree_step1',
        faceNodeId: '',
        poseNodeId: '',
        bgNodeId: '',
        upperNodeIds: [],
        facePhasePromptNode: '',
        garmentPhasePromptNode: '',
        tryonPersonNodeId: '1',
        tryonGarmentNodeId: '2',
        tryonOutputNodeId: '3',
      })
      .returning();
    const [step2Wf] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `saree-step2-${Date.now()}`,
        label: 'Step2',
        jsonContent: {},
        workflowType: 'saree_step2',
        faceNodeId: '',
        poseNodeId: '',
        bgNodeId: '',
        upperNodeIds: ['10'],
        facePhasePromptNode: '',
        garmentPhasePromptNode: '',
        tryonPersonNodeId: '1',
        tryonGarmentNodeId: '2',
        tryonOutputNodeId: '3',
      })
      .returning();
    await app.db
      .update(schema.garmentSubcategories)
      .set({ mannequinWorkflowTemplateId: wf.id, sareeStep2WorkflowTemplateId: step2Wf.id })
      .where(eq(schema.garmentSubcategories.id, garmentTypeId));
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/saree-mannequin',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        garmentTypeId,
        garmentKey,
        faceId,
        step2: {
          inputs: { faceId, backgroundId, poseIds: [poseId], garmentTypeId },
          aspectRatio: '1:1',
          resolution: 'HD',
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const { catalogueId, jobIds } = res.json();
    expect(jobIds).toHaveLength(1);
    expect(catalogueId).toBeTruthy();

    const [step2Job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobIds[0]));
    expect(step2Job?.status).toBe('PENDING_MANNEQUIN');
    expect(step2Job?.creditsCharged).toBeGreaterThan(0);
    expect(step2Job?.catalogueId).toBe(catalogueId);

    const [step2Inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobIds[0]));
    expect(step2Inputs?.upperGarmentKey).toBeNull();
    const step2Params = step2Inputs?.params as { mannequinJobId?: string };
    expect(step2Params?.mannequinJobId).toBeTruthy();

    const [mannequinJob] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, step2Params.mannequinJobId as string));
    expect(mannequinJob?.status).toBe('QUEUED');
    expect(mannequinJob?.source).toBe('saree_mannequin');
    expect(mannequinJob?.creditsCharged).toBe(0);

    // Only the mannequin job is enqueued — the step-2 job waits for promotion.
    const streamLen = await app.redis.xlen('jobs:normal');
    expect(streamLen).toBe(1);

    const [{ balance }] = await app.db
      .select({ balance: schema.userCredits.balance })
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    // Granted 100, step2Job.creditsCharged deducted once (2K-tier cost since
    // 1:1 @ default maxOutputPx resolves to 2K — 35 credits by default config).
    expect(balance).toBe(100 - (step2Job?.creditsCharged ?? 0));
  });

  it('rejects a garment type that does not require a mannequin step', async () => {
    const { token, userId } = await registerUser('mannequin-wrong-type@x.com');
    const faceId = await seedFace();
    const garmentTypeId = await seedFlatSareeGarmentType(false, null);
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/saree-mannequin',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        garmentTypeId,
        garmentKey,
        faceId,
        step2: {
          inputs: {
            faceId,
            backgroundId: '00000000-0000-0000-0000-000000000000',
            poseIds: ['00000000-0000-0000-0000-000000000000'],
          },
          aspectRatio: '1:1',
          resolution: 'HD',
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects when the garment type has no mannequin workflow configured', async () => {
    const { token, userId } = await registerUser('mannequin-no-workflow@x.com');
    const faceId = await seedFace();
    const garmentTypeId = await seedFlatSareeGarmentType(true, null);
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/saree-mannequin',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        garmentTypeId,
        garmentKey,
        faceId,
        step2: {
          inputs: {
            faceId,
            backgroundId: '00000000-0000-0000-0000-000000000000',
            poseIds: ['00000000-0000-0000-0000-000000000000'],
          },
          aspectRatio: '1:1',
          resolution: 'HD',
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a garmentKey not owned by the caller', async () => {
    const { token } = await registerUser('mannequin-forbidden@x.com');
    const faceId = await seedFace();
    const garmentTypeId = await seedFlatSareeGarmentType(true, null);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/saree-mannequin',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        garmentTypeId,
        garmentKey: 'inputs/00000000-0000-0000-0000-000000000000/garment.jpg',
        faceId,
        step2: {
          inputs: {
            faceId,
            backgroundId: '00000000-0000-0000-0000-000000000000',
            poseIds: ['00000000-0000-0000-0000-000000000000'],
          },
          aspectRatio: '1:1',
          resolution: 'HD',
        },
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
