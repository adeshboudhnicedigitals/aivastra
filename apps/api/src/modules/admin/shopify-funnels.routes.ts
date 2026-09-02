import { type DB, schema } from '@aivastra/db';
import { asc, count, countDistinct, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requirePermission } from './guard.js';

type FunnelTemplatesTx = Parameters<Parameters<DB['transaction']>[0]>[0];

// Demote first: the partial unique index rejects a second default, so
// insert-then-demote (or update-then-demote) would fail on the constraint
// rather than swap. Callers must run this before the insert/update that sets
// the new default, within the same transaction.
async function demoteCurrentDefault(tx: FunnelTemplatesTx) {
  await tx
    .update(schema.shopifyFunnelTemplates)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(schema.shopifyFunnelTemplates.isDefault, true));
}

const CreateFunnelTemplateBody = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, hyphens only'),
  label: z.string().min(1).max(120),
  workflowTemplateId: z.string().uuid(),
  sortOrder: z.number().int().default(0),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const PatchFunnelTemplateBody = CreateFunnelTemplateBody.partial();

const ReassignFunnelTemplateBody = z.object({
  targetId: z.string().uuid(),
});

interface DeleteImpact {
  productsInUse: number;
  rulesAffected: number;
  storesAffected: number;
  hasGlobalRule: boolean;
}

// Shared by the DELETE route and the .../delete-impact preview route so a
// confirm modal can show the same numbers the delete itself will report —
// per this repo's rule to state what will be lost before a cascade.
//
// shopify_funnel_rules cascades on funnel_template_id (schema/shopify.ts:280),
// so deleting a basket silently deletes every store's rules for it. That's
// what this function exists to protect against: state what will be lost
// before the cascade, not after.
async function computeDeleteImpact(app: FastifyInstance, id: string): Promise<DeleteImpact> {
  const [{ value: productsInUse }] = await app.db
    .select({ value: count() })
    .from(schema.shopifyProductGarments)
    .where(eq(schema.shopifyProductGarments.funnelTemplateId, id));

  const [ruleImpact] = await app.db
    .select({
      rules: count(),
      // countDistinct(storeId) skips NULL by Postgres COUNT(DISTINCT ...)
      // semantics, so it's correct for store-scoped rules but silent about a
      // global rule (storeId IS NULL) — surfaced separately as hasGlobalRule.
      stores: countDistinct(schema.shopifyFunnelRules.storeId),
      hasGlobalRule: sql<boolean>`coalesce(bool_or(${schema.shopifyFunnelRules.storeId} is null), false)`,
    })
    .from(schema.shopifyFunnelRules)
    .where(eq(schema.shopifyFunnelRules.funnelTemplateId, id));

  return {
    productsInUse,
    rulesAffected: ruleImpact.rules,
    storesAffected: ruleImpact.stores,
    hasGlobalRule: ruleImpact.hasGlobalRule,
  };
}

