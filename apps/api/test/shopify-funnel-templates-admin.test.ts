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
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain('dup-slug');
  });

  it('promotes a template to default and demotes the previous one atomically', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-templates',
      headers: adminHeaders,
      payload: { slug: 'default-a', label: 'A', workflowTemplateId, sortOrder: 0, isDefault: true },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().isDefault).toBe(true);

    const second = await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-templates',
      headers: adminHeaders,
      payload: { slug: 'default-b', label: 'B', workflowTemplateId, sortOrder: 1, isDefault: true },
    });
    expect(second.statusCode).toBe(200);

    const rows = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.isDefault, true));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(second.json().id);
  });

  it('refuses to clear the last default', async () => {
    const [current] = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.isDefault, true));
    expect(current).toBeDefined();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/shopify/funnel-templates/${current.id}`,
      headers: adminHeaders,
      payload: { isDefault: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('default');

    const [still] = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.id, current.id));
    expect(still.isDefault).toBe(true);
  });

  it('refuses to deactivate the current default', async () => {
    const [current] = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.isDefault, true));
    expect(current).toBeDefined();

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/shopify/funnel-templates/${current.id}`,
      headers: adminHeaders,
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('default');
    expect(res.json().error.message).toContain('active');

    const [still] = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.id, current.id));
    expect(still.isDefault).toBe(true);
    expect(still.isActive).toBe(true);
  });

  it('reports whether a default exists so admin can surface it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/shopify/funnel-templates',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hasDefault).toBe(true);
  });
});

describe('admin shopify funnel template delete-impact response', () => {
  async function createBasket(slug: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-templates',
      headers: adminHeaders,
      payload: { slug, label: slug, workflowTemplateId, sortOrder: 0 },
    });
    expect(res.statusCode).toBe(200);
    return res.json().id as string;
  }

  it('reports hasGlobalRule: true when the basket has a global rule', async () => {
    const basketId = await createBasket('delete-impact-global');
    await app.db.insert(schema.shopifyFunnelRules).values({
      storeId: null,
      funnelTemplateId: basketId,
      conditions: [{ field: 'tags', operator: 'contains', value: 'x' }],
      priority: 0,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/shopify/funnel-templates/${basketId}`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      rulesAffected: 1,
      storesAffected: 0,
      hasGlobalRule: true,
    });
  });

  it('previews the delete impact without deleting anything', async () => {
    const basketId = await createBasket('delete-impact-preview');
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `delete-impact-preview-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    await app.db.insert(schema.shopifyFunnelRules).values([
      {
        storeId: null,
        funnelTemplateId: basketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'x' }],
        priority: 0,
      },
      {
        storeId: store.id,
        funnelTemplateId: basketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'y' }],
        priority: 0,
      },
    ]);

    const preview = await app.inject({
      method: 'GET',
      url: `/admin/shopify/funnel-templates/${basketId}/delete-impact`,
      headers: adminHeaders,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      rulesAffected: 2,
      storesAffected: 1,
      hasGlobalRule: true,
    });

    // The preview must not have deleted anything.
    const [stillThere] = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.id, basketId));
    expect(stillThere).toBeDefined();

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/shopify/funnel-templates/${basketId}`,
      headers: adminHeaders,
    });
    expect(del.statusCode).toBe(200);
    // The preview's numbers must match what the actual delete reports.
    expect(del.json()).toMatchObject({
      rulesAffected: preview.json().rulesAffected,
      storesAffected: preview.json().storesAffected,
      hasGlobalRule: preview.json().hasGlobalRule,
    });
  });

  it('reports hasGlobalRule: false when the basket has only store-scoped rules', async () => {
    const basketId = await createBasket('delete-impact-store-scoped');
    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `delete-impact-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();
    await app.db.insert(schema.shopifyFunnelRules).values({
      storeId: store.id,
      funnelTemplateId: basketId,
      conditions: [{ field: 'tags', operator: 'contains', value: 'x' }],
      priority: 0,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/shopify/funnel-templates/${basketId}`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      rulesAffected: 1,
      storesAffected: 1,
      hasGlobalRule: false,
    });
  });
});
