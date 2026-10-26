import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadUsersForExport,
  UsersExportQuery,
} from '../../src/modules/admin/users-export-query.js';
import { ensureComparisonSystemUser } from '../../src/modules/comparison/system-user.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { createVerifiedUserToken } from '../helpers/auth.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const SYSTEM_EMAIL = 'comparison-system@aivastra.internal';

// Replay jobs are real jobs on purpose (the normal dispatcher runs them), so every
// reader that aggregates `jobs` for customers or the business has to exclude them
// explicitly. Each test snapshots a reader, adds replay data, and expects no change.
describe('comparison replay jobs are excluded from customer and business reads', () => {
  let c: Containers;
  let app: TestApp;
  let auth: Record<string, string>;
  let customerId: string;
  let templateId: string;
  let customerJobId: string;
  let replayDoneId: string;
  const objects = new Set<string>();

  const get = (url: string) => app.inject({ method: 'GET', url, headers: auth });

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    auth = await adminAuthHeader(app);
    const [customer] = await app.db
      .insert(schema.users)
      .values({ email: `customer-${randomUUID()}@x.com`, emailVerified: true })
      .returning();
    customerId = customer.id;
    const [template] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `excl_${randomUUID().replaceAll('-', '_')}`,
        label: 'General',
        jsonContent: {},
        workflowType: 'regular',
        poseNodeId: 'person',
        upperNodeIds: ['garment'],
        garmentPhasePromptNode: 'prompt',
      })
      .returning();
    templateId = template.id;

    // Customer data that must keep counting.
    const [done] = await app.db
      .insert(schema.jobs)
      .values({
        userId: customerId,
        status: 'COMPLETED',
        source: 'tryon',
        creditsCharged: 5,
        startedAt: new Date(Date.now() - 20_000),
        completedAt: new Date(),
      })
      .returning();
    customerJobId = done.id;
    await app.db
      .insert(schema.jobInputs)
      .values({ jobId: done.id, params: { workflowTemplateId: templateId } });
    const resultKey = `outputs/${done.id}/result.png`;
    await app.storage.putObject(resultKey, new Uint8Array([1]), 'image/png');
    objects.add(resultKey);
    await app.db.insert(schema.jobOutputs).values({ jobId: done.id, resultKey });
    await app.db
      .insert(schema.jobs)
      .values({ userId: customerId, status: 'QUEUED', source: 'tryon', creditsCharged: 5 });
    await app.db
      .insert(schema.jobs)
      .values({ userId: customerId, status: 'FAILED', source: 'tryon', creditsCharged: 0 });
  }, 60_000);

  afterAll(async () => {
    if (app) {
      for (const key of objects) await app.storage.deleteObject(key);
      await app.close();
    }
    await c?.stop();
  });

  async function snapshot() {
    const stats = (await get('/admin/stats')).json();
    const credit = (await get('/admin/credit-analysis/users?days=all&pageSize=100')).json();
    const users = (await get('/admin/users?pageSize=100')).json();
    const wf = (await get(`/admin/workflows/${templateId}/stats`)).json();
    const exported = await loadUsersForExport(app, UsersExportQuery.parse({}));
    return { stats, credit, users, wf, exported };
  }

  it('leaves every reader unchanged once replay jobs and their system user exist', async () => {
    const before = await snapshot();
    // Sanity: the fixture is visible to the readers, so "unchanged" proves something.
    expect(before.wf).toMatchObject({ tracked: true, totalJobs: 1, completedJobs: 1 });
    expect(before.stats.queueDepth).toBeGreaterThanOrEqual(1);
    expect(before.stats.failed24h).toBeGreaterThanOrEqual(1);

    const systemUserId = await ensureComparisonSystemUser(app.db);
    const replay = (status: string, extra: Partial<typeof schema.jobs.$inferInsert> = {}) =>
      app.db
        .insert(schema.jobs)
        .values({
          userId: systemUserId,
          status,
          source: 'comparison',
          queueStream: 'inhouse',
          creditsCharged: 0,
          ...extra,
        })
        .returning();
    const [done] = await replay('COMPLETED', {
      startedAt: new Date(Date.now() - 60_000),
      completedAt: new Date(),
    });
    replayDoneId = done.id;
    await replay('QUEUED');
    await replay('FAILED');
    for (const j of await app.db.select().from(schema.jobs)) {
      if (j.source !== 'comparison') continue;
      await app.db
        .insert(schema.jobInputs)
        .values({ jobId: j.id, params: { workflowTemplateId: templateId, inhouse: true } })
        .onConflictDoNothing();
    }

    const after = await snapshot();

    expect(after.stats.jobsToday).toBe(before.stats.jobsToday);
    expect(after.stats.queueDepth).toBe(before.stats.queueDepth);
    expect(after.stats.activeUsersToday).toBe(before.stats.activeUsersToday);
    expect(after.stats.failed24h).toBe(before.stats.failed24h);
    expect(after.stats.newUsersToday).toBe(before.stats.newUsersToday);
    expect(after.stats.jobsPerDay).toEqual(before.stats.jobsPerDay);
    expect(after.credit.total).toBe(before.credit.total);
    expect(after.credit.summary).toEqual(before.credit.summary);
    expect(after.credit.items.map((i: { userId: string }) => i.userId)).not.toContain(systemUserId);
    expect(after.users.total).toBe(before.users.total);
    expect(after.users.items.map((u: { email: string }) => u.email)).not.toContain(SYSTEM_EMAIL);
    expect(after.wf).toEqual(before.wf);
    expect(after.exported.map((u) => u.email)).not.toContain(SYSTEM_EMAIL);
    expect(after.exported).toHaveLength(before.exported.length);
  });

  it('the credit-analysis source filters still behave (specific sources never matched replays)', async () => {
    for (const source of ['tryon', 'catalog', 'saree', 'shopify']) {
      const res = await get(`/admin/credit-analysis/users?days=all&source=${source}`);
      expect(res.statusCode).toBe(200);
    }
  });

  it('does not expose comparison-owned jobs in an authenticated customer job list', async () => {
    const { token, userId } = await createVerifiedUserToken(
      app,
      `comparison-list-${randomUUID()}@x.com`,
    );
    const [customerJob] = await app.db
      .insert(schema.jobs)
      .values({ userId, status: 'COMPLETED', source: 'tryon', creditsCharged: 1 })
      .returning();
    const systemUserId = await ensureComparisonSystemUser(app.db);
    const [replay] = await app.db
      .insert(schema.jobs)
      .values({
        userId: systemUserId,
        status: 'COMPLETED',
        source: 'comparison',
        creditsCharged: 0,
      })
      .returning();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { id: string }[]).map((job) => job.id);
    expect(ids).toContain(customerJob.id);
    expect(ids).not.toContain(replay.id);
  });

  it('the public kiosk batch download never serves a replay result, even by id', async () => {
    const replayKey = `outputs/${replayDoneId}/result.png`;
    await app.storage.putObject(replayKey, new Uint8Array([1]), 'image/png');
    objects.add(replayKey);
    await app.db.insert(schema.jobOutputs).values({ jobId: replayDoneId, resultKey: replayKey });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/kiosk-download/batch?jobIds=${replayDoneId},${customerJobId}`,
    });

    expect(res.statusCode).toBe(200);
    const ids = (res.json().items as { jobId: string }[]).map((i) => i.jobId);
    expect(ids).toContain(customerJobId);
    expect(ids).not.toContain(replayDoneId);
  });

  it('keeps jobs with a NULL (legacy) source in the business counts', async () => {
    const before = (await get('/admin/stats')).json();
    await app.db
      .insert(schema.jobs)
      .values({ userId: customerId, status: 'QUEUED', source: null, creditsCharged: 5 });
    const after = (await get('/admin/stats')).json();
    expect(after.queueDepth).toBe(before.queueDepth + 1);
    expect(after.jobsToday).toBe(before.jobsToday + 1);
  });
});
