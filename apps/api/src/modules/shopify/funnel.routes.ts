import { schema } from '@aivastra/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveFunnelTemplateId } from './funnel-rules.js';

const ConditionSchema = z.object({
  field: z.enum(['product_type', 'tags', 'vendor', 'collections']),
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

  app.patch(
    '/v1/shopify/products/:id/funnel',
    {
      preHandler: app.requireShopifySession,
      schema: {
        body: z.object({ funnelTemplateId: z.string().uuid().nullable() }),
      },
    },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { id } = req.params as { id: string };
      const shopifyProductId = Number(id);
      const { funnelTemplateId } = req.body as { funnelTemplateId: string | null };

      const [existing] = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            eq(schema.shopifyProductGarments.shopifyProductId, shopifyProductId),
          ),
        )
        .limit(1);
      if (!existing) return { ok: false, reason: 'product not synced yet' };

      if (funnelTemplateId === null) {
        const resolved = await resolveFunnelTemplateId(app, store.id, {
          productType: existing.productType,
          tags: existing.tags,
          vendor: existing.vendor,
          collections: existing.collections,
        });
        await app.db
          .update(schema.shopifyProductGarments)
          .set({
            funnelTemplateId: resolved,
            funnelAssignmentSource: resolved ? 'automated' : null,
          })
          .where(eq(schema.shopifyProductGarments.id, existing.id));
        return { ok: true };
      }

      await app.db
        .update(schema.shopifyProductGarments)
        .set({ funnelTemplateId, funnelAssignmentSource: 'manual' })
        .where(eq(schema.shopifyProductGarments.id, existing.id));
      return { ok: true };
    },
  );

  app.post(
    '/v1/shopify/funnel-templates/re-run',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;

      const products = await app.db
        .select()
        .from(schema.shopifyProductGarments)
        .where(eq(schema.shopifyProductGarments.storeId, store.id));

      // `reassigned` used to count every non-manual row this loop touched,
      // including the ones a rule failed to match and which were therefore set
      // back to NULL. "Reassigned 8" could mean "unassigned 8" — the merchant had
      // no way to tell a rule that matches everything from one that matches
      // nothing. Split into outcomes the number can't lie about.
      let matched = 0;
      let cleared = 0;
      let skippedManual = 0;
      for (const p of products) {
        if (p.funnelAssignmentSource === 'manual') {
          skippedManual += 1;
          continue;
        }
        const resolved = await resolveFunnelTemplateId(app, store.id, {
          productType: p.productType,
          tags: p.tags,
          vendor: p.vendor,
          collections: p.collections,
        });
        await app.db
          .update(schema.shopifyProductGarments)
          .set({
            funnelTemplateId: resolved,
            funnelAssignmentSource: resolved ? 'automated' : null,
          })
          .where(eq(schema.shopifyProductGarments.id, p.id));
        if (resolved) matched += 1;
        else cleared += 1;
      }

      return {
        ok: true,
        matched,
        cleared,
        skippedManual,
        evaluated: matched + cleared,
        // Retained for one deploy cycle so an older admin bundle keeps rendering
        // its toast; drop once the shopify app is known to be past this version.
        reassigned: matched + cleared,
      };
    },
  );
}
