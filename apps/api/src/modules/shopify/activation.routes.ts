import { schema } from '@aivastra/db';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { countEffectivelyEnabled } from './activation.js';
import { searchCollections, syncCollectionMembership } from './collections.sync.js';
import { shopifyGraphQL } from './service.js';
import { mergeStoreSettingsObject, storeSettingsJson } from './settings-json.js';
import { getValidAccessToken } from './token.js';

const PRODUCTS_COUNT_QUERY = `
  query ProductsCount {
    productsCount {
      count
    }
  }
`;

/**
 * Shopify's live catalog size — a store's total product count isn't cached
 * anywhere, so this is a live GraphQL call. Returns null on failure (rate
 * limit, reauth needed, etc.) rather than throwing, so a Shopify hiccup never
 * breaks the rest of the Manage page — the "synced / total" figure just falls
 * back to showing the synced count alone.
 */
async function fetchTotalProductCount(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
): Promise<number | null> {
  try {
    const accessToken = await getValidAccessToken(app, store);
    const data = await shopifyGraphQL<{ productsCount: { count: number } }>(
      store.shopDomain,
      accessToken,
      PRODUCTS_COUNT_QUERY,
    );
    return data.productsCount.count;
  } catch (err) {
    app.log.warn({ err, storeId: store.id }, 'failed to fetch Shopify productsCount');
    return null;
  }
}

const ModeBody = z.object({ mode: z.enum(['global', 'selective']) });
const CollectionIdsBody = z.object({ shopifyCollectionIds: z.array(z.number().int()).min(1) });
const SearchQuery = z.object({ q: z.string().min(1) });
const CollectionIdParams = z.object({ shopifyCollectionId: z.coerce.number().int() });

async function summaryCounts(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
) {
  const storeId = store.id;

  const [{ enabledCollections }] = await app.db
    .select({ enabledCollections: count() })
    .from(schema.shopifyEnabledCollections)
    .where(eq(schema.shopifyEnabledCollections.storeId, storeId));

  const [{ excludedCollections }] = await app.db
    .select({ excludedCollections: count() })
    .from(schema.shopifyExcludedCollections)
    .where(eq(schema.shopifyExcludedCollections.storeId, storeId));

  // Catalog-wide, deliberately independent of `enabled` — a product turned on
  // via a collection or global mode never appears in the individually-enabled
  // set and would otherwise have no failure visibility at all.
  const [{ failedToSync }] = await app.db
    .select({ failedToSync: count() })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, storeId),
        eq(schema.shopifyProductGarments.status, 'failed'),
      ),
    );

  // Every row we've ever created for this store, regardless of status.
  const [{ totalSynced }] = await app.db
    .select({ totalSynced: count() })
    .from(schema.shopifyProductGarments)
    .where(eq(schema.shopifyProductGarments.storeId, storeId));

  // Effective enablement, not the `enabled` column: a product turned on by
  // global mode or by an enabled collection counts here, and an excluded one
  // never does. See countEffectivelyEnabled for why this is SQL.
  const tryonEnabledProducts = await countEffectivelyEnabled(app, store);

  const totalProductCount = await fetchTotalProductCount(app, store);

  return {
    enabledCollections,
    excludedCollections,
    failedToSync,
    tryonEnabledProducts,
    syncedProductCount: totalSynced,
    totalProductCount,
  };
}

