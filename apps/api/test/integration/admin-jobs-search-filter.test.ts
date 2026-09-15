import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp } from '../helpers/api.js';
import { startContainers } from '../helpers/containers.js';

describe('admin jobs search filter', () => {
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
        email: `search-filter-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: null,
        displayName: 'Search Filter Test User',
        companyName: null,
        emailVerified: true,
        tier: 'free',
      })
      .returning();
    return user;
  }

  async function seedJob(userId: string) {
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'COMPLETED', creditsCharged: 1 })
      .returning();
    return job;
  }

  it('matches on a job id substring', async () => {
    const user = await seedUser();
    const job = await seedJob(user.id);
    const otherJob = await seedJob((await seedUser()).id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/jobs?pageSize=100&search=${job.id.slice(0, 8)}`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids).toContain(job.id);
    expect(ids).not.toContain(otherJob.id);
  });

  it('matches on the owning user id, not just email/username', async () => {
    const user = await seedUser();
    const job = await seedJob(user.id);
    const otherJob = await seedJob((await seedUser()).id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/jobs?pageSize=100&search=${user.id}`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids).toContain(job.id);
    expect(ids).not.toContain(otherJob.id);
  });

  it('matches on a user id substring the same way job id substrings match', async () => {
    const user = await seedUser();
    const job = await seedJob(user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/jobs?pageSize=100&search=${user.id.slice(0, 8)}`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids).toContain(job.id);
  });
});
