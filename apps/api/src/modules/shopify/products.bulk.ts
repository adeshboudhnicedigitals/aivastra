import { schema } from '@aivastra/db';
import { and, eq, inArray, ne, notInArray, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { buildProductFilter, ProductFilterSchema } from './products.filter.js';

const ids = z.array(z.number().int().positive()).max(5000);

export const BulkBodySchema = z
  .object({
    target: z.union([
      z.object({ ids: ids.min(1) }).strict(),
      z.object({ filter: ProductFilterSchema, excludeIds: ids.optional() }).strict(),
    ]),
    // Only enabling: the wizard never needs to disable, and Manage already
    // handles that per product. `z.literal(true)` makes `false` a 400.
    enabled: z.literal(true).optional(),
    // null clears the pin. `.optional()` alone would make an absent key and an
    // explicit null indistinguishable, so `.nullable()` is load-bearing.
    funnelTemplateId: z.string().uuid().nullable().optional(),
  })
  .refine((b) => b.enabled !== undefined || b.funnelTemplateId !== undefined, {
    message: 'at least one of enabled or funnelTemplateId is required',
  });
export type BulkBody = z.infer<typeof BulkBodySchema>;

export interface BulkResult {
  updated: number;
  skipped: { notActive: number; excluded: number };
}

/**
 * Enables and/or pins many products in one statement. The target is resolved
 * inside the UPDATE's WHERE clause (never as a big id list), always constrained
 * to the caller's store, so another store's ids or a broad filter can only ever
 * reach this store's rows.
 */
export async function bulkUpdateProducts(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
  body: BulkBody,
): Promise<BulkResult> {
  const t = schema.shopifyProductGarments;

  // Checked before anything is written so a stale basket can never leave the
  // products half-updated. Same 404 the single-product PATCH gives.
  if (body.funnelTemplateId) {
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
  }

  let matched: SQL;
  if ('ids' in body.target) {
    matched = and(
      eq(t.storeId, store.id),
      ne(t.status, 'deleted'),
      inArray(t.shopifyProductId, body.target.ids),
    ) as SQL;
  } else {
    const filter = buildProductFilter(store.id, body.target.filter);
    const excludeIds = body.target.excludeIds;
    matched = (
      excludeIds?.length ? and(filter, notInArray(t.shopifyProductId, excludeIds)) : filter
    ) as SQL;
  }

  return app.db.transaction(async (tx) => {
    // Why each matched product will or won't be enabled, counted up front so the
    // merchant can be told how many were skipped and why.
    const [counts] = await tx
      .select({
        notActive: sql<number>`count(*) filter (where ${t.status} <> 'active')`.mapWith(Number),
        excluded:
          sql<number>`count(*) filter (where ${t.status} = 'active' and ${t.excluded})`.mapWith(
            Number,
          ),
      })
      .from(t)
      .where(matched);

    // Enabling only reaches products that can actually be enabled — the same
    // rule the single-product PATCH enforces ("cannot enable a product that is
    // not active"), plus excluded products, which exclusion always overrides.
    const eligible = body.enabled
      ? (and(matched, eq(t.status, 'active'), eq(t.excluded, false)) as SQL)
      : matched;

    const patch: Partial<typeof t.$inferInsert> = {};
    if (body.enabled) patch.enabled = true;
    if (body.funnelTemplateId !== undefined) {
      patch.funnelTemplateId = body.funnelTemplateId;
      patch.funnelAssignmentSource = body.funnelTemplateId === null ? null : 'manual';
    }

    const rows = await tx.update(t).set(patch).where(eligible).returning({ id: t.id });
    return {
      updated: rows.length,
      skipped: body.enabled
        ? { notActive: counts.notActive, excluded: counts.excluded }
        : { notActive: 0, excluded: 0 },
    };
  });
}
