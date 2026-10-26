import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReplayJob } from '../../src/modules/comparison/create-replay-job.js';
import {
  isInhouseWorkerIdle,
  runDispatchTick,
} from '../../src/modules/comparison/dispatcher-tick.js';
import { ensureComparisonSystemUser } from '../../src/modules/comparison/system-user.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('comparison replay dispatch', () => {
  let c: Containers;
  let app: TestApp;
  let templateId: string;
  const objects = new Set<string>();
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    const [template] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `dispatch_${randomUUID().replaceAll('-', '_')}`,
        label: 'General',
        jsonContent: {},
        workflowType: 'regular',
        poseNodeId: 'person',
        upperNodeIds: ['garment'],
        garmentPhasePromptNode: 'prompt',
      })
      .returning();
    templateId = template.id;
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    // This test owns its isolated database, Redis index and fixture objects.
    await app.db.delete(schema.jobs);
    await app.db
      .delete(schema.users)
      .where(eq(schema.users.email, 'comparison-system@aivastra.internal'));
    await app.db.delete(schema.workers);
    await app.redis.flushdb();
    await app.redis.set(
      'config:workflow-comparison',
      JSON.stringify({
        enabled: true,
        enabledSince: '2026-01-01T00:00:00.000Z',
      }),
    );
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (app) {
      for (const key of objects) await app.storage.deleteObject(key);
      await app.close();
    }
    await c?.stop();
  });
  async function collected() {
    const [source] = await app.db
      .insert(schema.jobs)
      .values({
        status: 'COMPLETED',
        source: 'tryon',
        completedAt: new Date(),
      })
      .returning();
    const personKey = `inputs/${source.id}/person.jpg`;
    const garmentKey = `inputs/${source.id}/garment.jpg`;
    const resultKey = `outputs/${source.id}.png`;
    for (const key of [personKey, garmentKey, resultKey]) {
      await app.storage.putObject(key, new Uint8Array([1]), 'image/jpeg');
      objects.add(key);
    }
    await app.db
      .insert(schema.jobInputs)
      .values({ jobId: source.id, params: { personKey }, upperGarmentKey: garmentKey });
    await app.db.insert(schema.jobOutputs).values({ jobId: source.id, resultKey });
    const [comparison] = await app.db
      .insert(schema.workflowComparisons)
      .values({
        sourceJobId: source.id,
        templateId,
        templateVersion: 3,
        personKey,
        garmentKey,
        status: 'COLLECTED',
      })
      .returning();
    return { source, comparison, personKey, garmentKey, resultKey };
  }
  async function worker() {
    await app.db.insert(schema.workers).values({
      id: 'comparison-worker',
      url: 'http://unused.invalid',
      apiKey: 'fixture',
      allowedJobTypes: ['inhouse'],
    });
    await registry();
    await app.redis.set('worker:health:comparison-worker', '1', 'EX', 60);
  }
  async function registry(overrides: object = {}) {
    await app.redis.hset(
      'worker:registry',
      'comparison-worker',
      JSON.stringify({
        status: 'IDLE',
        lastSeen: Date.now(),
        allowedJobTypes: ['inhouse'],
        ...overrides,
      }),
    );
  }
  const comparisons = () => app.db.select().from(schema.workflowComparisons);
  const replays = () =>
    app.db.select().from(schema.jobs).where(eq(schema.jobs.source, 'comparison'));

  it('creates a system-owned zero-credit replay with frozen params and no worker pin', async () => {
    const systemUserId = await ensureComparisonSystemUser(app.db);
    expect(await ensureComparisonSystemUser(app.db)).toBe(systemUserId);
    const [user] = await app.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, systemUserId));
    expect(user).toMatchObject({ passwordHash: null, isBanned: false, isOrganizationMember: true });
    const { jobId } = await createReplayJob(app, {
      systemUserId,
      personKey: 'person.jpg',
      garmentKey: 'garment.jpg',
      templateId,
      templateVersion: 3,
    });
    expect(await replays()).toMatchObject([
      {
        id: jobId,
        userId: systemUserId,
        status: 'QUEUED',
        queueStream: 'inhouse',
        creditsCharged: 0,
        watermark: false,
        merchantId: null,
        shopifyStoreId: null,
        apiKeyId: null,
      },
    ]);
    const [input] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, jobId));
    expect(input).toMatchObject({ upperGarmentKey: 'garment.jpg' });
    expect(input.params).toEqual({
      personKey: 'person.jpg',
      workflowTemplateId: templateId,
      dispatchTemplateVersion: 3,
      inhouse: true,
    });
    expect(
      await app.db.select().from(schema.creditLedger).where(eq(schema.creditLedger.jobId, jobId)),
    ).toEqual([]);
    expect(await app.redis.xrange('jobs:inhouse', '-', '+')).toMatchObject([
      [expect.any(String), ['jobId', jobId, 'userId', systemUserId]],
    ]);
  });
  it('refuses to adopt or alter a customer at the reserved email, including their existing session', async () => {
    const [customer] = await app.db
      .insert(schema.users)
      .values({
        email: 'comparison-system@aivastra.internal',
        passwordHash: 'fixture-password-hash',
        isBanned: true,
        displayName: 'Existing customer',
      })
      .returning();
    const [session] = await app.db
      .insert(schema.refreshTokens)
      .values({
        userId: customer.id,
        familyId: randomUUID(),
        tokenHash: 'fixture-session-hash',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    await expect(ensureComparisonSystemUser(app.db)).rejects.toThrow(
      'COMPARISON_SYSTEM_IDENTITY_CONFLICT',
    );
    expect(
      await app.db.select().from(schema.users).where(eq(schema.users.id, customer.id)),
    ).toEqual([customer]);
    expect(
      await app.db
        .select()
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.id, session.id)),
    ).toEqual([session]);
    expect(await replays()).toEqual([]);
  });
  it('fails closed if a previously provisioned system identity acquires a session', async () => {
    const id = await ensureComparisonSystemUser(app.db);
    await app.db.insert(schema.refreshTokens).values({
      userId: id,
      familyId: randomUUID(),
      tokenHash: 'fixture-system-session',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(ensureComparisonSystemUser(app.db)).rejects.toThrow(
      'COMPARISON_SYSTEM_IDENTITY_CONFLICT',
    );
  });
  it.each([
    ['QUEUED', 'null'],
    ['RUNNING', 'null'],
    ['QUEUED', 'deleted'],
    ['RUNNING', 'deleted'],
  ])('fails an orphan %s comparison with %s replay and dispatches the next sample', async (status, mode) => {
    const orphan = await collected();
    let generalJobId: string | null = null;
    if (mode === 'deleted') {
      const [replay] = await app.db
        .insert(schema.jobs)
        .values({ source: 'comparison', creditsCharged: 0 })
        .returning();
      generalJobId = replay.id;
    }
    await app.db
      .update(schema.workflowComparisons)
      .set({ status, generalJobId })
      .where(eq(schema.workflowComparisons.id, orphan.comparison.id));
    if (generalJobId) await app.db.delete(schema.jobs).where(eq(schema.jobs.id, generalJobId));
    const next = await collected();
    await worker();
    expect(await runDispatchTick(app)).toEqual({ dispatched: true, skipped: null });
    expect(await comparisons()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: orphan.comparison.id,
          status: 'FAILED',
          unsupportedReason: 'REPLAY_MISSING',
        }),
        expect.objectContaining({
          id: next.comparison.id,
          status: 'QUEUED',
          generalJobId: expect.any(String),
        }),
      ]),
    );
    expect(await replays()).toHaveLength(1);
  });
  it('reconciles an orphaned active comparison while disabled', async () => {
    const orphan = await collected();
    await app.db
      .update(schema.workflowComparisons)
      .set({ status: 'RUNNING' })
      .where(eq(schema.workflowComparisons.id, orphan.comparison.id));
    await app.redis.del('config:workflow-comparison');
    expect((await runDispatchTick(app)).skipped).toBe('disabled');
    expect(await comparisons()).toMatchObject([
      { status: 'FAILED', unsupportedReason: 'REPLAY_MISSING' },
    ]);
    await collected();
    await worker();
    await app.redis.set(
      'config:workflow-comparison',
      JSON.stringify({ enabled: true, enabledSince: '2026-01-01T00:00:00.000Z' }),
    );
    expect(await runDispatchTick(app)).toEqual({ dispatched: true, skipped: null });
  });
  it('disabled dispatch creates no replay', async () => {
    await collected();
    await worker();
    await app.redis.del('config:workflow-comparison');
    expect(await runDispatchTick(app)).toEqual({ dispatched: false, skipped: 'disabled' });
    expect(await replays()).toEqual([]);
  });
  it.each([
    'QUEUED',
    'PREPROCESSING',
    'GENERATING',
    'UPLOADING',
  ])('defers to a %s manual inhouse job including historical null source', async (status) => {
    await collected();
    await worker();
    await app.db.insert(schema.jobs).values({ queueStream: 'inhouse', status });
    expect((await runDispatchTick(app)).skipped).toBe('busy');
    expect(await replays()).toEqual([]);
  });
  it('defers to an existing queued comparison', async () => {
    const s = await collected();
    await worker();
    const [replay] = await app.db
      .insert(schema.jobs)
      .values({ source: 'comparison', creditsCharged: 0, status: 'QUEUED', queueStream: 'inhouse' })
      .returning();
    await app.db
      .update(schema.workflowComparisons)
      .set({ status: 'QUEUED', generalJobId: replay.id })
      .where(eq(schema.workflowComparisons.id, s.comparison.id));
    expect((await runDispatchTick(app)).skipped).toBe('busy');
    expect(await replays()).toHaveLength(1);
  });
  it('creates no job without an inhouse worker', async () => {
    await collected();
    expect(await runDispatchTick(app)).toEqual({ dispatched: false, skipped: 'no_worker' });
    expect(await replays()).toEqual([]);
  });
  it.each([
    'inactive',
    'untagged',
    'unhealthy',
    'busy',
    'stale',
    'malformed',
  ])('requires an active, tagged, healthy recent idle worker: %s', async (mode) => {
    await worker();
    if (mode === 'inactive') await app.db.update(schema.workers).set({ isActive: false });
    if (mode === 'untagged') await app.db.update(schema.workers).set({ allowedJobTypes: [] });
    if (mode === 'unhealthy') await app.redis.del('worker:health:comparison-worker');
    if (mode === 'busy') await registry({ status: 'BUSY' });
    if (mode === 'stale') await registry({ lastSeen: Date.now() - 300_000 });
    if (mode === 'malformed') await app.redis.hset('worker:registry', 'comparison-worker', '{');
    expect(await isInhouseWorkerIdle(app)).toBe(false);
  });
  it('overlapping ticks create exactly one replay linked to the frozen oldest comparison', async () => {
    const first = await collected();
    await collected();
    await worker();
    // Input edits after collection must not change the replay mapping.
    await app.db
      .update(schema.jobInputs)
      .set({ params: { personKey: 'edited' }, upperGarmentKey: 'edited' })
      .where(eq(schema.jobInputs.jobId, first.source.id));
    const results = await Promise.all([runDispatchTick(app), runDispatchTick(app)]);
    expect(results.filter((r) => r.dispatched)).toHaveLength(1);
    const [job] = await replays();
    expect(await replays()).toHaveLength(1);
    expect(await comparisons()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.comparison.id,
          status: 'QUEUED',
          generalJobId: job.id,
        }),
      ]),
    );
    const [input] = await app.db
      .select()
      .from(schema.jobInputs)
      .where(eq(schema.jobInputs.jobId, job.id));
    expect(input.params).toMatchObject({
      personKey: first.personKey,
      workflowTemplateId: templateId,
      dispatchTemplateVersion: 3,
    });
    expect(input.upperGarmentKey).toBe(first.garmentKey);
  });
  it.each([
    'PREPROCESSING',
    'GENERATING',
    'UPLOADING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ])('reconciles %s even while disabled', async (status) => {
    await collected();
    await worker();
    await runDispatchTick(app);
    const [job] = await replays();
    await app.db.update(schema.jobs).set({ status }).where(eq(schema.jobs.id, job.id));
    await app.redis.del('config:workflow-comparison');
    await runDispatchTick(app);
    expect(await comparisons()).toMatchObject([
      {
        status: ['PREPROCESSING', 'GENERATING', 'UPLOADING'].includes(status) ? 'RUNNING' : status,
      },
    ]);
  });
  it.each([
    'personKey',
    'garmentKey',
    'resultKey',
  ])('expires a collected source when %s disappears', async (field) => {
    const s = await collected();
    await worker();
    await app.storage.deleteObject(s[field as 'personKey']);
    await runDispatchTick(app);
    expect(await replays()).toEqual([]);
    expect(await comparisons()).toMatchObject([
      { status: 'EXPIRED', personKey: null, garmentKey: null },
    ]);
  });
  it('does not dispatch a source erased after collection', async () => {
    const s = await collected();
    await worker();
    await app.db
      .update(schema.jobInputs)
      .set({ params: { personKey: s.personKey, comparisonErased: true } })
      .where(eq(schema.jobInputs.jobId, s.source.id));
    await runDispatchTick(app);
    expect(await replays()).toEqual([]);
    expect(await comparisons()).toMatchObject([{ status: 'EXPIRED' }]);
  });
  it('cancels an ambiguously enqueued job and fails its comparison without touching the ledger', async () => {
    await collected();
    await worker();
    vi.spyOn(app.redis, 'xadd').mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(runDispatchTick(app)).rejects.toThrow();
    expect(await replays()).toMatchObject([{ status: 'CANCELLED', errorCode: 'ENQUEUE_FAIL' }]);
    expect(await comparisons()).toMatchObject([{ status: 'FAILED' }]);
    expect(await app.db.select().from(schema.creditLedger)).toEqual([]);
  });
  it('fails abandoned enqueue intent without re-enqueuing or charging, even disabled', async () => {
    const s = await collected();
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        source: 'comparison',
        queueStream: 'inhouse',
        creditsCharged: 0,
        status: 'QUEUED',
        errorCode: 'COMPARISON_ENQUEUE_PENDING',
        createdAt: new Date(Date.now() - 300_000),
      })
      .returning();
    await app.db
      .update(schema.workflowComparisons)
      .set({ status: 'QUEUED', generalJobId: job.id })
      .where(eq(schema.workflowComparisons.id, s.comparison.id));
    await app.redis.del('config:workflow-comparison');
    await runDispatchTick(app);
    expect(await replays()).toMatchObject([
      { status: 'CANCELLED', errorCode: 'ENQUEUE_UNCONFIRMED' },
    ]);
    expect(await comparisons()).toMatchObject([{ status: 'CANCELLED' }]);
    expect(await app.redis.xlen('jobs:inhouse')).toBe(0);
    expect(await app.db.select().from(schema.creditLedger)).toEqual([]);
  });
});
