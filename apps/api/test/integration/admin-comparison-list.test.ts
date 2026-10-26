import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { createVerifiedUserToken } from '../helpers/auth.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin workflow comparisons list and detail', () => {
  let c: Containers;
  let app: TestApp;
  let headers: Record<string, string>;
  let customerHeaders: Record<string, string>;
  let sourceTemplateId: string;
  let generalTemplateId: string;
  let removedCursorStatus: string;
  const objectKeys = new Set<string>();
  const createdAt = new Date('2026-10-20T12:00:00.000Z');

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);
    headers = await adminAuthHeader(app);
    const { token } = await createVerifiedUserToken(
      app,
      `comparison-reader-${randomUUID()}@x.test`,
    );
    customerHeaders = { authorization: `Bearer ${token}` };
    const [sourceTemplate] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `comparison-source-${randomUUID()}`,
        label: 'Specialized Source Workflow',
        jsonContent: {},
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
        tryonPersonNodeId: '3',
        tryonGarmentNodeId: '4',
        workflowType: 'tryon',
      })
      .returning();
    sourceTemplateId = sourceTemplate.id;
    const [generalTemplate] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `comparison-general-${randomUUID()}`,
        label: 'General Try-On',
        jsonContent: {},
        poseNodeId: '1',
        upperNodeIds: [],
        garmentPhasePromptNode: '2',
        tryonPersonNodeId: '3',
        tryonGarmentNodeId: '4',
        workflowType: 'tryon',
      })
      .returning();
    generalTemplateId = generalTemplate.id;
  }, 60_000);

  afterAll(async () => {
    if (app) {
      for (const key of objectKeys) await app.storage.deleteObject(key);
      await app.close();
    }
    await c?.stop();
  });

  async function seedComparison(opts: {
    status: string;
    sourceSource?: string | null;
    dispatched?: boolean;
    createdAt?: Date;
  }) {
    const nonce = randomUUID();
    const personKey = `inputs/${nonce}/person.jpg`;
    const garmentKey = `inputs/${nonce}/garment.jpg`;
    const originalResultKey = `outputs/${nonce}/original.png`;
    for (const key of [personKey, garmentKey, originalResultKey]) {
      await app.storage.putObject(key, Buffer.from('fixture'), 'image/png');
      objectKeys.add(key);
    }
    const [source] = await app.db
      .insert(schema.jobs)
      .values({
        status: 'COMPLETED',
        source: opts.sourceSource ?? 'tryon',
        workerId: 'worker-source',
        startedAt: new Date(createdAt.getTime() - 10_000),
        completedAt: createdAt,
        comfyDurationMs: 8_500,
        errorCode: null,
        createdAt: opts.createdAt ?? createdAt,
      })
      .returning();
    await app.db.insert(schema.jobInputs).values({
      jobId: source.id,
      params: { personKey, workflowTemplateId: sourceTemplateId },
    });
    await app.db
      .insert(schema.jobOutputs)
      .values({ jobId: source.id, resultKey: originalResultKey });

    let generalJobId: string | null = null;
    let generalResultKey: string | null = null;
    if (opts.dispatched) {
      const [replay] = await app.db
        .insert(schema.jobs)
        .values({
          source: 'comparison',
          status: opts.status === 'COMPLETED' ? 'COMPLETED' : 'GENERATING',
          workerId: 'worker-general',
          startedAt: new Date(createdAt.getTime() - 4_000),
          completedAt: opts.status === 'COMPLETED' ? createdAt : null,
          comfyDurationMs: 3_200,
          errorCode: null,
          creditsCharged: 0,
        })
        .returning();
      generalJobId = replay.id;
      if (opts.status === 'COMPLETED') {
        generalResultKey = `outputs/${replay.id}/result.png`;
        await app.storage.putObject(generalResultKey, Buffer.from('general'), 'image/png');
        objectKeys.add(generalResultKey);
        await app.db
          .insert(schema.jobOutputs)
          .values({ jobId: replay.id, resultKey: generalResultKey });
      }
    }

    const [comparison] = await app.db
      .insert(schema.workflowComparisons)
      .values({
        sourceJobId: source.id,
        generalJobId,
        templateId: generalTemplateId,
        templateVersion: 7,
        sourceTemplateId,
        sourceSource: opts.sourceSource ?? 'tryon',
        status: opts.status,
        unsupportedReason: opts.status === 'UNSUPPORTED' ? 'NO_PERSON_IMAGE' : null,
        personKey,
        garmentKey,
        createdAt: opts.createdAt ?? createdAt,
      })
      .returning();
    return {
      comparison,
      source,
      generalJobId,
      personKey,
      garmentKey,
      originalResultKey,
      generalResultKey,
    };
  }

  it('filters by status and sourceSource and paginates by (createdAt, id)', async () => {
    const a = await seedComparison({ status: 'COMPLETED', sourceSource: 'tryon', createdAt });
    const b = await seedComparison({ status: 'FAILED', sourceSource: 'shopify', createdAt });
    const d = await seedComparison({ status: 'COMPLETED', sourceSource: 'shopify', createdAt });

    const filtered = await app.inject({
      method: 'GET',
      url: '/admin/comparison?status=COMPLETED&sourceSource=shopify',
      headers,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items.map((row: { id: string }) => row.id)).toEqual([d.comparison.id]);

    const firstPage = await app.inject({
      method: 'GET',
      url: '/admin/comparison?limit=2',
      headers,
    });
    const first = firstPage.json();
    expect(first.items).toHaveLength(2);
    removedCursorStatus = first.items[1].status;
    expect(JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString('utf8'))).toEqual({
      createdAt: createdAt.toISOString(),
      id: first.items[1].id,
    });
    // Retention may remove the anchor row between page requests; the encoded
    // tuple keeps pagination stable without looking the row up again.
    await app.db
      .delete(schema.workflowComparisons)
      .where(eq(schema.workflowComparisons.id, first.items[1].id));
    const secondPage = await app.inject({
      method: 'GET',
      url: `/admin/comparison?limit=2&cursor=${first.nextCursor}`,
      headers,
    });
    const second = secondPage.json();
    const pagedIds = [...first.items, ...second.items].map((row: { id: string }) => row.id);
    expect(pagedIds).toHaveLength(3);
    expect(new Set(pagedIds)).toEqual(new Set([a.comparison.id, b.comparison.id, d.comparison.id]));
  });

  it('returns total status counts and active backlog counts independent of filters', async () => {
    await seedComparison({ status: 'COLLECTED' });
    await seedComparison({ status: 'QUEUED', dispatched: true });
    await seedComparison({ status: 'RUNNING', dispatched: true });
    await seedComparison({ status: 'COMPLETED', dispatched: true });
    await seedComparison({ status: 'UNSUPPORTED' });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/comparison?status=FAILED',
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().counts).toMatchObject({
      COLLECTED: 1,
      QUEUED: 1,
      RUNNING: 1,
      COMPLETED: removedCursorStatus === 'COMPLETED' ? 2 : 3,
      FAILED: removedCursorStatus === 'FAILED' ? 0 : 1,
      UNSUPPORTED: 1,
    });
    expect(res.json().backlog).toEqual({ collected: 1, queued: 1, running: 1 });
    expect(res.json().items).toHaveLength(removedCursorStatus === 'FAILED' ? 0 : 1);
    if (res.json().items.length) expect(res.json().items[0].status).toBe('FAILED');
  });

  it('returns template/workflow metadata and presigned input and result URLs', async () => {
    const s = await seedComparison({ status: 'COMPLETED', dispatched: true });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/comparison/${s.comparison.id}`,
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: s.comparison.id,
      status: 'COMPLETED',
      template: { id: generalTemplateId, version: 7, label: 'General Try-On' },
      source: {
        jobId: s.source.id,
        source: 'tryon',
        workflowLabel: 'Specialized Source Workflow',
        workerId: 'worker-source',
        durationMs: 8_500,
        error: null,
      },
      general: {
        jobId: s.generalJobId,
        workerId: 'worker-general',
        durationMs: 3_200,
        error: null,
      },
    });
    expect(res.json().inputs.personUrl).toContain(s.personKey);
    expect(res.json().inputs.garmentUrl).toContain(s.garmentKey);
    expect(res.json().originalResultUrl).toContain(s.originalResultKey);
    expect(res.json().generalResultUrl).toContain(s.generalResultKey);
  });

  it('returns general null for collected comparisons and 404 for unknown detail IDs', async () => {
    const s = await seedComparison({ status: 'COLLECTED' });
    const detail = await app.inject({
      method: 'GET',
      url: `/admin/comparison/${s.comparison.id}`,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().general).toBeNull();

    const missing = await app.inject({
      method: 'GET',
      url: `/admin/comparison/${randomUUID()}`,
      headers,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('requires jobs.read for list and detail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/comparison',
      headers: customerHeaders,
    });
    expect(res.statusCode).toBe(403);
  });
});
