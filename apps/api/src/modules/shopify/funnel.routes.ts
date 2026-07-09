import { schema } from '@aivastra/db';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const ConditionSchema = z.object({
  field: z.enum(['product_type', 'tags', 'vendor']),
  operator: z.enum(['equals', 'contains']),
  value: z.string().min(1),
});

const PutRuleBody = z.object({
  mode: z.enum(['manual', 'automated']),
  conditions: z.array(ConditionSchema).default([]),
  priority: z.number().int().default(0),
});

const uuidParam = z.object({ id: z.string().uuid() });

export async function shopifyFunnelRoutes(app: FastifyInstance) {
  app.get(
    '/v1/shopify/funnel-templates',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;

      const templates = await app.db
        .select()
        .from(schema.shopifyFunnelTemplates)
        .where(eq(schema.shopifyFunnelTemplates.isActive, true))
        .orderBy(asc(schema.shopifyFunnelTemplates.sortOrder));

      const rules = await app.db
        .select()
        .from(schema.shopifyFunnelRules)
        .where(eq(schema.shopifyFunnelRules.storeId, store.id));
      const rulesByTemplate = new Map(rules.map((r) => [r.funnelTemplateId, r]));

      return {
        items: templates.map((t) => {
          const rule = rulesByTemplate.get(t.id);
          return {
            id: t.id,
            slug: t.slug,
            label: t.label,
            rule: rule
              ? { mode: rule.mode, conditions: rule.conditions, priority: rule.priority }
              : {
                  mode: 'manual' as const,
                  conditions: [] as schema.FunnelRuleCondition[],
                  priority: 0,
                },
          };
        }),
      };
    },
  );

  app.patch(
    '/v1/shopify/funnel-templates/:id/rule',
    { preHandler: app.requireShopifySession, schema: { params: uuidParam, body: PutRuleBody } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { id: funnelTemplateId } = req.params as { id: string };
      const { mode, conditions, priority } = req.body as z.infer<typeof PutRuleBody>;

      await app.db
        .insert(schema.shopifyFunnelRules)
        .values({ storeId: store.id, funnelTemplateId, mode, conditions, priority })
        .onConflictDoUpdate({
          target: [schema.shopifyFunnelRules.storeId, schema.shopifyFunnelRules.funnelTemplateId],
          set: { mode, conditions, priority, updatedAt: new Date() },
        });

      return { ok: true };
    },
  );
}
