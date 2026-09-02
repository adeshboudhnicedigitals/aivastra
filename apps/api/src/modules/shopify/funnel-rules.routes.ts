import { schema } from '@aivastra/db';
import { and, asc, count, eq, isNull, ne, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { type BasketMatchTarget, loadRuleSet, resolveBasketFrom } from './funnel-resolution.js';

// Above this many products the Routing page reports countsOmitted rather than
// scanning the catalog — a large store must not turn its own settings page
// into a slow query.
const COUNTS_PRODUCT_CAP = 10_000;

const Condition = z.object({
  field: z.enum(['product_type', 'tags', 'vendor', 'collections']),
  operator: z.enum(['equals', 'contains']),
  value: z.string().min(1).max(200),
});

// min(1): an empty condition list matches nothing at read time anyway, but
// rejecting it on write stops a merchant saving a rule that silently does
// nothing and then wondering why routing ignores it.
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

const DisabledBody = z.object({ disabled: z.boolean() });
const MAX_RULES_PER_STORE = 50;

/** Loads a rule and asserts it belongs to `storeId`. 404 otherwise — a
 *  merchant must not learn that a global or another store's rule exists. */
async function requireOwnRule(app: FastifyInstance, storeId: string, ruleId: string) {
  const [rule] = await app.db
    .select()
    .from(schema.shopifyFunnelRules)
    .where(
      and(eq(schema.shopifyFunnelRules.id, ruleId), eq(schema.shopifyFunnelRules.storeId, storeId)),
    )
    .limit(1);
  if (!rule) throw new AppError('NOT_FOUND', 404, 'rule not found');
  return rule;
}

export async function shopifyFunnelRulesRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.requireShopifySession };

  // Deliberately omits workflowTemplateId: merchants have no need for workflow
  // identity, and once it is in a payload it is in a support screenshot.
  app.get('/v1/shopify/baskets', auth, async () => {
    const items = await app.db
      .select({
        id: schema.shopifyFunnelTemplates.id,
        slug: schema.shopifyFunnelTemplates.slug,
        label: schema.shopifyFunnelTemplates.label,
        sortOrder: schema.shopifyFunnelTemplates.sortOrder,
      })
      .from(schema.shopifyFunnelTemplates)
      .where(eq(schema.shopifyFunnelTemplates.isActive, true))
      .orderBy(asc(schema.shopifyFunnelTemplates.sortOrder));
    return { items };
  });

  app.get('/v1/shopify/funnel-rules', auth, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;

    const [rows, suppressed, [{ total }]] = await Promise.all([
      app.db
        .select()
        .from(schema.shopifyFunnelRules)
        // The store's own rules plus the whole global tier. Suppression is not
        // filtered here — the merchant UI must still SHOW a disabled global
        // rule, with its switch off, or there is no way to turn it back on.
        .where(
          or(
            eq(schema.shopifyFunnelRules.storeId, store.id),
            isNull(schema.shopifyFunnelRules.storeId),
          ),
        ),
      app.db
        .select({ ruleId: schema.shopifyStoreDisabledFunnelRules.ruleId })
        .from(schema.shopifyStoreDisabledFunnelRules)
        .where(eq(schema.shopifyStoreDisabledFunnelRules.storeId, store.id)),
      app.db
        .select({ total: count() })
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            ne(schema.shopifyProductGarments.status, 'deleted'),
          ),
        ),
    ]);

    const suppressedIds = new Set(suppressed.map((s) => s.ruleId));
    const mine = rows.filter((r) => r.storeId === store.id);
    const globals = rows.filter((r) => r.storeId === null);

    const counts: Record<string, number> = {};
    const countsOmitted = total > COUNTS_PRODUCT_CAP;
    if (!countsOmitted) {
      const ruleSet = await loadRuleSet(app, store.id);
      const products = await app.db
        .select({
          funnelTemplateId: schema.shopifyProductGarments.funnelTemplateId,
          productType: schema.shopifyProductGarments.productType,
          tags: schema.shopifyProductGarments.tags,
          vendor: schema.shopifyProductGarments.vendor,
          collections: schema.shopifyProductGarments.collections,
        })
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            ne(schema.shopifyProductGarments.status, 'deleted'),
          ),
        );
      for (const p of products) {
        const resolved = resolveBasketFrom(ruleSet, p as BasketMatchTarget);
        if (resolved) counts[resolved.basketId] = (counts[resolved.basketId] ?? 0) + 1;
      }
    }

    return {
      storeRules: mine.map((r) => ({
        id: r.id,
        funnelTemplateId: r.funnelTemplateId,
        conditions: r.conditions,
        priority: r.priority,
      })),
      globalRules: globals.map((r) => ({
        id: r.id,
        funnelTemplateId: r.funnelTemplateId,
        conditions: r.conditions,
        priority: r.priority,
        disabled: suppressedIds.has(r.id),
      })),
      counts,
      countsOmitted,
    };
  });

  app.post(
    '/v1/shopify/funnel-rules',
    { ...auth, schema: { body: CreateRuleBody } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const body = req.body as z.infer<typeof CreateRuleBody>;

      const [{ total }] = await app.db
        .select({ total: count() })
        .from(schema.shopifyFunnelRules)
        .where(eq(schema.shopifyFunnelRules.storeId, store.id));
      if (total >= MAX_RULES_PER_STORE) {
        throw new AppError(
          'LIMIT_REACHED',
          400,
          `a store may have at most ${MAX_RULES_PER_STORE} rules`,
        );
      }

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

      const [existing] = await app.db
        .select({ id: schema.shopifyFunnelRules.id })
        .from(schema.shopifyFunnelRules)
        .where(
          and(
            eq(schema.shopifyFunnelRules.storeId, store.id),
            eq(schema.shopifyFunnelRules.funnelTemplateId, body.funnelTemplateId),
          ),
        )
        .limit(1);
      if (existing) {
        throw new AppError(
          'CONFLICT',
          409,
          'you already have a rule for this basket — edit it instead',
        );
      }

      const [created] = await app.db
        .insert(schema.shopifyFunnelRules)
        .values({ storeId: store.id, ...body })
        .returning();
      return created;
    },
  );

  app.patch(
    '/v1/shopify/funnel-rules/:id',
    { ...auth, schema: { body: PatchRuleBody } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { id } = req.params as { id: string };
      await requireOwnRule(app, store.id, id);
      const [updated] = await app.db
        .update(schema.shopifyFunnelRules)
        .set({ ...(req.body as z.infer<typeof PatchRuleBody>), updatedAt: new Date() })
        .where(eq(schema.shopifyFunnelRules.id, id))
        .returning();
      return updated;
    },
  );

  app.delete('/v1/shopify/funnel-rules/:id', auth, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    const { id } = req.params as { id: string };
    await requireOwnRule(app, store.id, id);
    await app.db.delete(schema.shopifyFunnelRules).where(eq(schema.shopifyFunnelRules.id, id));
    return { ok: true };
  });

  app.put(
    '/v1/shopify/funnel-rules/:id/disabled',
    { ...auth, schema: { body: DisabledBody } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { id } = req.params as { id: string };
      const { disabled } = req.body as z.infer<typeof DisabledBody>;

      const [rule] = await app.db
        .select({ id: schema.shopifyFunnelRules.id })
        .from(schema.shopifyFunnelRules)
        .where(and(eq(schema.shopifyFunnelRules.id, id), isNull(schema.shopifyFunnelRules.storeId)))
        .limit(1);
      // Suppression exists only for the global tier: disabling your own rule
      // is deleting it, and silently accepting this would leave a merchant
      // believing a rule they still see listed is off.
      if (!rule)
        throw new AppError('BAD_REQUEST', 400, 'only AiVastra default rules can be disabled');

      if (disabled) {
        await app.db
          .insert(schema.shopifyStoreDisabledFunnelRules)
          .values({ storeId: store.id, ruleId: id })
          .onConflictDoNothing();
      } else {
        await app.db
          .delete(schema.shopifyStoreDisabledFunnelRules)
          .where(
            and(
              eq(schema.shopifyStoreDisabledFunnelRules.storeId, store.id),
              eq(schema.shopifyStoreDisabledFunnelRules.ruleId, id),
            ),
          );
      }
      return { disabled };
    },
  );
}
