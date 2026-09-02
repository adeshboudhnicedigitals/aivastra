import { createDb, schema } from '@aivastra/db';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startContainers } from '../helpers/containers.js';

// Talks to createDb directly rather than through the full Fastify app, since
// what's under test is the schema/constraints themselves, not any route built
// on top of them — same rationale as db-advisory-lock.test.ts.
describe('shopify funnel rule schema', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let dbHandle: ReturnType<typeof createDb>;
  let workflowId: string;
  let basketId: string;

  beforeAll(async () => {
    ctx = await startContainers();
    dbHandle = createDb(ctx.pgUrl);
    const [wf] = await dbHandle.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `funnel-schema-${Date.now()}`,
        label: 'Funnel schema test workflow',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
        workflowType: 'tryon',
        tryonPersonNodeId: '10',
        tryonGarmentNodeId: '11',
        tryonOutputNodeId: '12',
      })
      .returning();
    workflowId = wf.id;
    const [basket] = await dbHandle.db
      .insert(schema.shopifyFunnelTemplates)
      .values({
        slug: `funnel-schema-basket-${Date.now()}`,
        label: 'Upper',
        workflowTemplateId: workflowId,
      })
      .returning();
    basketId = basket.id;
  });

  afterAll(async () => {
    await dbHandle?.close();
    await ctx?.stop();
  });

  it('accepts a global rule with a null storeId', async () => {
    const [rule] = await dbHandle.db
      .insert(schema.shopifyFunnelRules)
      .values({
        storeId: null,
        funnelTemplateId: basketId,
        conditions: [{ field: 'tags', operator: 'contains', value: 'shirt' }],
        priority: 10,
      })
      .returning();
    expect(rule.storeId).toBeNull();
  });

  it('rejects a second global rule for the same basket', async () => {
    await expect(
      dbHandle.db.insert(schema.shopifyFunnelRules).values({
        storeId: null,
        funnelTemplateId: basketId,
        conditions: [{ field: 'vendor', operator: 'equals', value: 'acme' }],
        priority: 20,
      }),
    ).rejects.toThrow();
  });

  it('finds global rules by null storeId', async () => {
    const rows = await dbHandle.db
      .select()
      .from(schema.shopifyFunnelRules)
      .where(
        and(
          isNull(schema.shopifyFunnelRules.storeId),
          eq(schema.shopifyFunnelRules.funnelTemplateId, basketId),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
