import { randomUUID } from 'node:crypto';
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

describe('admin shopify funnel template reassign-on-delete', () => {
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

  it("reassigns pinned products to 'admin_reassign', not 'manual', when their basket is deleted", async () => {
    const sourceBasketId = await createBasket('reassign-source');
    const targetBasketId = await createBasket('reassign-target');

    const [store] = await app.db
      .insert(schema.shopifyStores)
      .values({
        shopDomain: `reassign-${Date.now()}.myshopify.com`,
        shopifyShopId: Date.now(),
        accessToken: 'enc',
        scope: 'read_products',
      })
      .returning();

    const productId = Date.now();
    await app.db.insert(schema.shopifyProductGarments).values({
      storeId: store.id,
      shopifyProductId: productId,
      r2Key: `shopify-garments/${store.id}/${productId}/garment.jpg`,
      title: 'Reassign Product',
      status: 'active',
      enabled: true,
      // The merchant pinned this themselves — 'manual' is the value the
      // reassign route must overwrite, since the row is about to be moved by
      // an admin action, not the merchant.
      funnelTemplateId: sourceBasketId,
      funnelAssignmentSource: 'manual',
    });

    // The admin flow: reassign every product pinned to the basket being
    // removed onto a target basket, then delete the now-empty source.
    const reassignRes = await app.inject({
      method: 'POST',
      url: `/admin/shopify/funnel-templates/${sourceBasketId}/reassign`,
      headers: adminHeaders,
      payload: { targetId: targetBasketId },
    });
    expect(reassignRes.statusCode).toBe(200);
    expect(reassignRes.json()).toMatchObject({ ok: true, reassigned: 1 });

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/admin/shopify/funnel-templates/${sourceBasketId}`,
      headers: adminHeaders,
    });
    expect(deleteRes.statusCode).toBe(200);

    const [row] = await app.db
      .select()
      .from(schema.shopifyProductGarments)
      .where(eq(schema.shopifyProductGarments.shopifyProductId, productId));
    expect(row.funnelTemplateId).toBe(targetBasketId);
    expect(row.funnelAssignmentSource).toBe('admin_reassign');
  });
});

describe('admin shopify funnel template image + description', () => {
  async function createBasket(slug: string, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-templates',
      headers: adminHeaders,
      payload: { slug, label: slug, workflowTemplateId, ...extra },
    });
    return res;
  }

  async function uploadedKey(): Promise<string> {
    const presign = await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-templates/image/presign',
      headers: adminHeaders,
    });
    expect(presign.statusCode).toBe(200);
    const { imageKey } = presign.json() as { imageKey: string };
    // Stand-in for the browser's direct PUT to the presigned URL.
    await app.storage.putObject(imageKey, Buffer.from('jpeg'), 'image/jpeg');
    return imageKey;
  }

  async function exists(key: string): Promise<boolean> {
    try {
      await app.storage.headObject(key);
      return true;
    } catch {
      return false;
    }
  }

  it('stores a description and image, and lists a signed imageUrl', async () => {
    const imageKey = await uploadedKey();
    const res = await createBasket('img-basket', { description: '  Tops and shirts  ', imageKey });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ description: 'Tops and shirts', imageKey });

    const list = await app.inject({
      method: 'GET',
      url: '/admin/shopify/funnel-templates',
      headers: adminHeaders,
    });
    const item = list.json().items.find((i: { id: string }) => i.id === res.json().id);
    expect(String(item.imageUrl)).toContain(imageKey);
  });

  it('stores a blank description as null', async () => {
    const res = await createBasket('blank-desc', { description: '   ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().description).toBeNull();
  });

  it('rejects a key the presign route did not mint', async () => {
    const res = await createBasket('bad-key', { imageKey: 'models/faces/someone-else.jpg' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a well-formed key whose upload never happened', async () => {
    const res = await createBasket('no-upload', {
      imageKey: `shopify/baskets/${randomUUID()}.jpg`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.message ?? res.json().message).toContain('not uploaded');
  });

  it('deletes the old file when the image is replaced or cleared', async () => {
    const first = await uploadedKey();
    const created = await createBasket('replace-img', { imageKey: first });
    const id = created.json().id as string;

    const second = await uploadedKey();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/admin/shopify/funnel-templates/${id}`,
      headers: adminHeaders,
      payload: { imageKey: second },
    });
    expect(patch.statusCode).toBe(200);
    expect(await exists(first)).toBe(false);
    expect(await exists(second)).toBe(true);

    const clear = await app.inject({
      method: 'PATCH',
      url: `/admin/shopify/funnel-templates/${id}`,
      headers: adminHeaders,
      payload: { imageKey: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(await exists(second)).toBe(false);
    const [row] = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.id, id));
    expect(row.imageKey).toBeNull();
  });

  it('keeps the image when a patch does not mention it', async () => {
    const key = await uploadedKey();
    const created = await createBasket('keep-img', { imageKey: key });
    const id = created.json().id as string;
    await app.inject({
      method: 'PATCH',
      url: `/admin/shopify/funnel-templates/${id}`,
      headers: adminHeaders,
      payload: { label: 'renamed' },
    });
    expect(await exists(key)).toBe(true);
  });

  it('deletes the image file along with the basket', async () => {
    const key = await uploadedKey();
    const created = await createBasket('delete-img', { imageKey: key });
    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/shopify/funnel-templates/${created.json().id}`,
      headers: adminHeaders,
    });
    expect(del.statusCode).toBe(200);
    expect(await exists(key)).toBe(false);
  });
});
