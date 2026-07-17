import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('workflow-template thirdNodeId support', () => {
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

  it('POST /admin/workflows creates template with thirdNodeId', async () => {
    const headers = await adminAuthHeader(app);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/workflows',
      headers,
      payload: {
        label: 'Third Node Test',
        workflowType: 'regular',
        pipelineType: 'build_model_main',
        apiPayload: { dummy: true },
        nodeIdOverrides: {},
        schemaVersion: 1,
        upperNodeIds: ['10', '11'],
        lowerNodeId: '12',
        thirdNodeId: '99',
        sizeNodeIds: [],
        creditCost: 10,
        isActive: true,
      },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, res.json().id));
    expect(row?.thirdNodeId).toBe('99');
  });

  it('PATCH /admin/workflows/:id updates thirdNodeId', async () => {
    const headers = await adminAuthHeader(app);
    const [wt] = await app.db
      .insert(schema.workflowTemplates)
      .values({
        label: 'Patch Third Node',
        workflowType: 'regular',
        pipelineType: 'build_model_main',
        apiPayload: { dummy: true },
        nodeIdOverrides: {},
        schemaVersion: 1,
        upperNodeIds: ['10'],
        creditCost: 10,
      })
      .returning();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/workflows/${wt.id}`,
      headers,
      payload: { thirdNodeId: '42' },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, wt.id));
    expect(row?.thirdNodeId).toBe('42');
  });
});
