import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/auth/service.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

// GET /results/data's search ORed a bare `ilike(schema.jobs.id, ...)` against a
// native uuid column — Postgres has no implicit uuid->text cast for ILIKE's
// operator resolution, so the whole query failed (not just the job-id half of
// the OR) any time `search` was set at all, including a plain email search.
describe('/results search filter', () => {
  let c: Containers;
  let app: TestApp;
  let nextTestClient = 1;
  let cookie: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);

    const password = 'password123';
    const passwordHash = await hashPassword(password);
    const [admin] = await app.db
      .insert(schema.users)
      .values({
        email: 'results-search-admin@x.com',
        passwordHash,
        displayName: 'Results Search Admin',
        emailVerified: true,
      })
      .returning();
    await app.db.insert(schema.adminUsers).values({
      userId: admin.id,
      role: 'ADMIN',
      status: 'active',
      passwordHash,
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/results/login',
      remoteAddress: `127.0.0.${nextTestClient++}`,
      payload: { email: 'results-search-admin@x.com', password },
    });
    const setCookie = loginRes.cookies.find((ck) => ck.name === 'results_access_token');
    cookie = `results_access_token=${setCookie?.value}`;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await c?.stop();
  });

  async function seedJob(userEmail: string) {
    const [user] = await app.db
      .insert(schema.users)
      .values({ email: userEmail, emailVerified: true })
      .returning();
    const [job] = await app.db
      .insert(schema.jobs)
      .values({ userId: user.id, status: 'COMPLETED', creditsCharged: 1, source: 'tryon' })
      .returning();
    return { jobId: job.id as string, userEmail };
  }

  it('matches on a job id substring without erroring', async () => {
    const { jobId } = await seedJob('job-id-search@x.com');
    const other = await seedJob('unrelated@x.com');

    const res = await app.inject({
      method: 'GET',
      url: `/results/data?status=all&pageSize=100&search=${jobId.slice(0, 8)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ids).toContain(jobId);
    expect(ids).not.toContain(other.jobId);
  });

  it('matches on the user email without erroring', async () => {
    const { jobId, userEmail } = await seedJob('email-search-target@x.com');

    const res = await app.inject({
      method: 'GET',
      url: `/results/data?status=all&pageSize=100&search=${encodeURIComponent(userEmail)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ids).toContain(jobId);
  });
});
