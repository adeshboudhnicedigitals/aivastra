import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api';
import { type Containers, startContainers } from '../helpers/containers';

describe('regenerate — one dedicated workflow, decoupled from the original job', () => {
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
    await app.redis.del('jobs:priority');
    // The seed migration (packages/db) installs one active 'regeneration'
    // template by default — deactivate it here so each test starts from a
    // clean, explicit slate and seeds its own via seedRegenTemplate().
    await app.db
      .update(schema.workflowTemplates)
      .set({ isActive: false })
      .where(eq(schema.workflowTemplates.workflowType, 'regeneration'));
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

  async function seedRegenTemplate(
    reasonPrompts: { reason: string; prompt: string; instruction?: string }[] = [],
  ) {
    const [template] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `regen-test-${randomUUID()}`,
        label: 'Regen test workflow',
        workflowType: 'regeneration',
        jsonContent: {},
        isActive: true,
        faceNodeId: '',
        poseNodeId: '',
        bgNodeId: '',
        upperNodeIds: [],
        facePhasePromptNode: '149',
        garmentPhasePromptNode: '154',
        tryonPersonNodeId: '151',
        tryonOutputNodeId: '150',
        regenerationReasonPrompts: reasonPrompts,
      })
      .returning();
    return template;
  }

  async function seedCompletedJob(userId: string, resultKey?: string) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'COMPLETED', creditsCharged: 10 })
      .returning();
    await app.db.insert(schema.jobInputs).values({ jobId: job.id, upperGarmentKey: 'x' });
    const key = resultKey ?? keys.output(job.id);
    await app.db.insert(schema.jobOutputs).values({ jobId: job.id, resultKey: key });
    return { jobId: job.id as string, resultKey: key };
  }

  it('404s when the job does not exist', async () => {
    await seedRegenTemplate();
    const { token } = await registerUser('regen-404@x.com');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${randomUUID()}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s when the job belongs to another user', async () => {
    await seedRegenTemplate();
    const { userId: ownerId } = await registerUser('regen-owner@x.com');
    const { jobId } = await seedCompletedJob(ownerId);
    const { token } = await registerUser('regen-thief@x.com');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('409s when the original job is not COMPLETED', async () => {
    await seedRegenTemplate();
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
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('400s when no reason is provided', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-no-reason@x.com');
    const { jobId } = await seedCompletedJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400s ("regeneration is not configured") when no regeneration workflow is active', async () => {
    // No seedRegenTemplate() call — the beforeEach already deactivated the
    // migration-seeded one, so none is active.
    const { token, userId } = await registerUser('regen-not-configured@x.com');
    const { jobId } = await seedCompletedJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CONFIG');
  });

  it("creates a job whose input is the ORIGINAL job's own output, regardless of what kind of job it was", async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-any-kind@x.com');
    const { jobId, resultKey } = await seedCompletedJob(userId);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(201);
    const { jobId: newJobId } = res.json();

    const [newJob] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, newJobId));
    expect(newJob.parentJobId).toBe(jobId);
    expect(newJob.source).toBe('regenerate');
    expect(newJob.creditsCharged).toBe(0);
    // Resolved fresh from the current plan (free tier is seeded with
    // watermark=true — see packages/db/src/migrations/0082_watermarking_columns.sql),
    // not copied from the original job (which never had watermark set at all).
    expect(newJob.watermark).toBe(true);

    const [newInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, newJobId));
    const params = newInputs.params as Record<string, unknown>;
    expect(params.kind).toBe('regenerate');
    expect(params.sourceImageKey).toBe(resultKey);
    expect(params.sourceJobId).toBe(jobId);
    // No face/background/pose/garmentType — this job shape has none.
    expect(newInputs.faceId).toBeNull();
    expect(newInputs.backgroundId).toBeNull();
    expect(newInputs.poseId).toBeNull();
  });

  it('falls back to keys.output(id) when the original job has no job_outputs row', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-legacy-output@x.com');
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'COMPLETED', creditsCharged: 10 })
      .returning();
    await app.db.insert(schema.jobInputs).values({ jobId: job.id, upperGarmentKey: 'x' });
    // Deliberately no job_outputs row.

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${job.id}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(201);
    const [newInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((newInputs.params as Record<string, unknown>).sourceImageKey).toBe(keys.output(job.id));
  });

  it('applies the prompt whose reason matches the one the user picked', async () => {
    await seedRegenTemplate([
      { reason: 'Nudity', prompt: 'fully clothed, modest fit' },
      { reason: 'Draping issue', prompt: 'natural fabric drape' },
    ]);
    const { token, userId } = await registerUser('regen-prompt-match@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Nudity' },
    });
    expect(res.statusCode).toBe(201);
    const [newInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((newInputs.params as Record<string, unknown>).promptOverride).toBe(
      'fully clothed, modest fit',
    );
  });

  it('applies the instruction whose reason matches the one the user picked', async () => {
    await seedRegenTemplate([
      { reason: 'Nudity', prompt: 'fully clothed, modest fit', instruction: 'keep torso covered' },
      { reason: 'Draping issue', prompt: 'natural fabric drape', instruction: '' },
    ]);
    const { token, userId } = await registerUser('regen-instruction-match@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Nudity' },
    });
    expect(res.statusCode).toBe(201);
    const [newInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((newInputs.params as Record<string, unknown>).instructionOverride).toBe(
      'keep torso covered',
    );
  });

  it('omits instructionOverride when the matched reason has a blank configured instruction', async () => {
    await seedRegenTemplate([
      { reason: 'Draping issue', prompt: 'natural fabric drape', instruction: '' },
    ]);
    const { token, userId } = await registerUser('regen-instruction-blank@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Draping issue' },
    });
    expect(res.statusCode).toBe(201);
    const [newInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((newInputs.params as Record<string, unknown>).instructionOverride).toBeUndefined();
  });

  it('omits promptOverride when the submitted reason matches none configured (e.g. "Other")', async () => {
    await seedRegenTemplate([{ reason: 'Nudity', prompt: 'fully clothed, modest fit' }]);
    const { token, userId } = await registerUser('regen-prompt-mismatch@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Other' },
    });
    expect(res.statusCode).toBe(201);
    const [newInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, res.json().jobId));
    expect((newInputs.params as Record<string, unknown>).promptOverride).toBeUndefined();
  });

  it('409s once the result has been downloaded', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-downloaded@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const downloadRes = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/download`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(downloadRes.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('never charges credits for each of the first 5 regenerations, then 429s on the 6th', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-quota@x.com');
    await app.db
      .insert(schema.userCredits)
      .values({ userId, balance: 1000 })
      .onConflictDoUpdate({ target: schema.userCredits.userId, set: { balance: 1000 } });
    const { jobId } = await seedCompletedJob(userId);

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/jobs/${jobId}/regenerate`,
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'test reason' },
      });
      expect(res.statusCode).toBe(201);
      const ledgerRows = await app.db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.jobId, res.json().jobId));
      expect(ledgerRows.length).toBe(0);
    }

    const sixth = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe('FREE_REGENERATE_LIMIT');
  });

  it("regenerating a regenerated job's output chains naturally (parentJobId points at the immediate parent)", async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-chain@x.com');
    const { jobId: rootJobId } = await seedCompletedJob(userId);

    const first = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${rootJobId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    const firstRegenId = first.json().jobId as string;
    await app.db
      .update(schema.jobs)
      .set({ status: 'COMPLETED' })
      .where(eq(schema.jobs.id, firstRegenId));
    const firstResultKey = keys.output(firstRegenId);
    await app.db
      .insert(schema.jobOutputs)
      .values({ jobId: firstRegenId, resultKey: firstResultKey });

    const second = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${firstRegenId}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'test reason' },
    });
    expect(second.statusCode).toBe(201);
    const [secondRegen] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, second.json().jobId));
    expect(secondRegen.parentJobId).toBe(firstRegenId); // immediate parent, not the root

    const [secondInputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, second.json().jobId));
    expect((secondInputs.params as Record<string, unknown>).sourceImageKey).toBe(firstResultKey);
  });

  it("GET regenerate-reasons returns the active template's configured reason labels", async () => {
    await seedRegenTemplate([
      { reason: 'Nudity', prompt: 'a' },
      { reason: 'Draping issue', prompt: 'b' },
    ]);
    const { token, userId } = await registerUser('regen-reasons@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/regenerate-reasons`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reasons).toEqual(['Nudity', 'Draping issue']);
  });

  it('GET regenerate-reasons 404s for a job belonging to another user', async () => {
    await seedRegenTemplate();
    const { userId } = await registerUser('regen-reasons-owner@x.com');
    const { jobId } = await seedCompletedJob(userId);
    const { token: thiefToken } = await registerUser('regen-reasons-thief@x.com');

    const res = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/regenerate-reasons`,
      headers: { authorization: `Bearer ${thiefToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a repeated click (same Idempotency-Key) creates only one job, not two', async () => {
    await seedRegenTemplate();
    const { token, userId } = await registerUser('regen-idempotent@x.com');
    const { jobId } = await seedCompletedJob(userId);

    const idempotencyKey = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
      payload: { reason: 'test reason' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/regenerate`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
      payload: { reason: 'test reason' },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().jobId).toBe(first.json().jobId);

    const childJobs = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.parentJobId, jobId));
    expect(childJobs.length).toBe(1);
  });
});