export async function adminShopifyFunnelsRoutes(app: FastifyInstance) {
  const RW = requirePermission('shopify_funnels.write');
  const uuidParam = z.object({ id: z.string().uuid() });

  app.get('/admin/shopify/funnel-templates', { preHandler: RW }, async () => {
    const items = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .orderBy(asc(schema.shopifyFunnelTemplates.sortOrder));
    // Surfaced so the admin list can warn on it. With no default, every Shopify
    // try-on is refused at creation and nothing else reveals why until a shopper
    // hits it. Checked against both flags, not just isDefault, so a default row
    // that's been deactivated (which resolveWorkflowTemplateId treats as "no
    // usable default") still trips the banner — see the PATCH guard below,
    // which should prevent that state from occurring in the first place.
    return { items, hasDefault: items.some((i) => i.isDefault && i.isActive) };
  });

  app.post(
    '/admin/shopify/funnel-templates',
    { preHandler: RW, schema: { body: CreateFunnelTemplateBody } },
    async (req) => {
      const body = req.body as z.infer<typeof CreateFunnelTemplateBody>;
      try {
        return await app.db.transaction(async (tx) => {
          if (body.isDefault) {
            await demoteCurrentDefault(tx);
          }
          const [row] = await tx.insert(schema.shopifyFunnelTemplates).values(body).returning();
          return row;
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError('CONFLICT', 409, `slug "${body.slug}" already exists`);
        }
        throw err;
      }
    },
  );

  app.patch(
    '/admin/shopify/funnel-templates/:id',
    { preHandler: RW, schema: { params: uuidParam, body: PatchFunnelTemplateBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof PatchFunnelTemplateBody>;

      // Deactivating the default is just as dangerous as un-defaulting it:
      // resolveWorkflowTemplateId (apps/api/src/modules/shopify/customer.routes.ts)
      // only resolves a template when isDefault AND isActive are both true, so
      // `PATCH { isActive: false }` on the default row silently breaks every
      // Shopify try-on even though `isDefault` never changed. Guard both.
      if (body.isDefault === false || body.isActive === false) {
        const [row] = await app.db
          .select({ isDefault: schema.shopifyFunnelTemplates.isDefault })
          .from(schema.shopifyFunnelTemplates)
          .where(eq(schema.shopifyFunnelTemplates.id, id))
          .limit(1);
        if (!row) throw new AppError('NOT_FOUND', 404, 'funnel template not found');
        if (row.isDefault) {
          if (body.isDefault === false) {
            throw new AppError(
              'VALIDATION',
              400,
              'Cannot clear the default funnel template. Promote another template instead — with no default, every Shopify try-on is refused.',
            );
          }
          if (body.isActive === false) {
            throw new AppError(
              'VALIDATION',
              400,
              'Cannot deactivate the default funnel template. Promote another template as default first — with no active default, every Shopify try-on is refused.',
            );
          }
        }
      }

      const updated = await app.db.transaction(async (tx) => {
        if (body.isDefault === true) {
          await demoteCurrentDefault(tx);
        }
        const [row] = await tx
          .update(schema.shopifyFunnelTemplates)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.shopifyFunnelTemplates.id, id))
          .returning({ id: schema.shopifyFunnelTemplates.id });
        return row;
      });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'funnel template not found');
      return { ok: true };
    },
  );

  app.post(
    '/admin/shopify/funnel-templates/:id/reassign',
    { preHandler: RW, schema: { params: uuidParam, body: ReassignFunnelTemplateBody } },
    async (req) => {
      const { id } = req.params as { id: string };
      const { targetId } = req.body as z.infer<typeof ReassignFunnelTemplateBody>;
      if (targetId === id) {
        throw new AppError('VALIDATION', 400, 'target must be a different funnel template');
      }

      const [target] = await app.db
        .select({ id: schema.shopifyFunnelTemplates.id })
        .from(schema.shopifyFunnelTemplates)
        .where(eq(schema.shopifyFunnelTemplates.id, targetId))
        .limit(1);
      if (!target) throw new AppError('NOT_FOUND', 404, 'target funnel template not found');

      // Marked 'manual' since this is an explicit admin-driven move, not the
      // rule-matching engine's own resolution — re-run should leave these alone.
      const reassigned = await app.db
        .update(schema.shopifyProductGarments)
        .set({ funnelTemplateId: targetId, funnelAssignmentSource: 'manual' })
        .where(eq(schema.shopifyProductGarments.funnelTemplateId, id))
        .returning({ id: schema.shopifyProductGarments.id });

      return { ok: true, reassigned: reassigned.length };
    },
  );

  // Preview-only: runs the same impact query the DELETE route uses, without
  // deleting anything, so a confirm modal can show real numbers before the
  // admin commits to an irreversible delete.
  app.get(
    '/admin/shopify/funnel-templates/:id/delete-impact',
    { preHandler: RW, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      return computeDeleteImpact(app, id);
    },
  );

  app.delete(
    '/admin/shopify/funnel-templates/:id',
    { preHandler: RW, schema: { params: uuidParam } },
    async (req) => {
      const { id } = req.params as { id: string };
      const impact = await computeDeleteImpact(app, id);

      // shopifyProductGarments.funnelTemplateId has no onDelete cascade (unlike
      // shopifyFunnelRules, which cascades per-merchant rule configs) — a bare
      // delete would either 500 on the FK violation or, if it somehow succeeded,
      // silently orphan whichever merchants' products were assigned to this
      // global, admin-owned template. Block with a clear message instead.
      if (impact.productsInUse > 0) {
        throw new AppError(
          'CONFLICT',
          409,
          `Cannot delete: ${impact.productsInUse} product(s) across merchant stores are still assigned to this funnel template. Reassign or deactivate it instead.`,
        );
      }

      const [deleted] = await app.db
        .delete(schema.shopifyFunnelTemplates)
        .where(eq(schema.shopifyFunnelTemplates.id, id))
        .returning({ id: schema.shopifyFunnelTemplates.id });
      if (!deleted) throw new AppError('NOT_FOUND', 404, 'funnel template not found');
      return {
        ok: true,
        rulesAffected: impact.rulesAffected,
        storesAffected: impact.storesAffected,
        hasGlobalRule: impact.hasGlobalRule,
      };
    },
  );
}
