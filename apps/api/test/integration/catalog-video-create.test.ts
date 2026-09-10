import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { PIXVERSE_CUSTOM_VIDEO_PROMPT } from '@aivastra/types';
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('POST /v1/jobs/catalog-video', () => {
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
    await app.redis.del('jobs:video');
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
  async function sourceJob(userId: string, resultKey?: string) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'COMPLETED', creditsCharged: 25 })
      .returning();
    await app.db.insert(schema.jobInputs).values({ jobId: job.id });
    await app.db
      .insert(schema.jobOutputs)
      .values({ jobId: job.id, resultKey: resultKey ?? keys.output(job.id) });
    return job.id;
  }
  async function activeSample() {
    const [row] = await app.db
      .insert(schema.sampleVideos)
      .values({
        title: 'Turn',
        videoR2Key: 'sample-videos/x.mp4',
        thumbnailR2Key: 'sample-videos/x.thumb.jpg',
        prompt: 'model turns slowly',
      })
      .returning();
    return row.id;
  }
  async function activeSampleWithPricing(duration: number, quality: string) {
    const [row] = await app.db
      .insert(schema.sampleVideos)
      .values({
        title: 'Custom',
        videoR2Key: 'sample-videos/custom.mp4',
        thumbnailR2Key: 'sample-videos/custom.thumb.jpg',
        prompt: 'model turns slowly',
        duration,
        quality,
      })
      .returning();
    return row.id;
  }
  it('happy path: deducts default 150 credits, sets params.kind=video, enqueues', async () => {
    const { token, userId } = await registerUser('cv-happy@x.com');
    await grantCredits(userId, 200);
    const sourceJobId = await sourceJob(userId);
    const sampleVideoId = await activeSample();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, sampleVideoId },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.status).toBe('QUEUED');
    expect(job.creditsCharged).toBe(150);
    expect(job.source).toBe('catalog_video');
    // Video jobs get their own lane — they need no GPU worker, so they must not be
    // gated by the dispatcher's worker-registry concurrency cap.
    expect(job.queueStream).toBe('video');
    expect(job.priority).toBe(false);
    const [bal] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(bal.balance).toBe(50);
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const params = inputs.params as Record<string, unknown>;
    expect(params).toMatchObject({
      kind: 'video',
      sourceJobId,
      sampleVideoId,
      sourceImageKey: keys.output(sourceJobId),
      prompt: 'model turns slowly',
    });
    expect(await app.redis.xlen('jobs:video')).toBeGreaterThanOrEqual(1);
    expect(await app.redis.xlen('jobs:normal')).toBe(0);
  });
  // Tryon-direct results (source='tryon'/'api_tryon') are stored WebP-encoded
  // (see apps/dispatcher/src/workflow/finalize.ts) — sourceImageKey must come
  // from the source job's actual job_outputs.resultKey, not a reconstructed
  // keys.output(sourceJobId), or PixVerse would be pointed at a .png key that
  // was never uploaded.
  it('uses the source job stored resultKey as sourceImageKey — not a reconstructed .png key', async () => {
    const { token, userId } = await registerUser('cv-webp-source@x.com');
    await grantCredits(userId, 200);
    const webpResultKey = 'outputs/some-prior-tryon-job/result.webp';
    const sourceJobId = await sourceJob(userId, webpResultKey);
    const sampleVideoId = await activeSample();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, sampleVideoId },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const params = inputs.params as Record<string, unknown>;
    expect(params.sourceImageKey).toBe(webpResultKey);
    expect(params.sourceImageKey).not.toBe(keys.output(sourceJobId));
  });
  it('rejects with FORBIDDEN when sourceJobId belongs to another user', async () => {
    const { userId: owner } = await registerUser('cv-owner@x.com');
    const sourceJobId = await sourceJob(owner);
    const sampleVideoId = await activeSample();
    const { token, userId } = await registerUser('cv-thief@x.com');
    await grantCredits(userId, 100);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, sampleVideoId },
    });
    expect(res.statusCode).toBe(403);
  });
  it('rejects with VALIDATION when the source job is not COMPLETED', async () => {
    const { token, userId } = await registerUser('cv-notdone@x.com');
    await grantCredits(userId, 100);
    const sourceJobId = await sourceJob(userId);
    await app.db
      .update(schema.jobs)
      .set({ status: 'QUEUED' })
      .where(eq(schema.jobs.id, sourceJobId));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, sampleVideoId: await activeSample() },
    });
    expect(res.statusCode).toBe(400);
  });
  it('rejects with VALIDATION when the sample video is inactive', async () => {
    const { token, userId } = await registerUser('cv-inactive@x.com');
    await grantCredits(userId, 100);
    const [sample] = await app.db
      .insert(schema.sampleVideos)
      .values({
        title: 'Off',
        videoR2Key: 'sample-videos/y.mp4',
        thumbnailR2Key: 'sample-videos/y.thumb.jpg',
        prompt: 'p',
        isActive: false,
      })
      .returning();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId: await sourceJob(userId), sampleVideoId: sample.id },
    });
    expect(res.statusCode).toBe(400);
  });
  it('refunds credits and marks FAILED on enqueue failure', async () => {
    const { token, userId } = await registerUser('cv-enqfail@x.com');
    await grantCredits(userId, 200);
    const sourceJobId = await sourceJob(userId);
    const realXadd = app.redis.xadd.bind(app.redis);
    app.redis.xadd = (async () => {
      throw new Error('redis down');
    }) as typeof app.redis.xadd;
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/catalog-video',
        headers: { authorization: `Bearer ${token}` },
        payload: { sourceJobId, sampleVideoId: await activeSample() },
      });
      expect(res.statusCode).toBe(503);
      const [bal] = await app.db
        .select()
        .from(schema.userCredits)
        .where(eq(schema.userCredits.userId, userId));
      expect(bal.balance).toBe(200);
      const [job] = await app.db
        .select()
        .from(schema.jobs)
        .where(and(eq(schema.jobs.userId, userId), ne(schema.jobs.id, sourceJobId)));
      expect(job.status).toBe('FAILED');
      expect(job.errorCode).toBe('ENQUEUE_FAIL');
    } finally {
      app.redis.xadd = realXadd;
    }
  });
  it('creates a job from an uploaded sourceImageKey, with no sourceJobId', async () => {
    const { token, userId } = await registerUser('cv-upload-happy@x.com');
    await grantCredits(userId, 200);
    const sourceImageKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, sourceImageKey);
    await app.storage.putObject(sourceImageKey, Buffer.from('uploaded-bytes'), 'image/jpeg');
    const sampleVideoId = await activeSample();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceImageKey, sampleVideoId },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const params = inputs.params as Record<string, unknown>;
    expect(params.sourceImageKey).toBe(sourceImageKey);
    expect(params).not.toHaveProperty('sourceJobId');
    expect(params.kind).toBe('video');
  });
  it('rejects with FORBIDDEN when sourceImageKey was never issued to this user', async () => {
    const { token, userId } = await registerUser('cv-upload-notowned@x.com');
    await grantCredits(userId, 100);
    const sourceImageKey = `inputs/${userId}/garment.jpg`;
    // deliberately not bound via bindUploadKey
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceImageKey, sampleVideoId: await activeSample() },
    });
    expect(res.statusCode).toBe(403);
  });
  it('rejects with BAD_UPLOAD when the sourceImageKey object does not exist in R2', async () => {
    const { token, userId } = await registerUser('cv-upload-missing@x.com');
    await grantCredits(userId, 100);
    const sourceImageKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, sourceImageKey);
    // deliberately not put to R2
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceImageKey, sampleVideoId: await activeSample() },
    });
    expect(res.statusCode).toBe(400);
    // Asserting the error code (not just the status) matters here: before the
    // schema change, this same payload also 400s — but for a different reason
    // (sourceJobId missing → zod VALIDATION), not the object-missing check
    // this test is actually targeting. BAD_UPLOAD only appears once the schema
    // accepts sourceImageKey and assertGarmentObjectValid's headObject fails.
    expect(res.json().error.code).toBe('BAD_UPLOAD');
  });
  it('rejects with 400 when both sourceJobId and sourceImageKey are provided', async () => {
    const { token, userId } = await registerUser('cv-both@x.com');
    await grantCredits(userId, 100);
    const sourceJobId = await sourceJob(userId);
    const sourceImageKey = `inputs/${userId}/garment.jpg`;
    await bindUploadKey(userId, sourceImageKey);
    await app.storage.putObject(sourceImageKey, Buffer.from('x'), 'image/jpeg');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, sourceImageKey, sampleVideoId: await activeSample() },
    });
    expect(res.statusCode).toBe(400);
  });
  it('rejects with 400 when neither sourceJobId nor sourceImageKey are provided', async () => {
    const { token, userId } = await registerUser('cv-neither@x.com');
    await grantCredits(userId, 100);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sampleVideoId: await activeSample() },
    });
    expect(res.statusCode).toBe(400);
  });
  it('charges the formula-computed cost for the sample video own duration/quality, and snapshots both onto job_inputs.params', async () => {
    const { token, userId } = await registerUser('cv-formula@x.com');
    await grantCredits(userId, 500);
    const sourceJobId = await sourceJob(userId);
    const sampleVideoId = await activeSampleWithPricing(15, '1080p');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, sampleVideoId },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    // Default pricing config: qualityBase=150 for every tier, perSecondRate=0
    // -> cost is 150 regardless of duration/quality until an admin tunes it.
    // This asserts the *lookup* is per-sample now, not that the number differs
    // from the flat default (see the JobCostsTab-driven test in Task 10 for
    // an admin-tuned, differing cost).
    expect(job.creditsCharged).toBe(150);
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const params = inputs.params as Record<string, unknown>;
    expect(params.duration).toBe(15);
    expect(params.quality).toBe('1080p');
  });
  it('uses the admin-configured pricing formula, not the hardcoded default, once tuned', async () => {
    await app.redis.set(
      'config:system',
      JSON.stringify({
        pixverseVideoPricing: {
          perSecondRate: 5,
          qualityBase: { '360p': 10, '540p': 20, '720p': 30, '1080p': 50 },
        },
      }),
    );
    try {
      const { token, userId } = await registerUser('cv-admin-tuned@x.com');
      await grantCredits(userId, 500);
      const sourceJobId = await sourceJob(userId);
      const sampleVideoId = await activeSampleWithPricing(10, '540p');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/catalog-video',
        headers: { authorization: `Bearer ${token}` },
        payload: { sourceJobId, sampleVideoId },
      });
      expect(res.statusCode).toBe(201);
      const { jobId } = res.json();
      const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      // 20 (540p base) + 10s * 5/s = 70
      expect(job.creditsCharged).toBe(70);
    } finally {
      await app.redis.del('config:system');
    }
  });
  it('accepts a custom duration+quality request (no sampleVideoId), charges the formula cost, and snapshots the fixed prompt', async () => {
    const { token, userId } = await registerUser('cv-custom-happy@x.com');
    await grantCredits(userId, 200);
    const sourceJobId = await sourceJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, duration: 10, quality: '540p' },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    // Default pricing config: qualityBase=150 flat, perSecondRate=0 -> 150
    // regardless of duration/quality until an admin tunes it (same default
    // the preset-path formula tests above rely on).
    expect(job.creditsCharged).toBe(150);
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const params = inputs.params as Record<string, unknown>;
    expect(params.sampleVideoId).toBeNull();
    expect(params.duration).toBe(10);
    expect(params.quality).toBe('540p');
    expect(params.prompt).toBe(PIXVERSE_CUSTOM_VIDEO_PROMPT);
  });
  it('uses the admin-configured pricing formula for a custom request, not the hardcoded default', async () => {
    await app.redis.set(
      'config:system',
      JSON.stringify({
        pixverseVideoPricing: {
          perSecondRate: 5,
          qualityBase: { '360p': 10, '540p': 20, '720p': 30, '1080p': 50 },
        },
      }),
    );
    try {
      const { token, userId } = await registerUser('cv-custom-tuned@x.com');
      await grantCredits(userId, 200);
      const sourceJobId = await sourceJob(userId);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/jobs/catalog-video',
        headers: { authorization: `Bearer ${token}` },
        payload: { sourceJobId, duration: 10, quality: '540p' },
      });
      expect(res.statusCode).toBe(201);
      const { jobId } = res.json();
      const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      // 20 (540p base) + 10s * 5/s = 70
      expect(job.creditsCharged).toBe(70);
    } finally {
      await app.redis.del('config:system');
    }
  });
  it('rejects duration outside 1-15 on a custom request', async () => {
    const { token, userId } = await registerUser('cv-custom-badduration@x.com');
    await grantCredits(userId, 100);
    const sourceJobId = await sourceJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, duration: 16, quality: '540p' },
    });
    expect(res.statusCode).toBe(400);
  });
  it('rejects an unrecognized quality on a custom request', async () => {
    const { token, userId } = await registerUser('cv-custom-badquality@x.com');
    await grantCredits(userId, 100);
    const sourceJobId = await sourceJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, duration: 8, quality: '4k' },
    });
    expect(res.statusCode).toBe(400);
  });
  it('accepts sampleVideoId together with duration/quality, using the preset prompt but the overridden duration/quality', async () => {
    const { token, userId } = await registerUser('cv-preset-override@x.com');
    await grantCredits(userId, 200);
    const sourceJobId = await sourceJob(userId);
    // activeSample() defaults to duration=8, quality='720p' — the override
    // below must win over both.
    const sampleVideoId = await activeSample();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, sampleVideoId, duration: 3, quality: '360p' },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const params = inputs.params as Record<string, unknown>;
    expect(params.sampleVideoId).toBe(sampleVideoId);
    expect(params.duration).toBe(3);
    expect(params.quality).toBe('360p');
    // Prompt still comes from the preset — the override never supplies one.
    expect(params.prompt).toBe('model turns slowly');
  });
  it("falls back to the preset's own duration/quality when sampleVideoId is given alone", async () => {
    const { token, userId } = await registerUser('cv-preset-no-override@x.com');
    await grantCredits(userId, 200);
    const sourceJobId = await sourceJob(userId);
    const sampleVideoId = await activeSample();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, sampleVideoId },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const [inputs] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    const params = inputs.params as Record<string, unknown>;
    expect(params.duration).toBe(8);
    expect(params.quality).toBe('720p');
  });
  it('rejects a request providing neither sampleVideoId nor a complete duration+quality pair', async () => {
    const { token, userId } = await registerUser('cv-custom-incomplete@x.com');
    await grantCredits(userId, 100);
    const sourceJobId = await sourceJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, duration: 8 },
    });
    expect(res.statusCode).toBe(400);
  });
  it('rejects a request providing quality without duration', async () => {
    const { token, userId } = await registerUser('cv-custom-incomplete-quality@x.com');
    await grantCredits(userId, 100);
    const sourceJobId = await sourceJob(userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/jobs/catalog-video',
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceJobId, quality: '540p' },
    });
    expect(res.statusCode).toBe(400);
  });
});
