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

  it('creates a 0-credit job with kind=saree_mannequin, enqueued', async () => {
    const { token, userId } = await registerUser('mannequin-happy@x.com');
    const faceId = await seedFace();
    const garmentTypeId = await seedFlatSareeGarmentType(true, null);
    // mannequinWorkflowTemplateId set separately so we can assert the CONFIG error path too
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
    await app.db
      .update(schema.garmentSubcategories)
      .set({ mannequinWorkflowTemplateId: wf.id })
      .where(eq(schema.garmentSubcategories.id, garmentTypeId));
    const garmentKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, garmentKey);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/saree-mannequin',
      headers: { authorization: `Bearer ${token}` },
      payload: { garmentTypeId, garmentKey, faceId },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job?.creditsCharged).toBe(0);
    expect(job?.source).toBe('saree_mannequin');
    expect(job?.status).toBe('QUEUED');

    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    expect(inputs?.upperGarmentKey).toBe(garmentKey);
    expect(inputs?.faceId).toBe(faceId);
    expect((inputs?.params as { kind?: string })?.kind).toBe('saree_mannequin');

    const streamLen = await app.redis.xlen('jobs:normal');
    expect(streamLen).toBe(1);
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
      payload: { garmentTypeId, garmentKey, faceId },
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
      payload: { garmentTypeId, garmentKey, faceId },
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
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
