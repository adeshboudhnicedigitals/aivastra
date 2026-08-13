import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccess } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// SEC 7.5/9.1 graceful-abort gap: /v1/jobs/:id/cancel previously only accepted
// QUEUED jobs (409 for anything else), so a running generation always ran to
// completion even after the user asked to cancel. This now widens cancel to
// PREPROCESSING/GENERATING for source='tryon' jobs by setting a Redis flag the
// dispatcher's processJob polls for — deliberately scoped to that one pipeline
// only (see the comment above this branch in jobs/routes.ts).
describe('POST /v1/jobs/:id/cancel — in-flight (tryon-only) cancellation', () => {
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

  async function seedJob(userId: string, status: string, source: string) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status, creditsCharged: 5, source } as typeof schema.jobs.$inferInsert)
      .returning();
    return job.id as string;
  }

  it('sets a Redis cancel flag and returns 202 for a GENERATING tryon job — does not touch the row yet', async () => {
    const { token, userId } = await registerUser('cancel-generating-tryon@x.com');
    const jobId = await seedJob(userId, 'GENERATING', 'tryon');

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true, pending: true });

    expect(await app.redis.get(`job:cancel:${jobId}`)).toBe('1');

    // Nothing in Postgres changes synchronously — only the dispatcher's
    // in-flight poll loop transitions the row once it notices the flag.
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.status).toBe('GENERATING');
  });

  it('also accepts PREPROCESSING for a tryon job', async () => {
    const { token, userId } = await registerUser('cancel-preprocessing-tryon@x.com');
    const jobId = await seedJob(userId, 'PREPROCESSING', 'tryon');

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(202);
    expect(await app.redis.get(`job:cancel:${jobId}`)).toBe('1');
  });

  it('rejects a GENERATING job from a non-tryon source with 409 — no flag set', async () => {
    const { token, userId } = await registerUser('cancel-generating-saree@x.com');
    const jobId = await seedJob(userId, 'GENERATING', 'saree');

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    expect(await app.redis.get(`job:cancel:${jobId}`)).toBeNull();
  });

  it('rejects an UPLOADING tryon job with 409 — too late to interrupt', async () => {
    const { token, userId } = await registerUser('cancel-uploading-tryon@x.com');
    const jobId = await seedJob(userId, 'UPLOADING', 'tryon');

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('still cancels a QUEUED job synchronously with a refund, unaffected by the new branch', async () => {
    const { token, userId } = await registerUser('cancel-queued-tryon@x.com');
    const jobId = await seedJob(userId, 'QUEUED', 'tryon');

    const res = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, creditsRefunded: 5 });

    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.status).toBe('CANCELLED');
  });
});
