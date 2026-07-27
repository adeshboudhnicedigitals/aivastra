import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
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
  async function sourceJob(userId: string) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'COMPLETED', creditsCharged: 25 })
      .returning();
    await app.db.insert(schema.jobInputs).values({ jobId: job.id });
    await app.db
      .insert(schema.jobOutputs)
      .values({ jobId: job.id, resultKey: keys.output(job.id) });
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
  it('happy path: deducts default 20 credits, sets params.kind=video, enqueues', async () => {
    const { token, userId } = await registerUser('cv-happy@x.com');
    await grantCredits(userId, 100);
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
    expect(job.creditsCharged).toBe(20);
    expect(job.source).toBe('catalog_video');
    const [bal] = await app.db
      .select()
      .from(schema.userCredits)
      .where(eq(schema.userCredits.userId, userId));
    expect(bal.balance).toBe(80);
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
    expect(await app.redis.xlen('jobs:normal')).toBeGreaterThanOrEqual(1);
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
    await grantCredits(userId, 100);
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
      expect(bal.balance).toBe(100);
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
});
