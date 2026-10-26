import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { maybeCleanupArchive } from '../../../dispatcher/src/workflow/drain-cleanup.js';
import { runCollectorTick } from '../../src/modules/comparison/collector.js';
import { resolveGeneralTemplate } from '../../src/modules/comparison/general-template.js';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

const SETTINGS_KEY = 'config:workflow-comparison';
// Sources must sit inside the retention window, so dates are relative to now.
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const graph = {
  person: { class_type: 'LoadImage', inputs: { image: '' } },
  garment: { class_type: 'LoadImage', inputs: { image: '' } },
  prompt: { class_type: 'CLIPTextEncode', inputs: { prompt: '' } },
};
describe('comparison collector and frozen archive retention', () => {
  let c: Containers;
  let app: TestApp;
  let template: typeof schema.workflowTemplates.$inferSelect;
  let headers: Record<string, string>;
  const objects = new Set<string>();
  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app);
  });
  beforeEach(async () => {
    // This file owns its isolated database and these fixture jobs.
    await app.db.delete(schema.jobs);
    await app.db.delete(schema.tryonCategories);
    [template] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `comparison_${randomUUID().replaceAll('-', '_')}`,
        label: 'General',
        jsonContent: graph,
        workflowType: 'regular',
        poseNodeId: 'person',
        upperNodeIds: ['garment'],
        garmentPhasePromptNode: 'prompt',
      })
      .returning();
    await app.db
      .insert(schema.tryonCategories)
      .values({ name: 'General', slug: 'general', workflowTemplateId: template.id });
    await enable();
  });
  afterAll(async () => {
    if (app) {
      for (const key of objects) await app.storage.deleteObject(key);
      await app.close();
    }
    await c?.stop();
  });
  async function enable(backlogCap = 200) {
    await app.redis.set(
      SETTINGS_KEY,
      JSON.stringify({
        enabled: true,
        backlogCap,
        retentionDays: 30,
        enabledSince: '2026-01-01T00:00:00.000Z',
      }),
    );
  }
  async function source(
    overrides: Partial<typeof schema.jobs.$inferInsert> = {},
    params: object = {},
  ) {
    const id = randomUUID();
    const person = `inputs/${id}/person.jpg`,
      garment = `inputs/${id}/garment.jpg`,
      result = `outputs/${id}.png`;
    for (const key of [person, garment, result]) {
      await app.storage.putObject(key, new Uint8Array([1]), 'image/jpeg');
      objects.add(key);
    }
    const [job] = await app.db
      .insert(schema.jobs)
      .values({
        id,
        source: 'tryon',
        status: 'COMPLETED',
        completedAt: daysAgo(1),
        ...overrides,
      })
      .returning();
    await app.db
      .insert(schema.jobInputs)
      .values({ jobId: id, upperGarmentKey: garment, params: { personKey: person, ...params } });
    await app.db.insert(schema.jobOutputs).values({ jobId: id, resultKey: result });
    return { job, person, garment, result };
  }
  const comparisons = () => app.db.select().from(schema.workflowComparisons);
  it('disabled collection inserts nothing', async () => {
    await source();
    await app.redis.del(SETTINGS_KEY);
    expect(await runCollectorTick(app)).toEqual({
      collected: 0,
      unsupported: 0,
      skipped: 'disabled',
    });
    expect(await comparisons()).toEqual([]);
  });
  it('freezes template version, input mapping and provenance and deduplicates later ticks', async () => {
    const sourceTemplateId = randomUUID();
    const s = await source({}, { workflowTemplateId: sourceTemplateId });
    expect(await runCollectorTick(app)).toEqual({ collected: 1, unsupported: 0, skipped: null });
    expect(await comparisons()).toMatchObject([
      {
        sourceJobId: s.job.id,
        templateId: template.id,
        templateVersion: 1,
        status: 'COLLECTED',
        personKey: s.person,
        garmentKey: s.garment,
        sourceSource: 'tryon',
        sourceTemplateId,
      },
    ]);
    await runCollectorTick(app);
    expect(await comparisons()).toHaveLength(1);
  });
  it('records face jobs as unsupported without frozen inputs', async () => {
    const s = await source();
    const [face] = await app.db
      .insert(schema.modelFaces)
      .values({ gender: 'men', label: 'face', r2Key: 'face', thumbnailKey: 'face' })
      .returning();
    await app.db
      .update(schema.jobInputs)
      .set({ faceId: face.id })
      .where(eq(schema.jobInputs.jobId, s.job.id));
    expect((await runCollectorTick(app)).unsupported).toBe(1);
    expect(await comparisons()).toMatchObject([
      { status: 'UNSUPPORTED', unsupportedReason: 'FACE_POSE_BG_JOB', personKey: null },
    ]);
  });
  it('ignores disabled-period jobs and comparison replays', async () => {
    await source({ completedAt: new Date('2025-12-31') });
    await source({ source: 'comparison' });
    await runCollectorTick(app);
    expect(await comparisons()).toEqual([]);
  });
  it('enforces backlog cap across overlapping ticks with distinct sources', async () => {
    await enable(1);
    await source();
    await source();
    const results = await Promise.all([runCollectorTick(app), runCollectorTick(app)]);
    expect(results.reduce((n, r) => n + r.collected, 0)).toBe(1);
    expect(await comparisons()).toHaveLength(1);
    expect((await runCollectorTick(app)).skipped).toBe('backlog_full');
  });
  it('deduplicates overlapping ticks on the same source', async () => {
    await source();
    await Promise.all([runCollectorTick(app), runCollectorTick(app)]);
    expect(await comparisons()).toHaveLength(1);
  });
  it.each([
    'missing',
    'inactive_template',
    'inactive_category',
  ] as const)('fails closed when general is %s', async (mode) => {
    await source();
    if (mode === 'missing') await app.db.delete(schema.tryonCategories);
    if (mode === 'inactive_template')
      await app.db
        .update(schema.workflowTemplates)
        .set({ isActive: false })
        .where(eq(schema.workflowTemplates.id, template.id));
    if (mode === 'inactive_category')
      await app.db.update(schema.tryonCategories).set({ isActive: false });
    expect(await resolveGeneralTemplate(app.db)).toBeNull();
    expect((await runCollectorTick(app)).skipped).toBe('no_general');
    expect(await comparisons()).toEqual([]);
  });
  it('uses latest dispatch event to skip sources already using general', async () => {
    const s = await source();
    await app.db.insert(schema.jobEvents).values([
      {
        jobId: s.job.id,
        eventType: 'COMFY_DISPATCH',
        payload: { workflowTemplateId: randomUUID() },
        createdAt: new Date('2026-01-01'),
      },
      {
        jobId: s.job.id,
        eventType: 'COMFY_DISPATCH',
        payload: { workflowTemplateId: template.id },
        createdAt: new Date('2026-02-01'),
      },
    ]);
    await runCollectorTick(app);
    expect(await comparisons()).toEqual([]);
  });
  it.each([
    'person',
    'garment',
    'result',
  ] as const)('expires source with missing %s object without crashing', async (missing) => {
    const s = await source();
    await app.storage.deleteObject(s[missing]);
    expect((await runCollectorTick(app)).collected).toBe(0);
    expect(await comparisons()).toMatchObject([
      { status: 'EXPIRED', personKey: null, garmentKey: null },
    ]);
  });
  it('skips stringified general params before applying the batch limit', async () => {
    const old = await source({ completedAt: daysAgo(10) });
    await app.db
      .update(schema.jobInputs)
      .set({ params: JSON.stringify({ personKey: old.person, workflowTemplateId: template.id }) })
      .where(eq(schema.jobInputs.jobId, old.job.id));
    const newer = await source();
    expect((await runCollectorTick(app, { batch: 1 })).collected).toBe(1);
    expect(await comparisons()).toMatchObject([{ sourceJobId: newer.job.id }]);
  });
  it('ignores sources older than retentionDays so a retention-deleted row is never recollected', async () => {
    const stale = await source({ completedAt: daysAgo(31) });
    const recent = await source({ completedAt: daysAgo(2) });
    expect((await runCollectorTick(app)).collected).toBe(1);
    expect(await comparisons()).toMatchObject([{ sourceJobId: recent.job.id }]);
    expect((await comparisons()).some((r) => r.sourceJobId === stale.job.id)).toBe(false);
  });
  it('does not recollect erased sources', async () => {
    await source({}, { comparisonErased: true });
    await runCollectorTick(app);
    expect(await comparisons()).toEqual([]);
  });
  it('bounds each collection pass', async () => {
    await source();
    await source();
    expect((await runCollectorTick(app, { batch: 1 })).collected).toBe(1);
    expect((await runCollectorTick(app, { batch: 1 })).collected).toBe(1);
  });
  it('archives collected outgoing versions and cleanup releases only after expiration', async () => {
    const s = await source();
    await app.db.insert(schema.workflowComparisons).values({
      sourceJobId: s.job.id,
      templateId: template.id,
      templateVersion: 1,
      status: 'COLLECTED',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/workflows/${template.id}/replace`,
      headers,
      payload: {
        slug: template.slug,
        label: 'Updated',
        jsonContent: graph,
        workflowType: 'regular',
        poseNodeId: 'person',
        upperNodeIds: ['garment'],
        garmentPhasePromptNode: 'prompt',
        password: 'password123',
      },
    });
    expect(res.statusCode).toBe(200);
    const archives = () =>
      app.db
        .select()
        .from(schema.workflowTemplateArchives)
        .where(eq(schema.workflowTemplateArchives.workflowTemplateId, template.id));
    expect(await archives()).toMatchObject([{ version: 1 }]);
    await maybeCleanupArchive(app.db, template.id, 1);
    expect(await archives()).toHaveLength(1);
    await app.db
      .update(schema.workflowComparisons)
      .set({ status: 'EXPIRED' })
      .where(eq(schema.workflowComparisons.sourceJobId, s.job.id));
    await maybeCleanupArchive(app.db, template.id, 1);
    expect(await archives()).toEqual([]);
  });
});
