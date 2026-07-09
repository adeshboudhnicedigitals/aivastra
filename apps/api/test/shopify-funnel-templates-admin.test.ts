import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from './helpers/admin.js';
import { buildTestApp, type TestApp } from './helpers/api.js';
import { type Containers, startContainers } from './helpers/containers.js';

let c: Containers;
let app: TestApp;
let adminHeaders: Record<string, string>;
let workflowTemplateId: string;

beforeAll(async () => {
  c = await startContainers();
  app = await buildTestApp(c);
  adminHeaders = await adminAuthHeader(app, 'SUPER_ADMIN');
  const [wf] = await app.db
    .insert(schema.workflowTemplates)
    .values({
      slug: 'admin-funnel-test',
      label: 'Test WF',
      jsonContent: {},
      faceNodeId: 'x',
      poseNodeId: 'x',
      bgNodeId: 'x',
      upperNodeIds: [],
      facePhasePromptNode: 'x',
      garmentPhasePromptNode: 'x',
      workflowType: 'tryon',
    })
    .returning();
  workflowTemplateId = wf.id;
});
afterAll(async () => {
  await app?.close();
  await c?.stop();
});

describe('admin shopify funnel templates CRUD', () => {
  it('creates, lists, and patches a funnel template', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-templates',
      headers: adminHeaders,
      payload: {
        slug: 'upper-garment',
        label: 'Upper Garment',
        workflowTemplateId,
        sortOrder: 1,
      },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json();
    expect(created.label).toBe('Upper Garment');
    expect(created.isActive).toBe(true);

    const listRes = await app.inject({
      method: 'GET',
      url: '/admin/shopify/funnel-templates',
      headers: adminHeaders,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items.some((i: { id: string }) => i.id === created.id)).toBe(true);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/shopify/funnel-templates/${created.id}`,
      headers: adminHeaders,
      payload: { label: 'Upper Garment (renamed)', isActive: false },
    });
    expect(patchRes.statusCode).toBe(200);

    const [row] = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.id, created.id));
    expect(row.label).toBe('Upper Garment (renamed)');
    expect(row.isActive).toBe(false);
  });

  it('rejects a duplicate slug', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-templates',
      headers: adminHeaders,
      payload: { slug: 'dup-slug', label: 'First', workflowTemplateId, sortOrder: 0 },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-templates',
      headers: adminHeaders,
      payload: { slug: 'dup-slug', label: 'Second', workflowTemplateId, sortOrder: 0 },
    });
    expect(res.statusCode).toBe(500);
  });
});
