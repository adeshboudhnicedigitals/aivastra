import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import { asc, count, countDistinct, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requirePermission } from './guard.js';

// The key must be one the presign route minted. Without this, an admin (or a
// bug) could point a basket at any object in the bucket, and replacing or
// clearing the image later would delete that object.
const BASKET_IMAGE_KEY = /^shopify\/baskets\/[0-9a-f-]{36}\.jpg$/;

const CreateFunnelTemplateBody = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, hyphens only'),
  label: z.string().min(1).max(120),
  // A blank description is stored as null so "no description" has one shape.
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  imageKey: z.string().regex(BASKET_IMAGE_KEY).nullable().optional(),
  workflowTemplateId: z.string().uuid(),
  sortOrder: z.number().int().default(0),
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

  // Refuse a key whose upload never happened, so a basket can't end up pointing
  // at an image that 404s in the merchant's admin.
  async function assertImageUploaded(imageKey: string | null | undefined) {
    if (!imageKey) return;
    try {
      await app.storage.headObject(imageKey);
    } catch {
      throw new AppError('VALIDATION', 400, 'basket image was not uploaded');
    }
  }

  app.get('/admin/shopify/funnel-templates', { preHandler: RW }, async () => {
    const rows = await app.db
      .select()
      .from(schema.shopifyFunnelTemplates)
      .orderBy(asc(schema.shopifyFunnelTemplates.sortOrder));
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        imageUrl: r.imageKey ? (await app.storage.presignGet(r.imageKey, 3600)).url : null,
      })),
    );
    return { items };
  });

  // Mints a fresh key per upload rather than reusing the basket's id, so a
  // replaced image is never served from a cached copy of the old one.
  app.post('/admin/shopify/funnel-templates/image/presign', { preHandler: RW }, async () => {
    const imageKey = keys.shopifyBasketImage(randomUUID());
    const { url } = await app.storage.presignPut(imageKey, 'image/jpeg', 5_000_000, 300);
    return { uploadUrl: url, imageKey };
  });

  app.post(
    '/admin/shopify/funnel-templates',
    { preHandler: RW, schema: { body: CreateFunnelTemplateBody } },
    async (req) => {
      const body = req.body as z.infer<typeof CreateFunnelTemplateBody>;
      await assertImageUploaded(body.imageKey);
      try {
        const [row] = await app.db.insert(schema.shopifyFunnelTemplates).values(body).returning();
        return row;
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

      let previousImageKey: string | null = null;
      if (body.imageKey !== undefined) {
        await assertImageUploaded(body.imageKey);
        const [current] = await app.db
          .select({ imageKey: schema.shopifyFunnelTemplates.imageKey })
          .from(schema.shopifyFunnelTemplates)
          .where(eq(schema.shopifyFunnelTemplates.id, id));
        previousImageKey = current?.imageKey ?? null;
      }

      const [updated] = await app.db
        .update(schema.shopifyFunnelTemplates)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(schema.shopifyFunnelTemplates.id, id))
        .returning({ id: schema.shopifyFunnelTemplates.id });
      if (!updated) throw new AppError('NOT_FOUND', 404, 'funnel template not found');
      // Only after the row points at the new image, so a failed update never
      // leaves a basket referencing a file that is already gone.
      if (previousImageKey && previousImageKey !== body.imageKey) {
        await app.storage.deleteObject(previousImageKey).catch(() => {});
      }
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

      // 'admin_reassign' — an explicit admin-driven move, distinct from a merchant's
      // own manual pin (both are equally sticky: resolveBasketFrom only checks
      // whether funnelTemplateId is non-null, never this column, so re-run leaves
      // these alone regardless of which value is stored here).
      const reassigned = await app.db
        .update(schema.shopifyProductGarments)
        .set({ funnelTemplateId: targetId, funnelAssignmentSource: 'admin_reassign' })
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
        .returning({
          id: schema.shopifyFunnelTemplates.id,
          imageKey: schema.shopifyFunnelTemplates.imageKey,
        });
      if (!deleted) throw new AppError('NOT_FOUND', 404, 'funnel template not found');
      if (deleted.imageKey) await app.storage.deleteObject(deleted.imageKey).catch(() => {});
      return {
        ok: true,
        rulesAffected: impact.rulesAffected,
        storesAffected: impact.storesAffected,
        hasGlobalRule: impact.hasGlobalRule,
      };
    },
  );
}
