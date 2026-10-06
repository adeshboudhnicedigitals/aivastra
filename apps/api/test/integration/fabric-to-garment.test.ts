import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('Fabric to Garment', () => {
  let c: Containers;
  let app: TestApp;
  let realHeadObject: typeof app.storage.headObject | undefined;
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    realHeadObject = app.storage.headObject?.bind(app.storage);
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });
  beforeEach(async () => {
    await app.redis.del('jobs:normal');
    await app.redis.del('jobs:priority');
    // assertOwnsUploadKey (in createFabricToGarmentJob's verifyGarmentKey path)
    // checks the upload actually exists in storage — mock it out like
    // jobs-create.test.ts does, since these tests never PUT a real object.
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    if (realHeadObject) app.storage.headObject = realHeadObject;
  });

  async function registerUser(email: string) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, emailVerified: true })
      .returning();
    const token = await signAccess(
      new TextEncoder().encode(app.env.JWT_SECRET),
      user.id,
      { kind: 'access' },
      app.env.JWT_EXPIRY,
    );
    return { token, userId: user.id };
  }
  async function grantCredits(userId: string, balance: number) {
    await app.db
      .insert(schema.userCredits)
      .values({ userId, balance })
      .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance } });
  }
  async function bindUploadKey(userId: string, key: string) {
    await app.redis.set(`upload:owner:${key}`, userId, 'EX', 3600);
  }
  async function seedCreditPlan(slug: string) {
    await app.db
      .insert(schema.creditPlans)
      .values({ slug, name: slug, credits: 1000, basePaise: 0, watermark: false })
      .onConflictDoNothing({ target: schema.creditPlans.slug });
  }
  async function activeWorkflowTemplate(suffix: string) {
    const [row] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `fabric-to-garment-${suffix}`,
        label: 'Fabric to Garment WF',
        workflowType: 'fabric_to_garment',
        jsonContent: {},
        upperNodeIds: [],
        poseNodeId: '1',
        garmentPhasePromptNode: '2',
        facePhasePromptNode: '3',
        resultNodeId: '4',
        isActive: true,
      })
      .returning();
    return row;
  }
  async function activePreset(suffix: string, genderSlug: 'men' | 'women' | null = null) {
    const [row] = await app.db
      .insert(schema.fabricGarmentTypes)
      .values({
        slug: `shirt-${suffix}`,
        genderSlug,
        label: 'Shirt',
        prompt: 'a crisp cotton shirt',
        negativePrompt: 'wrinkled',
      })
      .returning();
    return row;
  }

  describe('admin CRUD + permission gating', () => {
    it('SUPER_ADMIN creates, lists, patches, and deletes a preset', async () => {
      const headers = await adminAuthHeader(app, 'SUPER_ADMIN');

      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/assets/fabric-garment-types',
        headers,
        payload: { slug: 'kurti', genderSlug: 'women', label: 'Kurti', prompt: 'a kurti' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id } = createRes.json();

      const listRes = await app.inject({
        method: 'GET',
        url: '/admin/assets/fabric-garment-types',
        headers,
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().items.find((t: { id: string }) => t.id === id)).toBeTruthy();

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/admin/assets/fabric-garment-types/${id}`,
        headers,
        payload: { label: 'Kurti Set', isActive: false },
      });
      expect(patchRes.statusCode).toBe(200);
      const [patched] = await app.db
        .select()
        .from(schema.fabricGarmentTypes)
        .where(eq(schema.fabricGarmentTypes.id, id));
      expect(patched.label).toBe('Kurti Set');
      expect(patched.isActive).toBe(false);

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/admin/assets/fabric-garment-types/${id}`,
        headers,
      });
      expect(deleteRes.statusCode).toBe(200);
      const remaining = await app.db
        .select()
        .from(schema.fabricGarmentTypes)
        .where(eq(schema.fabricGarmentTypes.id, id));
      expect(remaining).toHaveLength(0);
    });

    it('rejects a duplicate (slug, genderSlug) pair with 409', async () => {
      const headers = await adminAuthHeader(app, 'SUPER_ADMIN');
      const payload = { slug: 'anarkali', genderSlug: 'women', label: 'Anarkali', prompt: 'x' };
      const first = await app.inject({
        method: 'POST',
        url: '/admin/assets/fabric-garment-types',
        headers,
        payload,
      });
      expect(first.statusCode).toBe(201);
      const second = await app.inject({
        method: 'POST',
        url: '/admin/assets/fabric-garment-types',
        headers,
        payload,
      });
      expect(second.statusCode).toBe(409);
    });

    it('SUPPORT has no fabricGarmentTypes permissions at all', async () => {
      const headers = await adminAuthHeader(app, 'SUPPORT');
      const readRes = await app.inject({
        method: 'GET',
        url: '/admin/assets/fabric-garment-types',
        headers,
      });
      expect(readRes.statusCode).toBe(403);
      const writeRes = await app.inject({
        method: 'POST',
        url: '/admin/assets/fabric-garment-types',
        headers,
        payload: { slug: 'x', genderSlug: 'men', label: 'X', prompt: 'x' },
      });
      expect(writeRes.statusCode).toBe(403);
    });

    it('ADMIN can read and write but not delete', async () => {
      const headers = await adminAuthHeader(app, 'ADMIN');
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/assets/fabric-garment-types',
        headers,
        payload: { slug: 'blouse', genderSlug: 'women', label: 'Blouse', prompt: 'x' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id } = createRes.json();

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/admin/assets/fabric-garment-types/${id}`,
        headers,
      });
      expect(deleteRes.statusCode).toBe(403);
    });
  });

  describe('GET /v1/fabric-garment-types (user-facing)', () => {
    it('filters by gender, always including unisex rows; excludes inactive', async () => {
      const suffix = `gf-${Date.now()}`;
      const mens = await activePreset(`${suffix}-mens`, 'men');
      const womens = await activePreset(`${suffix}-womens`, 'women');
      const unisex = await activePreset(`${suffix}-unisex`, null);
      const [inactive] = await app.db
        .insert(schema.fabricGarmentTypes)
        .values({
          slug: `${suffix}-inactive`,
          genderSlug: 'men',
          label: 'Inactive',
          prompt: 'x',
          isActive: false,
        })
        .returning();

      const { token } = await registerUser(`fabric-gender-${suffix}@x.com`);

      const menRes = await app.inject({
        method: 'GET',
        url: '/v1/fabric-garment-types?gender=men',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(menRes.statusCode).toBe(200);
      const menIds = menRes.json().items.map((i: { id: string }) => i.id);
      expect(menIds).toContain(mens.id);
      expect(menIds).toContain(unisex.id);
      expect(menIds).not.toContain(womens.id);
      expect(menIds).not.toContain(inactive.id);

      const womenRes = await app.inject({
        method: 'GET',
        url: '/v1/fabric-garment-types?gender=women',
        headers: { authorization: `Bearer ${token}` },
      });
      const womenIds = womenRes.json().items.map((i: { id: string }) => i.id);
      expect(womenIds).toContain(womens.id);
      expect(womenIds).toContain(unisex.id);
      expect(womenIds).not.toContain(mens.id);

      // No gender filter: every active row regardless of genderSlug.
      const allRes = await app.inject({
        method: 'GET',
        url: '/v1/fabric-garment-types',
        headers: { authorization: `Bearer ${token}` },
      });
      const allIds = allRes.json().items.map((i: { id: string }) => i.id);
      expect(allIds).toContain(mens.id);
      expect(allIds).toContain(womens.id);
      expect(allIds).toContain(unisex.id);
      expect(allIds).not.toContain(inactive.id);
      expect(typeof allRes.json().creditsCost).toBe('number');
    });
  });

  describe('POST /v1/jobs/fabric-to-garment', () => {
    // createFabricToGarmentJob picks the first active fabric_to_garment
    // template with no further ordering — deactivate every template left over
    // from an earlier test in this file before each one, so "no active
    // template" and "which template got snapshotted" stay deterministic.
    beforeEach(async () => {
      await app.db
        .update(schema.workflowTemplates)
        .set({ isActive: false })
        .where(eq(schema.workflowTemplates.workflowType, 'fabric_to_garment'));
    });

    it('rejects a garment key the caller does not own', async () => {
      await seedCreditPlan('free');
      const { token, userId } = await registerUser(`fabric-unowned-${Date.now()}@x.com`);
      await grantCredits(userId, 100);
      const preset = await activePreset(`unowned-${Date.now()}`);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/fabric-to-garment',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          productImageKey: `inputs/${userId}/garment.jpg`,
          fabricGarmentTypeId: preset.id,
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('400s with CONFIG when no active fabric_to_garment workflow template exists', async () => {
      await seedCreditPlan('free');
      const { token, userId } = await registerUser(`fabric-noconfig-${Date.now()}@x.com`);
      await grantCredits(userId, 100);
      const garmentKey = `inputs/${userId}/garment.jpg`;
      await bindUploadKey(userId, garmentKey);
      const preset = await activePreset(`noconfig-${Date.now()}`);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/fabric-to-garment',
        headers: { authorization: `Bearer ${token}` },
        payload: { productImageKey: garmentKey, fabricGarmentTypeId: preset.id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('CONFIG');

      const [bal] = await app.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId));
      expect(bal.balance).toBe(100);
    });

    it('400s when the garment-type preset is unknown or inactive', async () => {
      await seedCreditPlan('free');
      await activeWorkflowTemplate(`preset-check-${Date.now()}`);
      const { token, userId } = await registerUser(`fabric-badpreset-${Date.now()}@x.com`);
      await grantCredits(userId, 100);
      const garmentKey = `inputs/${userId}/garment.jpg`;
      await bindUploadKey(userId, garmentKey);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/fabric-to-garment',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          productImageKey: garmentKey,
          fabricGarmentTypeId: '00000000-0000-0000-0000-000000000000',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    });

    it('happy path: deducts the configured credit cost, snapshots the preset prompt, enqueues', async () => {
      await seedCreditPlan('free');
      const suffix = `happy-${Date.now()}`;
      const workflow = await activeWorkflowTemplate(suffix);
      const preset = await activePreset(suffix, 'men');
      const { token, userId } = await registerUser(`fabric-happy-${suffix}@x.com`);
      await grantCredits(userId, 100);
      const garmentKey = `inputs/${userId}/garment.jpg`;
      await bindUploadKey(userId, garmentKey);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/fabric-to-garment',
        headers: { authorization: `Bearer ${token}` },
        payload: { productImageKey: garmentKey, fabricGarmentTypeId: preset.id },
      });
      expect(res.statusCode).toBe(201);
      const { jobId } = res.json();

      const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(job.status).toBe('QUEUED');
      expect(job.source).toBe('fabric_to_garment');
      // Default cost from FABRIC_TO_GARMENT_DEFAULT_COST (lib/resolution-config.ts)
      // unless an admin has overridden config:system.fabricToGarment.creditCost.
      expect(job.creditsCharged).toBeGreaterThan(0);

      const [bal] = await app.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId));
      expect(bal.balance).toBe(100 - job.creditsCharged);

      const [inputs] = await app.db
        .select()
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.jobId, jobId));
      expect(inputs.upperGarmentKey).toBe(garmentKey);
      expect(inputs.params).toMatchObject({
        kind: 'fabric_to_garment',
        workflowTemplateId: workflow.id,
        fabricGarmentTypeId: preset.id,
        prompt: preset.prompt,
        negativePrompt: preset.negativePrompt,
      });

      expect(await app.redis.xlen('jobs:normal')).toBeGreaterThanOrEqual(1);
    });

    it('ignores an inactive preset even when the id is otherwise valid', async () => {
      await seedCreditPlan('free');
      const suffix = `inactive-preset-${Date.now()}`;
      await activeWorkflowTemplate(suffix);
      const [inactivePreset] = await app.db
        .insert(schema.fabricGarmentTypes)
        .values({ slug: suffix, genderSlug: null, label: 'X', prompt: 'x', isActive: false })
        .returning();
      const { token, userId } = await registerUser(`fabric-inactive-preset-${suffix}@x.com`);
      await grantCredits(userId, 100);
      const garmentKey = `inputs/${userId}/garment.jpg`;
      await bindUploadKey(userId, garmentKey);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/fabric-to-garment',
        headers: { authorization: `Bearer ${token}` },
        payload: { productImageKey: garmentKey, fabricGarmentTypeId: inactivePreset.id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    });

    it('ignores an inactive workflow template, falling back to CONFIG', async () => {
      await seedCreditPlan('free');
      const suffix = `inactive-wf-${Date.now()}`;
      await app.db.insert(schema.workflowTemplates).values({
        slug: suffix,
        label: 'Inactive fabric WF',
        workflowType: 'fabric_to_garment',
        jsonContent: {},
        upperNodeIds: [],
        poseNodeId: '1',
        garmentPhasePromptNode: '2',
        isActive: false,
      });
      const preset = await activePreset(suffix);
      const { token, userId } = await registerUser(`fabric-inactive-wf-${suffix}@x.com`);
      await grantCredits(userId, 100);
      const garmentKey = `inputs/${userId}/garment.jpg`;
      await bindUploadKey(userId, garmentKey);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/fabric-to-garment',
        headers: { authorization: `Bearer ${token}` },
        payload: { productImageKey: garmentKey, fabricGarmentTypeId: preset.id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('CONFIG');
    });
  });
});
