import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// Garment-extract pre-step: admin upload detection, per-garment-type enablement
// rules, and what createJob snapshots into job_inputs.params for the dispatcher.
describe('garment extract (ghost mannequin pre-step)', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app, 'SUPER_ADMIN');
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  beforeEach(async () => {
    await app.redis.del('jobs:normal');
    // verifyGarmentKey HEADs the upload; no real object is needed for these tests.
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;

  const extractJson = (extra: Record<string, unknown> = {}) => ({
    '1': { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } },
    '2': { class_type: 'SomeGhostNode', inputs: { image: ['1', 0] } },
    '3': { class_type: 'SaveImage', inputs: { images: ['2', 0] } },
    ...extra,
  });

  const uploadExtract = (jsonContent: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        slug: uniq('extract'),
        label: 'Extract test',
        jsonContent,
        workflowType: 'garment_extract',
      },
    });

  async function seedExtractWorkflow(isActive = true) {
    const res = await uploadExtract(extractJson());
    expect(res.statusCode).toBe(200);
    const id = res.json().id as string;
    if (!isActive)
      await app.db
        .update(schema.workflowTemplates)
        .set({ isActive: false })
        .where(eq(schema.workflowTemplates.id, id));
    return id;
  }

  async function seedGarmentType(fields: Partial<typeof schema.garmentSubcategories.$inferInsert>) {
    const [gt] = await app.db
      .insert(schema.garmentSubcategories)
      .values({ genderSlug: 'women', slug: uniq('gt'), label: uniq('GT'), ...fields })
      .returning();
    return gt.id;
  }

  const patchGt = (id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/admin/assets/garment-types/${id}`,
      headers,
      payload,
    });

  describe('POST /admin/workflows (garment_extract)', () => {
    it('detects the lone LoadImage as input (not person) and the SaveImage as output', async () => {
      const res = await uploadExtract(extractJson());
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.workflowType).toBe('garment_extract');
      expect(body.tryonGarmentNodeId).toBe('1');
      expect(body.tryonOutputNodeId).toBe('3');
      expect(body.tryonPersonNodeId).toBeNull();
    });

    it('stores a quick_tryon input in the person column, skipping an unused garment-titled LoadImage', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/workflows',
        headers,
        payload: {
          slug: uniq('quick'),
          label: 'Quick try-on test',
          workflowType: 'quick_tryon',
          jsonContent: {
            '1': {
              class_type: 'LoadImage',
              inputs: { image: 'a.png' },
              _meta: { title: 'person' },
            },
            '2': {
              class_type: 'LoadImage',
              inputs: { image: 'b.png' },
              _meta: { title: 'garment' },
            },
            '3': { class_type: 'SomeNode', inputs: { image: ['1', 0] } },
            '4': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
          },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tryonPersonNodeId).toBe('1');
      expect(body.tryonGarmentNodeId).toBeNull();
      expect(body.tryonOutputNodeId).toBe('4');
    });

    it('rejects a graph with no image input', async () => {
      const { '1': _img, ...noInput } = extractJson();
      const res = await uploadExtract(noInput);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/input-image node/);
    });

    it('rejects a graph with no output node', async () => {
      const { '3': _out, ...noOutput } = extractJson();
      const res = await uploadExtract(noOutput);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/output node/);
    });
  });

  describe('PATCH /admin/assets/garment-types/:id', () => {
    it('enables extraction with an active garment_extract workflow', async () => {
      const wfId = await seedExtractWorkflow();
      const gtId = await seedGarmentType({});
      const res = await patchGt(gtId, {
        requiresGarmentExtractStep: true,
        garmentExtractWorkflowTemplateId: wfId,
      });
      expect(res.statusCode).toBe(200);
      const [row] = await app.db
        .select()
        .from(schema.garmentSubcategories)
        .where(eq(schema.garmentSubcategories.id, gtId));
      expect(row?.requiresGarmentExtractStep).toBe(true);
      expect(row?.garmentExtractWorkflowTemplateId).toBe(wfId);
    });

    it('rejects enabling without a workflow', async () => {
      const gtId = await seedGarmentType({});
      const res = await patchGt(gtId, { requiresGarmentExtractStep: true });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an inactive workflow and a workflow of another type', async () => {
      const gtId = await seedGarmentType({});
      const inactive = await seedExtractWorkflow(false);
      const inactiveRes = await patchGt(gtId, {
        requiresGarmentExtractStep: true,
        garmentExtractWorkflowTemplateId: inactive,
      });
      expect(inactiveRes.statusCode).toBe(400);

      const [other] = await app.db
        .insert(schema.workflowTemplates)
        .values({
          slug: uniq('regular'),
          label: 'Regular',
          jsonContent: {},
          workflowType: 'regular',
          faceNodeId: '',
          poseNodeId: '',
          bgNodeId: '',
          upperNodeIds: [],
          facePhasePromptNode: '',
          garmentPhasePromptNode: '',
        })
        .returning();
      const wrongTypeRes = await patchGt(gtId, {
        requiresGarmentExtractStep: true,
        garmentExtractWorkflowTemplateId: other.id,
      });
      expect(wrongTypeRes.statusCode).toBe(400);
    });

    it('is mutually exclusive with the mannequin step, whichever is set second', async () => {
      const wfId = await seedExtractWorkflow();
      const mannequinGt = await seedGarmentType({ requiresMannequinStep: true });
      const a = await patchGt(mannequinGt, {
        requiresGarmentExtractStep: true,
        garmentExtractWorkflowTemplateId: wfId,
      });
      expect(a.statusCode).toBe(400);

      const extractGt = await seedGarmentType({
        requiresGarmentExtractStep: true,
        garmentExtractWorkflowTemplateId: wfId,
      });
      const b = await patchGt(extractGt, { requiresMannequinStep: true });
      expect(b.statusCode).toBe(400);
    });

    it('allows disabling extraction without a workflow', async () => {
      const wfId = await seedExtractWorkflow();
      const gtId = await seedGarmentType({
        requiresGarmentExtractStep: true,
        garmentExtractWorkflowTemplateId: wfId,
      });
      const res = await patchGt(gtId, {
        requiresGarmentExtractStep: false,
        garmentExtractWorkflowTemplateId: null,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /v1/jobs/tryon', () => {
    async function registerUser(email: string) {
      const [user] = await app.db
        .insert(schema.users)
        .values({ email, emailVerified: true, tier: 'free' })
        .returning();
      const secret = new TextEncoder().encode(app.env.JWT_SECRET);
      const token = await signAccess(secret, user.id, { kind: 'access' }, app.env.JWT_EXPIRY);
      await app.db
        .insert(schema.userCredits)
        .values({ userId: user.id, balance: 100 })
        .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: 100 } });
      await app.db
        .insert(schema.creditPlans)
        .values({ slug: 'free', name: 'free', credits: 1000, basePaise: 0, watermark: false })
        .onConflictDoUpdate({ target: schema.creditPlans.slug, set: { watermark: false } });
      return { token, userId: user.id };
    }

    async function seedCatalog() {
      const [face] = await app.db
        .insert(schema.modelFaces)
        .values({ gender: 'women', label: 'F', r2Key: 'f.jpg', thumbnailKey: 'f.jpg' })
        .returning();
      const [bg] = await app.db
        .insert(schema.modelBackgrounds)
        .values({ label: 'Bg', r2Key: 'b.jpg', thumbnailKey: 'b.jpg' })
        .returning();
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({ label: 'Pose', r2Key: 'p.jpg', thumbnailKey: 'p.jpg' })
        .returning();
      return { faceId: face.id, bgId: bg.id, poseId: pose.id };
    }

    async function createJob(email: string, garmentTypeId: string) {
      const { token, userId } = await registerUser(email);
      const { faceId, bgId, poseId } = await seedCatalog();
      const garmentKey = `inputs/${userId}/garment.jpg`;
      await app.redis.set(`upload:owner:${garmentKey}`, userId, 'EX', 3600);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/tryon',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          inputs: {
            upperGarmentKey: garmentKey,
            faceId,
            garmentTypeId,
            looks: [{ poseId, backgroundId: bgId }],
          },
          aspectRatio: '1:1',
          resolution: '2K',
        },
      });
      return { res, userId };
    }

    const paramsOf = async (jobId: string) => {
      const [row] = await app.db
        .select({ params: schema.jobInputs.params })
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.jobId, jobId));
      return (row?.params ?? {}) as Record<string, unknown>;
    };

    it('snapshots the extract flag, workflow id and version for an enabled type', async () => {
      const wfId = await seedExtractWorkflow();
      const gtId = await seedGarmentType({
        requiresGarmentExtractStep: true,
        garmentExtractWorkflowTemplateId: wfId,
      });
      const { res } = await createJob('extract-enabled@x.com', gtId);
      expect(res.statusCode).toBe(201);
      const params = await paramsOf(res.json().jobIds[0]);
      expect(params.needsGarmentExtract).toBe(true);
      expect(params.garmentExtractWorkflowTemplateId).toBe(wfId);
      expect(typeof params.garmentExtractTemplateVersion).toBe('number');
    });

    it('leaves params untouched for a type without extraction', async () => {
      const gtId = await seedGarmentType({});
      const { res } = await createJob('extract-disabled@x.com', gtId);
      expect(res.statusCode).toBe(201);
      const params = await paramsOf(res.json().jobIds[0]);
      expect(params).not.toHaveProperty('needsGarmentExtract');
      expect(params).not.toHaveProperty('garmentExtractWorkflowTemplateId');
      expect(params).not.toHaveProperty('garmentExtractTemplateVersion');
    });

    it('rejects before charging when the extract workflow has been deactivated', async () => {
      const wfId = await seedExtractWorkflow();
      const gtId = await seedGarmentType({
        requiresGarmentExtractStep: true,
        garmentExtractWorkflowTemplateId: wfId,
      });
      await app.db
        .update(schema.workflowTemplates)
        .set({ isActive: false })
        .where(eq(schema.workflowTemplates.id, wfId));
      const { res, userId } = await createJob('extract-inactive@x.com', gtId);
      expect(res.statusCode).toBe(503);
      const [bal] = await app.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId));
      expect(bal.balance).toBe(100);
    });
  });
});
