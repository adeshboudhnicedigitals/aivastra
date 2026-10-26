import { randomUUID } from 'node:crypto';
import { eq, schema } from '@aivastra/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelQueuedComparisons,
  releaseUnusedArchives,
  runRetentionTick,
} from '../../src/modules/comparison/retention.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe('comparison retention and cancel-queued', () => {
  let c: Containers;
  let app: TestApp;
  let adminAuth: Record<string, string>;
  let templateId: string;
  const objects = new Set<string>();

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    adminAuth = await adminAuthHeader(app);
    const [template] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `retention_${randomUUID().replaceAll('-', '_')}`,
        label: 'General',
        jsonContent: {},
        workflowType: 'regular',
        poseNodeId: 'person',
        upperNodeIds: ['garment'],
        garmentPhasePromptNode: 'prompt',
      })
      .returning();
    templateId = template.id;
  }, 60_000);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await app.db.delete(schema.workflowTemplateArchives);
    await app.db.delete(schema.jobs);
    await app.redis.flushdb();
    // Retention must run with the feature OFF: privacy cleanup is not a toggle.
    await app.redis.set(
      'config:workflow-comparison',
      JSON.stringify({ enabled: false, retentionDays: 30, enabledSince: null }),
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (app) {
      for (const key of objects) await app.storage.deleteObject(key);
      // The Redis index is leased to the next file as-is; leave no settings behind.
      await app.redis.flushdb();
      await app.close();
    }
    await c?.stop();
  });

  async function put(key: string) {
    await app.storage.putObject(key, new Uint8Array([1]), 'image/jpeg');
    objects.add(key);
  }
  async function exists(key: string) {
    try {
      await app.storage.headObject(key);
      return true;
    } catch {
      return false;
    }
  }

  async function seedSource() {
    const [source] = await app.db
      .insert(schema.jobs)
      .values({ status: 'COMPLETED', source: 'tryon', completedAt: daysAgo(40) })
      .returning();
    const personKey = `inputs/${source.id}/person.jpg`;
    const garmentKey = `inputs/${source.id}/garment.jpg`;
    const resultKey = `outputs/${source.id}/result.png`;
    for (const k of [personKey, garmentKey, resultKey]) await put(k);
    await app.db
      .insert(schema.jobInputs)
      .values({ jobId: source.id, params: { personKey }, upperGarmentKey: garmentKey });
    await app.db.insert(schema.jobOutputs).values({ jobId: source.id, resultKey });
    return { source, personKey, garmentKey, resultKey };
  }

  /** A comparison row (plus its replay job and output objects when `replay` is set). */
  async function seedComparison(opts: {
    status: string;
    ageDays: number;
    replay?: { jobStatus: string; withOutput?: boolean };
  }) {
    const src = await seedSource();
    let replayId: string | null = null;
    const outputKeys: string[] = [];
    if (opts.replay) {
      const [replay] = await app.db
        .insert(schema.jobs)
        .values({ status: opts.replay.jobStatus, source: 'comparison', creditsCharged: 0 })
        .returning();
      replayId = replay.id;
      await app.db.insert(schema.jobInputs).values({
        jobId: replay.id,
        upperGarmentKey: src.garmentKey,
        params: { personKey: src.personKey, inhouse: true },
      });
      if (opts.replay.withOutput) {
        const resultKey = `outputs/${replay.id}/result.png`;
        const thumbnailKey = `outputs/${replay.id}/result.thumb.jpg`;
        await put(resultKey);
        await put(thumbnailKey);
        outputKeys.push(resultKey, thumbnailKey);
        await app.db
          .insert(schema.jobOutputs)
          .values({ jobId: replay.id, resultKey, thumbnailKey });
      }
    }
    const [row] = await app.db
      .insert(schema.workflowComparisons)
      .values({
        sourceJobId: src.source.id,
        generalJobId: replayId,
        templateId,
        templateVersion: 3,
        status: opts.status,
        personKey: opts.status === 'COLLECTED' ? src.personKey : null,
        garmentKey: opts.status === 'COLLECTED' ? src.garmentKey : null,
        createdAt: daysAgo(opts.ageDays),
        updatedAt: daysAgo(opts.ageDays),
      })
      .returning();
    return { ...src, row, replayId, outputKeys };
  }

  async function rowOf(id: string) {
    const [row] = await app.db
      .select()
      .from(schema.workflowComparisons)
      .where(eq(schema.workflowComparisons.id, id));
    return row;
  }
  async function jobOf(id: string) {
    const [job] = await app.db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
    return job;
  }

  describe('runRetentionTick', () => {
    it.each([
      'QUEUED',
      'GENERATING',
    ])('immediately erases a fresh EXPIRED %s replay', async (jobStatus) => {
      const s = await seedComparison({
        status: 'EXPIRED',
        ageDays: 0,
        replay: { jobStatus, withOutput: true },
      });
      expect((await runRetentionTick(app)).deleted).toBe(1);
      expect(await rowOf(s.row.id)).toBeUndefined();
      expect(await jobOf(s.replayId as string)).toBeUndefined();
      for (const key of s.outputKeys) expect(await exists(key)).toBe(false);
      expect(await exists(s.personKey)).toBe(true);
    });

    it('retries fresh EXPIRED output failures without losing either cleanup root', async () => {
      const s = await seedComparison({
        status: 'EXPIRED',
        ageDays: 0,
        replay: { jobStatus: 'GENERATING', withOutput: true },
      });
      const spy = vi.spyOn(app.storage, 'deleteObject').mockRejectedValueOnce(new Error('s3 down'));
      expect((await runRetentionTick(app)).deleted).toBe(0);
      expect((await rowOf(s.row.id))?.status).toBe('EXPIRED');
      expect((await jobOf(s.replayId as string))?.status).toBe('CANCELLED');
      spy.mockRestore();
      expect((await runRetentionTick(app)).deleted).toBe(1);
    });

    it('defers a busy output lock and retries the EXPIRED obligation next tick', async () => {
      const s = await seedComparison({
        status: 'EXPIRED',
        ageDays: 0,
        replay: { jobStatus: 'GENERATING', withOutput: true },
      });
      await app.withAdvisoryLock(`workflow-comparison:output:${s.replayId}`, async () => {
        expect((await runRetentionTick(app)).deleted).toBe(0);
        expect(await rowOf(s.row.id)).toBeDefined();
        expect(await exists(s.outputKeys[0])).toBe(true);
      });
      expect((await runRetentionTick(app)).deleted).toBe(1);
    });

    it('rejects generic retry while cleanup has paused during output deletion', async () => {
      const s = await seedComparison({
        status: 'FAILED',
        ageDays: 40,
        replay: { jobStatus: 'FAILED', withOutput: true },
      });
      const remove = app.storage.deleteObject.bind(app.storage);
      let enter!: () => void;
      let resume!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const resumed = new Promise<void>((resolve) => {
        resume = resolve;
      });
      vi.spyOn(app.storage, 'deleteObject').mockImplementationOnce(async (key) => {
        enter();
        await resumed;
        await remove(key);
      });
      const cleanup = runRetentionTick(app);
      await entered;
      try {
        const response = await app.inject({
          method: 'POST',
          url: `/admin/jobs/${s.replayId}/retry`,
          headers: adminAuth,
        });
        expect(response.statusCode).toBe(409);
        expect(await app.redis.xlen('jobs:inhouse')).toBe(0);
      } finally {
        resume();
        await cleanup;
      }
      expect(await rowOf(s.row.id)).toBeUndefined();
    });

    it('advances past a permanently stuck terminal batch on the next tick', async () => {
      const [source] = await app.db
        .insert(schema.jobs)
        .values({ status: 'COMPLETED', source: 'tryon' })
        .returning();
      const [customer] = await app.db
        .insert(schema.jobs)
        .values({ status: 'COMPLETED', source: 'tryon' })
        .returning();
      await app.db.insert(schema.workflowComparisons).values(
        Array.from({ length: 201 }, (_, n) => ({
          id: `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`,
          sourceJobId: source.id,
          generalJobId: n < 200 ? customer.id : null,
          templateId,
          templateVersion: n + 10,
          status: 'COMPLETED',
          createdAt: daysAgo(40),
          updatedAt: daysAgo(n < 200 ? 50 : 40),
        })),
      );
      await runRetentionTick(app);
      await runRetentionTick(app);
      expect(await rowOf('00000000-0000-4000-8000-000000000201')).toBeUndefined();
      expect(await rowOf('00000000-0000-4000-8000-000000000001')).toBeDefined();
    });

    it('ages terminal retention from completion rather than collection', async () => {
      const s = await seedComparison({
        status: 'COMPLETED',
        ageDays: 90,
        replay: { jobStatus: 'COMPLETED', withOutput: true },
      });
      await app.db
        .update(schema.workflowComparisons)
        .set({ updatedAt: new Date() })
        .where(eq(schema.workflowComparisons.id, s.row.id));
      expect((await runRetentionTick(app)).deleted).toBe(0);
      expect(await exists(s.outputKeys[0])).toBe(true);
    });

    it('attempts fresh privacy cleanup on the same tick despite a full stuck terminal batch', async () => {
      const [source] = await app.db
        .insert(schema.jobs)
        .values({ status: 'COMPLETED', source: 'tryon' })
        .returning();
      await app.db.insert(schema.workflowComparisons).values(
        Array.from({ length: 200 }, (_, n) => ({
          id: `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`,
          sourceJobId: source.id,
          generalJobId: source.id,
          templateId,
          templateVersion: n + 50,
          status: 'COMPLETED',
          createdAt: daysAgo(40),
          updatedAt: daysAgo(40),
        })),
      );
      const s = await seedComparison({
        status: 'EXPIRED',
        ageDays: 0,
        replay: { jobStatus: 'GENERATING', withOutput: true },
      });
      await app.db
        .update(schema.workflowComparisons)
        .set({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
        .where(eq(schema.workflowComparisons.id, s.row.id));
      expect((await runRetentionTick(app)).deleted).toBe(1);
      expect(await jobOf(s.replayId as string)).toBeUndefined();
    });

    async function seedArchiveBacklog(expireLast = false) {
      const [source] = await app.db
        .insert(schema.jobs)
        .values({ status: 'COMPLETED', source: 'tryon' })
        .returning();
      const templates = await app.db
        .insert(schema.workflowTemplates)
        .values(
          Array.from({ length: 201 }, () => ({
            slug: `archive_${randomUUID()}`,
            label: 'General',
            jsonContent: {},
            poseNodeId: 'person',
            upperNodeIds: ['garment'],
            garmentPhasePromptNode: 'prompt',
          })),
        )
        .returning();
      await app.db.insert(schema.workflowTemplateArchives).values(
        templates.map((template, n) => ({
          id: `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`,
          workflowTemplateId: template.id,
          version: 3,
          jsonContent: {},
          poseNodeId: 'person',
          upperNodeIds: ['garment'],
          garmentPhasePromptNode: 'prompt',
        })),
      );
      await app.db.insert(schema.workflowComparisons).values(
        templates.slice(0, expireLast ? 201 : 200).map((template, n) => ({
          sourceJobId: source.id,
          templateId: template.id,
          templateVersion: 3,
          status: 'COLLECTED',
          createdAt: daysAgo(n === 200 ? 40 : 1),
        })),
      );
      return templates[200].id;
    }

    it('advances archive recovery past the first 200 pinned versions', async () => {
      const lastTemplateId = await seedArchiveBacklog();
      await releaseUnusedArchives(app);
      await releaseUnusedArchives(app);
      expect(
        await app.db
          .select()
          .from(schema.workflowTemplateArchives)
          .where(eq(schema.workflowTemplateArchives.workflowTemplateId, lastTemplateId)),
      ).toHaveLength(0);
    });

    it('releases the exact expired version even beyond the archive recovery batch', async () => {
      const lastTemplateId = await seedArchiveBacklog(true);
      await runRetentionTick(app);
      expect(
        await app.db
          .select()
          .from(schema.workflowTemplateArchives)
          .where(eq(schema.workflowTemplateArchives.workflowTemplateId, lastTemplateId)),
      ).toHaveLength(0);
    });
    it('expires COLLECTED rows past retention (feature off) and clears their frozen keys', async () => {
      const old = await seedComparison({ status: 'COLLECTED', ageDays: 31 });
      const fresh = await seedComparison({ status: 'COLLECTED', ageDays: 5 });

      const result = await runRetentionTick(app);

      expect(result.expired).toBe(1);
      const expired = await rowOf(old.row.id);
      expect(expired?.status).toBe('EXPIRED');
      expect(expired?.personKey).toBeNull();
      expect(expired?.garmentKey).toBeNull();
      expect((await rowOf(fresh.row.id))?.status).toBe('COLLECTED');
      // Expiring never touches the source job's objects.
      expect(await exists(old.personKey)).toBe(true);
    });

    it('honours the configured retentionDays', async () => {
      await app.redis.set(
        'config:workflow-comparison',
        JSON.stringify({ enabled: false, retentionDays: 3, enabledSince: null }),
      );
      const row = await seedComparison({ status: 'COLLECTED', ageDays: 4 });
      await runRetentionTick(app);
      expect((await rowOf(row.row.id))?.status).toBe('EXPIRED');
    });

    it('deletes an old COMPLETED comparison: output objects, replay job and row — source intact', async () => {
      const s = await seedComparison({
        status: 'COMPLETED',
        ageDays: 31,
        replay: { jobStatus: 'COMPLETED', withOutput: true },
      });

      const result = await runRetentionTick(app);

      expect(result.deleted).toBe(1);
      for (const key of s.outputKeys) expect(await exists(key)).toBe(false);
      expect(await jobOf(s.replayId as string)).toBeUndefined();
      expect(await rowOf(s.row.id)).toBeUndefined();
      // The source job, its row data and every source object are untouched.
      expect((await jobOf(s.source.id))?.status).toBe('COMPLETED');
      for (const key of [s.personKey, s.garmentKey, s.resultKey]) {
        expect(await exists(key)).toBe(true);
      }
      const [srcInputs] = await app.db
        .select()
        .from(schema.jobInputs)
        .where(eq(schema.jobInputs.jobId, s.source.id));
      expect(srcInputs?.upperGarmentKey).toBe(s.garmentKey);
    });

    it('deletes old FAILED, CANCELLED, UNSUPPORTED and EXPIRED rows too', async () => {
      const failed = await seedComparison({
        status: 'FAILED',
        ageDays: 40,
        replay: { jobStatus: 'FAILED' },
      });
      const cancelled = await seedComparison({
        status: 'CANCELLED',
        ageDays: 40,
        replay: { jobStatus: 'CANCELLED' },
      });
      const unsupported = await seedComparison({ status: 'UNSUPPORTED', ageDays: 40 });
      const expired = await seedComparison({ status: 'EXPIRED', ageDays: 40 });

      expect((await runRetentionTick(app)).deleted).toBe(4);
      for (const s of [failed, cancelled, unsupported, expired]) {
        expect(await rowOf(s.row.id)).toBeUndefined();
      }
    });

    it('leaves recent terminal rows, and rows still in flight, alone', async () => {
      const recent = await seedComparison({
        status: 'COMPLETED',
        ageDays: 5,
        replay: { jobStatus: 'COMPLETED', withOutput: true },
      });
      const running = await seedComparison({
        status: 'RUNNING',
        ageDays: 90,
        replay: { jobStatus: 'GENERATING' },
      });
      const queued = await seedComparison({
        status: 'QUEUED',
        ageDays: 90,
        replay: { jobStatus: 'QUEUED' },
      });

      const result = await runRetentionTick(app);

      expect(result).toEqual({ expired: 0, deleted: 0 });
      for (const key of recent.outputKeys) expect(await exists(key)).toBe(true);
      for (const s of [recent, running, queued]) expect(await rowOf(s.row.id)).toBeDefined();
    });

    it('keeps the row and replay job when an output delete fails, and finishes on the next tick', async () => {
      const s = await seedComparison({
        status: 'COMPLETED',
        ageDays: 31,
        replay: { jobStatus: 'COMPLETED', withOutput: true },
      });
      const spy = vi.spyOn(app.storage, 'deleteObject').mockRejectedValueOnce(new Error('s3 down'));

      const first = await runRetentionTick(app);

      expect(first.deleted).toBe(0);
      expect(await rowOf(s.row.id)).toBeDefined();
      expect(await jobOf(s.replayId as string)).toBeDefined();
      spy.mockRestore();

      expect((await runRetentionTick(app)).deleted).toBe(1);
      expect(await rowOf(s.row.id)).toBeUndefined();
      for (const key of s.outputKeys) expect(await exists(key)).toBe(false);
    });

    it('never deletes a job that is not a comparison replay, even if a row points at it', async () => {
      const s = await seedComparison({ status: 'COMPLETED', ageDays: 40 });
      const [customer] = await app.db
        .insert(schema.jobs)
        .values({ status: 'COMPLETED', source: 'tryon', creditsCharged: 5 })
        .returning();
      const key = `outputs/${customer.id}/result.png`;
      await put(key);
      await app.db.insert(schema.jobOutputs).values({ jobId: customer.id, resultKey: key });
      await app.db
        .update(schema.workflowComparisons)
        .set({ generalJobId: customer.id })
        .where(eq(schema.workflowComparisons.id, s.row.id));

      const result = await runRetentionTick(app);

      expect(result.deleted).toBe(0);
      expect(await jobOf(customer.id)).toBeDefined();
      expect(await exists(key)).toBe(true);
      expect(await rowOf(s.row.id)).toBeDefined();
    });

    it('releases an archived template version once its last comparison expires', async () => {
      const old = await seedComparison({ status: 'COLLECTED', ageDays: 31 });
      const [live] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, templateId));
      await app.db.insert(schema.workflowTemplateArchives).values({
        workflowTemplateId: templateId,
        version: 3,
        jsonContent: {},
        poseNodeId: live.poseNodeId,
        upperNodeIds: live.upperNodeIds,
        garmentPhasePromptNode: live.garmentPhasePromptNode,
      });

      await runRetentionTick(app);

      expect((await rowOf(old.row.id))?.status).toBe('EXPIRED');
      expect(await app.db.select().from(schema.workflowTemplateArchives)).toHaveLength(0);
    });

    it('keeps an archived version that a younger comparison still needs', async () => {
      await seedComparison({ status: 'COLLECTED', ageDays: 31 });
      await seedComparison({ status: 'COLLECTED', ageDays: 2 });
      const [live] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, templateId));
      await app.db.insert(schema.workflowTemplateArchives).values({
        workflowTemplateId: templateId,
        version: 3,
        jsonContent: {},
        poseNodeId: live.poseNodeId,
        upperNodeIds: live.upperNodeIds,
        garmentPhasePromptNode: live.garmentPhasePromptNode,
      });

      await runRetentionTick(app);

      expect(await app.db.select().from(schema.workflowTemplateArchives)).toHaveLength(1);
    });

    it('recovers an orphaned archive left by a crash between expiry and cleanup', async () => {
      const [live] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, templateId));
      await app.db.insert(schema.workflowTemplateArchives).values({
        workflowTemplateId: templateId,
        version: 3,
        jsonContent: {},
        poseNodeId: live.poseNodeId,
        upperNodeIds: live.upperNodeIds,
        garmentPhasePromptNode: live.garmentPhasePromptNode,
      });

      await runRetentionTick(app);

      expect(await app.db.select().from(schema.workflowTemplateArchives)).toHaveLength(0);
    });
  });

  describe('cancelQueuedComparisons', () => {
    it('cancels a QUEUED replay and its row, and leaves a started one alone', async () => {
      const queued = await seedComparison({
        status: 'QUEUED',
        ageDays: 1,
        replay: { jobStatus: 'QUEUED' },
      });
      // Row not yet reconciled to RUNNING, but the job has started: must not be touched.
      const started = await seedComparison({
        status: 'QUEUED',
        ageDays: 1,
        replay: { jobStatus: 'GENERATING' },
      });
      const running = await seedComparison({
        status: 'RUNNING',
        ageDays: 1,
        replay: { jobStatus: 'GENERATING' },
      });

      const result = await cancelQueuedComparisons(app);

      expect(result).toEqual({ cancelled: 1 });
      expect((await rowOf(queued.row.id))?.status).toBe('CANCELLED');
      const job = await jobOf(queued.replayId as string);
      expect(job?.status).toBe('CANCELLED');
      expect(job?.errorCode).toBe('ADMIN_CANCEL');
      expect((await rowOf(started.row.id))?.status).toBe('QUEUED');
      expect((await jobOf(started.replayId as string))?.status).toBe('GENERATING');
      expect((await rowOf(running.row.id))?.status).toBe('RUNNING');
      expect((await jobOf(running.replayId as string))?.status).toBe('GENERATING');
    });

    it('writes no credit ledger rows', async () => {
      await seedComparison({ status: 'QUEUED', ageDays: 1, replay: { jobStatus: 'QUEUED' } });
      const before = (await app.db.select().from(schema.creditLedger)).length;
      await cancelQueuedComparisons(app);
      expect(await app.db.select().from(schema.creditLedger)).toHaveLength(before);
    });

    it('releases the archived version a cancelled comparison was holding', async () => {
      await seedComparison({ status: 'QUEUED', ageDays: 1, replay: { jobStatus: 'QUEUED' } });
      const [live] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, templateId));
      await app.db.insert(schema.workflowTemplateArchives).values({
        workflowTemplateId: templateId,
        version: 3,
        jsonContent: {},
        poseNodeId: live.poseNodeId,
        upperNodeIds: live.upperNodeIds,
        garmentPhasePromptNode: live.garmentPhasePromptNode,
      });

      await cancelQueuedComparisons(app);

      expect(await app.db.select().from(schema.workflowTemplateArchives)).toHaveLength(0);
    });
  });

  describe('POST /admin/comparison/cancel-queued', () => {
    const URL = '/admin/comparison/cancel-queued';

    it('cancels queued replays and writes one audit row', async () => {
      const queued = await seedComparison({
        status: 'QUEUED',
        ageDays: 1,
        replay: { jobStatus: 'QUEUED' },
      });
      const before = (await app.db.select().from(schema.auditLogs)).length;

      const res = await app.inject({ method: 'POST', url: URL, headers: adminAuth });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ cancelled: 1 });
      expect((await rowOf(queued.row.id))?.status).toBe('CANCELLED');
      const audits = await app.db.select().from(schema.auditLogs);
      expect(audits).toHaveLength(before + 1);
      const audit = audits.find((a) => a.action === 'comparison.cancel_queued');
      expect(audit?.resourceType).toBe('workflow_comparison');
      expect(audit?.after).toMatchObject({ cancelled: 1 });
    });

    it('writes an audit row even when nothing was queued', async () => {
      const before = (await app.db.select().from(schema.auditLogs)).length;
      const res = await app.inject({ method: 'POST', url: URL, headers: adminAuth });
      expect(res.json()).toEqual({ cancelled: 0 });
      expect(await app.db.select().from(schema.auditLogs)).toHaveLength(before + 1);
    });

    it('is forbidden without config.write', async () => {
      const support = await adminAuthHeader(app, 'SUPPORT');
      const res = await app.inject({ method: 'POST', url: URL, headers: support });
      expect(res.statusCode).toBe(403);
    });
  });
});
