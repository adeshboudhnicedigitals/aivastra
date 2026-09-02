import { schema } from '@aivastra/db';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';

const Condition = z.object({
  field: z.enum(['product_type', 'tags', 'vendor', 'collections']),
  operator: z.enum(['equals', 'contains']),
  value: z.string().min(1).max(200),
});

// Mirrors the merchant-facing schema (modules/shopify/funnel-rules.routes.ts):
// an empty condition list matches nothing at read time anyway, but rejecting
// it on write stops an admin saving a global rule that silently does nothing
// and re-routes nobody.
const Conditions = z.array(Condition).min(1).max(20);

const CreateRuleBody = z.object({
  funnelTemplateId: z.string().uuid(),
  conditions: Conditions,
  priority: z.number().int().min(0).max(10_000).default(0),
});

const PatchRuleBody = z
  .object({
    conditions: Conditions.optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((b) => b.conditions !== undefined || b.priority !== undefined, {
    message: 'at least one of conditions or priority is required',
  });

const uuidParam = z.object({ id: z.string().uuid() });

/** Loads a global rule (storeId IS NULL) and 404s otherwise — this route
 *  manages the global tier only, never a store's own rule. */
async function requireGlobalRule(app: FastifyInstance, id: string) {
  const [rule] = await app.db
    .select()
    .from(schema.shopifyFunnelRules)
    .where(and(eq(schema.shopifyFunnelRules.id, id), isNull(schema.shopifyFunnelRules.storeId)))
    .limit(1);
  if (!rule) throw new AppError('NOT_FOUND', 404, 'rule not found');
  return rule;
}

export async function adminShopifyFunnelRulesRoutes(app: FastifyInstance) {
  const RW = requirePermission('shopify_funnels.write');

  app.get('/admin/shopify/funnel-rules', { preHandler: RW }, async () => {
    const items = await app.db
      .select({
        id: schema.shopifyFunnelRules.id,
        funnelTemplateId: schema.shopifyFunnelRules.funnelTemplateId,
        conditions: schema.shopifyFunnelRules.conditions,
        priority: schema.shopifyFunnelRules.priority,
        // A global rule half your merchants have switched off is a rule that
        // is wrong. Without this the signal is invisible from the admin side.
        disabledByStoreCount: count(schema.shopifyStoreDisabledFunnelRules.storeId),
      })
      .from(schema.shopifyFunnelRules)
      .leftJoin(
        schema.shopifyStoreDisabledFunnelRules,
        eq(schema.shopifyStoreDisabledFunnelRules.ruleId, schema.shopifyFunnelRules.id),
      )
      .where(isNull(schema.shopifyFunnelRules.storeId))
      .groupBy(schema.shopifyFunnelRules.id)
      .orderBy(asc(schema.shopifyFunnelRules.priority), asc(schema.shopifyFunnelRules.id));
    return { items };
  });

  app.post(
    '/admin/shopify/funnel-rules',
    { preHandler: RW, schema: { body: CreateRuleBody } },
    async (req) => {
      const body = req.body as z.infer<typeof CreateRuleBody>;

      // Mirrors the merchant route (modules/shopify/funnel-rules.routes.ts)
      // — without this, a bad or already-deleted funnelTemplateId hits the FK
      // constraint on insert and surfaces as an uncaught 500 instead of a
      // clean 404 for what's really a routine input mistake.
      const [basket] = await app.db
        .select({ id: schema.shopifyFunnelTemplates.id })
        .from(schema.shopifyFunnelTemplates)
        .where(
          and(
            eq(schema.shopifyFunnelTemplates.id, body.funnelTemplateId),
            eq(schema.shopifyFunnelTemplates.isActive, true),
          ),
        )
        .limit(1);
      if (!basket) throw new AppError('NOT_FOUND', 404, 'basket not found');

      try {
        return await app.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(schema.shopifyFunnelRules)
            .values({ storeId: null, ...body })
            .returning();
          // Fail-closed per the CLAUDE.md invariant: if this insert throws, the
          // rule insert rolls back with it. A global rule re-routes every store's
          // catalog, so it is exactly the kind of write the audit trail is for.
          await recordAudit(tx, {
            // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
            actor: { userId: req.userId, role: req.adminRole! },
            action: 'shopify_funnel_rule.create',
            resourceType: 'shopify_funnel_rule',
            resourceId: row.id,
            after: {
              funnelTemplateId: row.funnelTemplateId,
              conditions: row.conditions,
              priority: row.priority,
            },
            request: req,
          });
          return row;
        });
      } catch (err) {
        // shopify_funnel_rules_one_global_per_basket_idx (schema/shopify.ts) —
        // Postgres treats NULL storeId values as distinct, so the plain
        // (storeId, funnelTemplateId) unique constraint doesn't stop a second
        // global rule for the same basket; only this partial index does.
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(
            'CONFLICT',
            409,
            'a global rule already exists for this basket — edit it instead',
          );
        }
        throw err;
      }
    },
  );

  app.patch(
    '/admin/shopify/funnel-rules/:id',
    { preHandler: RW, schema: { params: uuidParam, body: PatchRuleBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PatchRuleBody>;
      const before = await requireGlobalRule(app, id);

      return await app.db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.shopifyFunnelRules)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.shopifyFunnelRules.id, id))
          .returning();
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'shopify_funnel_rule.update',
          resourceType: 'shopify_funnel_rule',
          resourceId: id,
          before: { conditions: before.conditions, priority: before.priority },
          after: { conditions: row.conditions, priority: row.priority },
          request: req,
        });
        return row;
      });
    },
  );

  app.delete(
    '/admin/shopify/funnel-rules/:id',
    { preHandler: RW, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const before = await requireGlobalRule(app, id);

      await app.db.transaction(async (tx) => {
        await tx.delete(schema.shopifyFunnelRules).where(eq(schema.shopifyFunnelRules.id, id));
        await recordAudit(tx, {
          // biome-ignore lint/style/noNonNullAssertion: set by the requirePermission preHandler (guard.ts) before any handler runs
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'shopify_funnel_rule.delete',
          resourceType: 'shopify_funnel_rule',
          resourceId: id,
          before: {
            funnelTemplateId: before.funnelTemplateId,
            conditions: before.conditions,
            priority: before.priority,
          },
          request: req,
        });
      });
      return { ok: true };
    },
  );
}
