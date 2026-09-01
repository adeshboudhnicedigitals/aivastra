import { schema } from '@aivastra/db';
import { and, count, eq, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export interface EffectiveEnablementInput {
  mode: 'global' | 'selective';
  individuallyEnabled: boolean;
  individuallyExcluded: boolean;
  inEnabledCollection: boolean;
  inExcludedCollection: boolean;
}

/**
 * The one place the activation precedence rule is allowed to live. Exclusion
 * is checked first in every branch, including under global mode — a product
 * excluded while global mode is on stays excluded. Every other caller in this
 * codebase (the try-on enforcement point, every list endpoint, every summary
 * count) must go through this function or `resolveEffectiveEnabled` rather
 * than re-deriving the rule.
 */
export function computeEffectiveEnabled(input: EffectiveEnablementInput): boolean {
  if (input.individuallyExcluded || input.inExcludedCollection) return false;
  if (input.mode === 'global') return true;
  return input.individuallyEnabled || input.inEnabledCollection;
}

async function isInCollectionSet(
  app: FastifyInstance,
  storeId: string,
  shopifyProductId: number,
  collectionSetTable:
    | typeof schema.shopifyEnabledCollections
    | typeof schema.shopifyExcludedCollections,
): Promise<boolean> {
  const [row] = await app.db
    .select({ one: sql<number>`1` })
    .from(schema.shopifyCollectionProducts)
    .innerJoin(
      collectionSetTable,
      and(
        eq(collectionSetTable.storeId, schema.shopifyCollectionProducts.storeId),
        eq(
          collectionSetTable.shopifyCollectionId,
          schema.shopifyCollectionProducts.shopifyCollectionId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.shopifyCollectionProducts.storeId, storeId),
        eq(schema.shopifyCollectionProducts.shopifyProductId, shopifyProductId),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * DB-backed wrapper around `computeEffectiveEnabled` for a single product.
 * Two collection-membership lookups plus the pure resolver — this is the
 * function `customer.routes.ts` calls at the actual try-on enforcement point.
 */
export async function resolveEffectiveEnabled(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
  garment: { shopifyProductId: number; enabled: boolean; excluded: boolean },
): Promise<boolean> {
  const [inEnabledCollection, inExcludedCollection] = await Promise.all([
    isInCollectionSet(app, store.id, garment.shopifyProductId, schema.shopifyEnabledCollections),
    isInCollectionSet(app, store.id, garment.shopifyProductId, schema.shopifyExcludedCollections),
  ]);

  return computeEffectiveEnabled({
    mode: store.settings.activation?.mode ?? 'selective',
    individuallyEnabled: garment.enabled,
    individuallyExcluded: garment.excluded,
    inEnabledCollection,
    inExcludedCollection,
  });
}

/** EXISTS predicate: is the garment row's product in any collection in `set`? */
function inCollectionSetSql(
  set: typeof schema.shopifyEnabledCollections | typeof schema.shopifyExcludedCollections,
) {
  return sql`exists (
    select 1
    from ${schema.shopifyCollectionProducts} cp
    join ${set} s
      on s.store_id = cp.store_id
     and s.shopify_collection_id = cp.shopify_collection_id
    where cp.store_id = ${schema.shopifyProductGarments.storeId}
      and cp.shopify_product_id = ${schema.shopifyProductGarments.shopifyProductId}
  )`;
}

/**
 * How many synced products currently have try-on effectively on.
 *
 * This is the one place the activation rule is expressed as SQL rather than
 * through `computeEffectiveEnabled`, and it lives here — beside the function it
 * mirrors — so the two are read and changed together. Per-row use of
 * `resolveEffectiveEnabled` would be two queries per product, which a
 * catalog-sized store turns into thousands on a single Manage page load.
 *
 * The mirroring is not left to reviewer discipline: an integration test seeds
 * every combination of the five inputs in both modes and asserts this count
 * equals the number `computeEffectiveEnabled` returns true for, so any drift
 * between the two fails the build.
 */
export async function countEffectivelyEnabled(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<number> {
  const mode = store.settings.activation?.mode ?? 'selective';

  const [row] = await app.db
    .select({ value: count() })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, store.id),
        // Exclusion wins first, exactly as in computeEffectiveEnabled.
        eq(schema.shopifyProductGarments.excluded, false),
        sql`not ${inCollectionSetSql(schema.shopifyExcludedCollections)}`,
        // Global short-circuits to enabled; selective falls back to the
        // individual flag or membership of an enabled collection.
        mode === 'global'
          ? undefined
          : or(
              eq(schema.shopifyProductGarments.enabled, true),
              inCollectionSetSql(schema.shopifyEnabledCollections),
            ),
      ),
    );

  return row?.value ?? 0;
}
