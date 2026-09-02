import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAuthHeader } from '../helpers/admin.js';
import { buildTestApp, type TestApp } from '../helpers/api.js';
import { type Containers, startContainers } from '../helpers/containers.js';

describe('admin shopify global funnel rules routes', () => {
  let c: Containers;
  let app: TestApp;

  let adminAuth: Record<string, string>;
  let unprivilegedAuth: Record<string, string>;

  let basketId: string;
  let secondBasketId: string;
  let suppressedRuleId: string;
  let patchDeleteBasketId: string;

  beforeAll(async () => {
    c = await startContainers();
    app = await buildTestApp(c);

    // SUPER_ADMIN carries shopify_funnels.write; SUPPORT deliberately does not
    // (packages/db/src/migrations/0167_permissions.sql) — used for the 403 test.
    adminAuth = await adminAuthHeader(app, 'SUPER_ADMIN');
    unprivilegedAuth = await adminAuthHeader(app, 'SUPPORT');

    const tag = Date.now();

    async function seedWorkflow(slug: string) {
      const [wf] = await app.db
        .insert(schema.workflowTemplates)
        .values({
          slug,
          label: slug,
          jsonContent: {},
          poseNodeId: '2',
          upperNodeIds: ['4'],
          garmentPhasePromptNode: '6',
          workflowType: 'tryon',
          tryonPersonNodeId: '10',
          tryonGarmentNodeId: '11',
          tryonOutputNodeId: '12',
          version: 1,
        })
        .returning();
      return wf.id;
    }

    async function seedBasket(slug: string) {
      const workflowTemplateId = await seedWorkflow(`${slug}-wf`);
      const [basket] = await app.db
        .insert(schema.shopifyFunnelTemplates)
        .values({ slug, label: slug, workflowTemplateId })
        .returning();
      return basket.id;
    }

    basketId = await seedBasket(`admin-rules-a-${tag}`);
    secondBasketId = await seedBasket(`admin-rules-b-${tag}`);
    const suppressedBasketId = await seedBasket(`admin-rules-suppressed-${tag}`);
    patchDeleteBasketId = await seedBasket(`admin-rules-patch-delete-${tag}`);

    // Seeded directly rather than through the routes under test: a rule with
    // two stores that have each switched it off, for the disabledByStoreCount
    // assertion below.
    const [suppressedRule] = await app.db
      .insert(schema.shopifyFunnelRules)
      .values({
        storeId: null,
        funnelTemplateId: suppressedBasketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'suppressed' }],
        priority: 0,
      })
      .returning();
    suppressedRuleId = suppressedRule.id;

    async function seedStore(n: number) {
      const [store] = await app.db
        .insert(schema.shopifyStores)
        .values({
          shopDomain: `admin-rules-${tag}-${n}.myshopify.com`,
          shopifyShopId: tag + n,
          accessToken: 'enc',
          scope: 'read_products',
        })
        .returning();
      return store.id;
    }

    const storeOneId = await seedStore(1);
    const storeTwoId = await seedStore(2);

    await app.db.insert(schema.shopifyStoreDisabledFunnelRules).values([
      { storeId: storeOneId, ruleId: suppressedRuleId },
      { storeId: storeTwoId, ruleId: suppressedRuleId },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await c.stop();
  });

  it('creates a global rule with a null storeId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-rules',
      headers: adminAuth,
      payload: {
        funnelTemplateId: basketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'saree' }],
        priority: 10,
      },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await app.db
      .select()
      .from(schema.shopifyFunnelRules)
      .where(eq(schema.shopifyFunnelRules.id, res.json().id));
    expect(row.storeId).toBeNull();
  });

  it('writes an audit log row in the same transaction', async () => {
    const before = await app.db.select().from(schema.auditLogs);
    await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-rules',
      headers: adminAuth,
      payload: {
        funnelTemplateId: secondBasketId,
        conditions: [{ field: 'vendor', operator: 'equals', value: 'acme' }],
        priority: 0,
      },
    });
    const after = await app.db.select().from(schema.auditLogs);
    expect(after.length).toBe(before.length + 1);
  });

  it('rejects a second global rule for the same basket', async () => {
    const payload = {
      funnelTemplateId: basketId,
      conditions: [{ field: 'tags', operator: 'contains', value: 'x' }],
      priority: 0,
    };
    await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-rules',
      headers: adminAuth,
      payload,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-rules',
      headers: adminAuth,
      payload,
    });
    expect(res.statusCode).toBe(409);
  });

  it('reports how many stores have disabled each rule', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/shopify/funnel-rules',
      headers: adminAuth,
    });
    expect(
      res.json().items.find((r: { id: string }) => r.id === suppressedRuleId).disabledByStoreCount,
    ).toBe(2);
  });

  it('requires the shopify_funnels.write permission', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/shopify/funnel-rules',
      headers: unprivilegedAuth,
    });
    expect(res.statusCode).toBe(403);
  });

  it('updates a rule and writes an audit log row in the same transaction', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/shopify/funnel-rules',
      headers: adminAuth,
      payload: {
        funnelTemplateId: patchDeleteBasketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'before' }],
        priority: 5,
      },
    });
    expect(createRes.statusCode).toBe(200);
    const ruleId = createRes.json().id;

    const before = await app.db.select().from(schema.auditLogs);
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/shopify/funnel-rules/${ruleId}`,
      headers: adminAuth,
      payload: { priority: 99 },
    });
    expect(patchRes.statusCode).toBe(200);
    const after = await app.db.select().from(schema.auditLogs);
    expect(after.length).toBe(before.length + 1);

    const [row] = await app.db
      .select()
      .from(schema.shopifyFunnelRules)
      .where(eq(schema.shopifyFunnelRules.id, ruleId));
    expect(row.priority).toBe(99);

    const deleteBefore = await app.db.select().from(schema.auditLogs);
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/admin/shopify/funnel-rules/${ruleId}`,
      headers: adminAuth,
    });
    expect(deleteRes.statusCode).toBe(200);
    const deleteAfter = await app.db.select().from(schema.auditLogs);
    expect(deleteAfter.length).toBe(deleteBefore.length + 1);

    const [gone] = await app.db
      .select()
      .from(schema.shopifyFunnelRules)
      .where(eq(schema.shopifyFunnelRules.id, ruleId));
    expect(gone).toBeUndefined();
  });

  it('404s patching or deleting a rule that does not exist', async () => {
    const missingId = '00000000-0000-0000-0000-000000000000';
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/shopify/funnel-rules/${missingId}`,
      headers: adminAuth,
      payload: { priority: 1 },
    });
    expect(patchRes.statusCode).toBe(404);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/admin/shopify/funnel-rules/${missingId}`,
      headers: adminAuth,
    });
    expect(deleteRes.statusCode).toBe(404);
  });
});
