import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

describe('admin jobs duration filter', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let authHeader: Record<string, string>;

  beforeAll(async () => {
    ctx = await startContainers();
    app = await buildTestApp(ctx);
    authHeader = await adminAuthHeader(app, 'SUPER_ADMIN');
  });
  afterAll(async () => {
    await app.close();
    await ctx.stop();
  });

  async function seedUser() {
    const [user] = await app.db
      .insert(schema.users)
      .values({
        email: `duration-filter-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: null,
        displayName: 'Duration Filter Test User',
        companyName: null,
        emailVerified: true,
        tier: 'free',
      })
      .returning();
    return user;
  }

  async function seedJob(userId: string, durationSeconds: number | null) {
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const completedAt =
      durationSeconds == null ? null : new Date(startedAt.getTime() + durationSeconds * 1000);
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        userId,
        status: durationSeconds == null ? 'QUEUED' : 'COMPLETED',
        creditsCharged: 1,
        startedAt: durationSeconds == null ? null : startedAt,
        completedAt,
      })
      .returning();
    return job;
  }

  it('filters the jobs list down to jobs whose generation duration falls within the range', async () => {
    const user = await seedUser();
    const fastJob = await seedJob(user.id, 10);
    const slowJob = await seedJob(user.id, 300);
    const inProgressJob = await seedJob(user.id, null);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/jobs?pageSize=100&durationMinSec=5&durationMaxSec=60',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids).toContain(fastJob.id);
    expect(ids).not.toContain(slowJob.id);
    expect(ids).not.toContain(inProgressJob.id);

    const unfilteredRes = await app.inject({
      method: 'GET',
      url: '/admin/jobs?pageSize=100',
      headers: authHeader,
    });
    const unfilteredIds = (unfilteredRes.json() as { items: { id: string }[] }).items.map(
      (item) => item.id,
    );
    expect(unfilteredIds).toContain(fastJob.id);
    expect(unfilteredIds).toContain(slowJob.id);
    expect(unfilteredIds).toContain(inProgressJob.id);
  });
});
