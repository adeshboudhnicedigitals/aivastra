import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

describe('admin jobs worker filter', () => {
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
        email: `worker-filter-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: null,
        displayName: 'Worker Filter Test User',
        companyName: null,
        emailVerified: true,
        tier: 'free',
      })
      .returning();
    return user;
  }

  async function seedJob(userId: string, workerId: string | null) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'COMPLETED', creditsCharged: 1, workerId })
      .returning();
    return job;
  }

  it('filters the jobs list down to only the selected workerId', async () => {
    const user = await seedUser();
    const jobOnWorkerA = await seedJob(user.id, 'worker-a');
    const jobOnWorkerB = await seedJob(user.id, 'worker-b');
    const jobWithNoWorker = await seedJob(user.id, null);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/jobs?pageSize=100&workerId=worker-a',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids).toContain(jobOnWorkerA.id);
    expect(ids).not.toContain(jobOnWorkerB.id);
    expect(ids).not.toContain(jobWithNoWorker.id);

    const unfilteredRes = await app.inject({
      method: 'GET',
      url: '/admin/jobs?pageSize=100',
      headers: authHeader,
    });
    const unfilteredIds = (unfilteredRes.json() as { items: { id: string }[] }).items.map(
      (item) => item.id,
    );
    expect(unfilteredIds).toContain(jobOnWorkerA.id);
    expect(unfilteredIds).toContain(jobOnWorkerB.id);
    expect(unfilteredIds).toContain(jobWithNoWorker.id);
  });
});
