import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('regenerate — reuses job-creation pipeline, never a separate implementation', () => {
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
    app.storage.headObject = (async () => ({
      contentLength: 1024,
    })) as typeof app.storage.headObject;
  });
  afterEach(() => {
    if (realHeadObject) app.storage.headObject = realHeadObject;
  });

  async function registerUser(email: string, tier = 'free') {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email, emailVerified: true, tier })
      .returning();
    const secret = new TextEncoder().encode(app.env.JWT_SECRET);
    const accessToken = await signAccess(secret, user.id, { kind: 'access' }, app.env.JWT_EXPIRY);
    return { token: accessToken, userId: user.id };
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

  async function seedCreditPlan(slug: string, watermark: boolean) {
    await app.db
      .insert(schema.creditPlans)
      .values({ slug, name: slug, credits: 1000, basePaise: 0, watermark })
      .onConflictDoUpdate({ target: schema.creditPlans.slug, set: { watermark } });
  }

  it('404s when the job does not exist', async () => {
    const { token } = await registerUser('regen-404@x.com');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${randomUUID()}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s when the job belongs to another user', async () => {
    const { userId: ownerId } = await registerUser('regen-owner@x.com');
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId: ownerId, status: 'COMPLETED', creditsCharged: 1 })
      .returning();
    const { token } = await registerUser('regen-thief@x.com');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${job.id}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('409s when the original job is not COMPLETED', async () => {
    const { token, userId } = await registerUser('regen-409@x.com');
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'QUEUED', creditsCharged: 1 })
      .returning();
    await app.db.insert(schema.jobInputs).values({ jobId: job.id, upperGarmentKey: 'x' });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${job.id}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
  });

  describe('saree job regenerate', () => {
    async function seedSareeSettings() {
      await app.db.insert(schema.workflowTemplates).values({
        slug: `saree-wf-${randomUUID()}`,
        label: 'Saree workflow',
        workflowType: 'saree',
        jsonContent: {},
        isActive: true,
        faceNodeId: '1',
        poseNodeId: '1',
        bgNodeId: '1',
        upperNodeIds: ['1'],
        facePhasePromptNode: '1',
        garmentPhasePromptNode: '1',
      });
      await app.db.insert(schema.sareeSettings).values({
        modelImageKey: `saree/model-${randomUUID()}.jpg`,
      });
    }

    it('resolves the CURRENT watermark entitlement, not the one baked into the original job', async () => {
      await seedSareeSettings();
      await seedCreditPlan('free', true);

      const { token, userId } = await registerUser('regen-saree@x.com', 'free');
      await grantCredits(userId, 100);
      const garmentKey = `inputs/${userId}/garment.jpg`;
      await bindUploadKey(userId, garmentKey);

      const [original] = await app.db
        .insert(schema.jobs)
        .values({ userId, status: 'COMPLETED', creditsCharged: 35, watermark: true })
        .returning();
      await app.db.insert(schema.jobInputs).values({
        jobId: original.id,
        upperGarmentKey: garmentKey,
        params: { kind: 'saree' },
      });

      // User upgrades to a plan with watermark:false before regenerating.
      await seedCreditPlan('starter', false);
      await app.db.update(schema.users).set({ tier: 'starter' }).where(eq(schema.users.id, userId));

      const res = await app.inject({
        method: 'POST',
        url: `/v1/jobs/${original.id}/regenerate`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(201);
      const { jobId: newJobId } = res.json();

      const [newJob] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, newJobId));
      expect(newJob.parentJobId).toBe(original.id);
      // Resolved fresh from the CURRENT plan — not copied from original.watermark.
      expect(newJob.watermark).toBe(false);

      const [origAfter] = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, original.id));
      expect(origAfter.watermark).toBe(true); // untouched
    });
  });

  describe('tryon-direct (simple-tryon) regenerate', () => {
    async function seedEligibleSourceJob(userId: string) {
      const [workflow] = await app.db
        .insert(schema.workflowTemplates)
        .values({
          slug: `tryon-wf-${randomUUID()}`,
          label: 'Tryon workflow',
          workflowType: 'tryon',
          jsonContent: {},
          isActive: true,
          tryonPersonNodeId: '1',
          tryonGarmentNodeId: '2',
          tryonOutputNodeId: '3',
          faceNodeId: '1',
          poseNodeId: '1',
          bgNodeId: '1',
          upperNodeIds: ['2'],
          facePhasePromptNode: '1',
          garmentPhasePromptNode: '1',
        })
        .returning();
      const [category] = await app.db
        .insert(schema.tryonCategories)
        .values({
          name: 'Upper',
          slug: `upper-${randomUUID()}`,
          workflowTemplateId: workflow.id,
          isActive: true,
        })
        .returning();
      const [subcat] = await app.db
        .insert(schema.garmentSubcategories)
        .values({
          genderSlug: 'men',
          slug: `shirt-${randomUUID()}`,
          label: 'Shirt',
          tryonCategoryId: category.id,
        })
        .returning();
      const [sourceJob] = await app.db
        .insert(schema.jobs)
        .values({ userId, status: 'COMPLETED', creditsCharged: 25 })
        .returning();
      await app.db.insert(schema.jobInputs).values({
        jobId: sourceJob.id,
        upperGarmentKey: 'inputs/seed/garment.jpg',
        garmentTypeId: subcat.id,
      });
      await app.db.insert(schema.jobOutputs).values({
        jobId: sourceJob.id,
        resultKey: keys.output(sourceJob.id),
      });
      return { sourceJobId: sourceJob.id };
    }

    it('regenerates using the stored sourceJobId, sets parentJobId to the ORIGINAL tryon-direct job', async () => {
      await seedCreditPlan('free', false);
      const { token, userId } = await registerUser('regen-tryon@x.com', 'free');
      await grantCredits(userId, 100);
      const { sourceJobId } = await seedEligibleSourceJob(userId);

      const personKey = `inputs/${randomUUID()}/garment.jpg`;
      await bindUploadKey(userId, personKey);
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/jobs/simple-tryon',
        headers: { authorization: `Bearer ${token}` },
        payload: { personKey, sourceJobId },
      });
      expect(createRes.statusCode).toBe(201);
      const { jobId: tryonDirectJobId } = createRes.json();
      await app.db
        .update(schema.jobs)
        .set({ status: 'COMPLETED' })
        .where(eq(schema.jobs.id, tryonDirectJobId));

      // personKey's presign-ownership binding must still be valid at regenerate
      // time (createSimpleTryonJob re-checks it) — re-bind as if within TTL.
      await bindUploadKey(userId, personKey);
      const regenRes = await app.inject({
        method: 'POST',
        url: `/v1/jobs/${tryonDirectJobId}/regenerate`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(regenRes.statusCode).toBe(201);
      const { jobId: regenJobId } = regenRes.json();

      const [regenJob] = await app.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, regenJobId));
      expect(regenJob.parentJobId).toBe(tryonDirectJobId);
      expect(regenJob.creditsCharged).toBe(35);

      const [regenInputs] = await app.db
        .select()
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.jobId, regenJobId));
      // Re-derived from the CURRENT output of sourceJobId, exactly like a
      // fresh simple-tryon request — not copied verbatim from the
      // tryon-direct job's own (already-resolved) upperGarmentKey.
      expect(regenInputs.upperGarmentKey).toBe(keys.output(sourceJobId));
    });
  });

  describe('studio (catalogue) job regenerate — pose-workflow parity', () => {
    it('re-derives lower/shoe stripping from the CURRENT pose workflow, not the stale original inputs', async () => {
      await seedCreditPlan('free', false);
      const { token, userId } = await registerUser('regen-studio@x.com', 'free');
      await grantCredits(userId, 100);

      const [face] = await app.db
        .insert(schema.modelFaces)
        .values({ gender: 'men', label: 'F', r2Key: 'f.jpg', thumbnailKey: 'f.jpg' })
        .returning();
      const [bg] = await app.db
        .insert(schema.modelBackgrounds)
        .values({ label: 'B', r2Key: 'b.jpg', thumbnailKey: 'b.jpg' })
        .returning();
      // Pose has NO workflow template at all → lowerNodeId/shoeNodeId resolve
      // to null → createJob will null out lowerCatalogId/shoeCatalogId
      // regardless of what's stored on the original job's inputs.
      const [pose] = await app.db
        .insert(schema.modelPoseAssets)
        .values({ label: 'P', r2Key: 'p.jpg', thumbnailKey: 'p.jpg' })
        .returning();
      const [lowerItem] = await app.db
        .insert(schema.catalogItems)
        .values({ type: 'lower', label: 'L', r2Key: 'l.jpg', thumbnailKey: 'l.jpg' })
        .returning();

      const garmentKey = `inputs/${userId}/garment.jpg`;
      await bindUploadKey(userId, garmentKey);

      // Original job was created with a stale lowerCatalogId set directly
      // (simulating data from before this pose's workflow was reconfigured
      // to drop lower-garment support).
      const [original] = await app.db
        .insert(schema.jobs)
        .values({ userId, status: 'COMPLETED', creditsCharged: 35 })
        .returning();
      await app.db.insert(schema.jobInputs).values({
        jobId: original.id,
        upperGarmentKey: garmentKey,
        faceId: face.id,
        backgroundId: bg.id,
        poseId: pose.id,
        lowerCatalogId: lowerItem.id,
        params: { aspectRatio: '1:1', resolution: '2K' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/jobs/${original.id}/regenerate`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(201);
      const { jobId: newJobId } = res.json();

      const [newInputs] = await app.db
        .select()
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.jobId, newJobId));
      // This is the exact divergence the review flagged: a hand-rolled
      // regenerate implementation copied lowerCatalogId verbatim; calling
      // through createJob strips it because the pose has no lower node.
      expect(newInputs.lowerCatalogId).toBeNull();

      const [newJob] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, newJobId));
      expect(newJob.parentJobId).toBe(original.id);
    });
  });
});