function registerCollectionSetRoutes(
  app: FastifyInstance,
  basePath: string,
  table: typeof schema.shopifyEnabledCollections | typeof schema.shopifyExcludedCollections,
  siblingTable: typeof schema.shopifyEnabledCollections | typeof schema.shopifyExcludedCollections,
) {
  app.get(basePath, { preHandler: app.requireShopifySession }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    const selections = await app.db.select().from(table).where(eq(table.storeId, store.id));

    const items = await Promise.all(
      selections.map(async (s) => {
        const [collectionRow] = await app.db
          .select({ title: schema.shopifyCollections.title })
          .from(schema.shopifyCollections)
          .where(
            and(
              eq(schema.shopifyCollections.storeId, store.id),
              eq(schema.shopifyCollections.shopifyCollectionId, s.shopifyCollectionId),
            ),
          )
          .limit(1);
        const [{ productCount }] = await app.db
          .select({ productCount: count() })
          .from(schema.shopifyCollectionProducts)
          .where(
            and(
              eq(schema.shopifyCollectionProducts.storeId, store.id),
              eq(schema.shopifyCollectionProducts.shopifyCollectionId, s.shopifyCollectionId),
            ),
          );
        return {
          shopifyCollectionId: s.shopifyCollectionId,
          title: collectionRow?.title ?? '',
          productCount,
        };
      }),
    );
    return { items };
  });

  app.post(
    basePath,
    { preHandler: app.requireShopifySession, schema: { body: CollectionIdsBody } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { shopifyCollectionIds } = req.body as z.infer<typeof CollectionIdsBody>;

      for (const shopifyCollectionId of shopifyCollectionIds) {
        await syncCollectionMembership(app, store, shopifyCollectionId);
        await app.db
          .insert(table)
          .values({ storeId: store.id, shopifyCollectionId })
          .onConflictDoNothing();
      }
      return { ok: true };
    },
  );

  app.delete(
    `${basePath}/:shopifyCollectionId`,
    { preHandler: app.requireShopifySession, schema: { params: CollectionIdParams } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { shopifyCollectionId } = req.params as z.infer<typeof CollectionIdParams>;

      await app.db
        .delete(table)
        .where(
          and(eq(table.storeId, store.id), eq(table.shopifyCollectionId, shopifyCollectionId)),
        );

      // The membership cache in `shopify_collection_products` is shared by
      // both selection tables (nothing enforces a collection can't be in
      // both enabled and excluded at once). Only clear it once the
      // collection is selected in NEITHER table — otherwise the sibling
      // selection (e.g. an exclusion) would silently stop applying until
      // the next hourly resync repopulates it.
      const [stillSelectedInSibling] = await app.db
        .select({ shopifyCollectionId: siblingTable.shopifyCollectionId })
        .from(siblingTable)
        .where(
          and(
            eq(siblingTable.storeId, store.id),
            eq(siblingTable.shopifyCollectionId, shopifyCollectionId),
          ),
        )
        .limit(1);

      if (!stillSelectedInSibling) {
        await app.db
          .delete(schema.shopifyCollectionProducts)
          .where(
            and(
              eq(schema.shopifyCollectionProducts.storeId, store.id),
              eq(schema.shopifyCollectionProducts.shopifyCollectionId, shopifyCollectionId),
            ),
          );
      }
      return { ok: true };
    },
  );
}

export async function shopifyActivationRoutes(app: FastifyInstance) {
  app.get('/v1/shopify/activation', { preHandler: app.requireShopifySession }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    return {
      mode: store.settings.activation?.mode ?? 'selective',
      counts: await summaryCounts(app, store),
    };
  });

  app.patch(
    '/v1/shopify/activation/mode',
    { preHandler: app.requireShopifySession, schema: { body: ModeBody } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { mode } = req.body as z.infer<typeof ModeBody>;

      const settings = mergeStoreSettingsObject(storeSettingsJson(), ['activation'], { mode });
      await app.db
        .update(schema.shopifyStores)
        .set({ settings, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id));

      return { mode };
    },
  );

  app.get(
    '/v1/shopify/activation/collections/search',
    { preHandler: app.requireShopifySession, schema: { querystring: SearchQuery } },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const { q } = req.query as z.infer<typeof SearchQuery>;
      const items = await searchCollections(app, store, q);
      return { items };
    },
  );

  registerCollectionSetRoutes(
    app,
    '/v1/shopify/activation/collections',
    schema.shopifyEnabledCollections,
    schema.shopifyExcludedCollections,
  );
  registerCollectionSetRoutes(
    app,
    '/v1/shopify/activation/exclusions/collections',
    schema.shopifyExcludedCollections,
    schema.shopifyEnabledCollections,
  );
}
