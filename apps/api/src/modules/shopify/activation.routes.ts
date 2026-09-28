import { schema } from '@aivastra/db';
import { and, count, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { countEffectivelyEnabled } from './activation.js';
import { searchCollections, syncCollectionMembership } from './collections.sync.js';
import { countUnroutedProducts } from './funnel-resolution.js';
import { enqueueSync, shopifyGraphQL } from './service.js';
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

// The catch-up check reads Shopify's live product count, so it is rate-limited
// per store: at most one check every 30s, and at most one reconcile queued every
// 30 minutes (a big import's reconcile can run for a long while, and a second
// one queued behind it would find nothing left to do).
const CATCH_UP_CHECK_TTL_S = 30;
const CATCH_UP_QUEUE_TTL_S = 30 * 60;

const ModeBody = z.object({ mode: z.enum(['global', 'selective']) });
const CollectionIdsBody = z.object({ shopifyCollectionIds: z.array(z.number().int()).min(1) });
// q is optional: without it the picker gets every collection to tick from.
const SearchQuery = z.object({ q: z.string().default('') });
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

  // Rows whose image actually synced. Failed rows are left out: counting them
  // made a store with one failed product read "9/9 synced" when only 8 had an
  // image we could try on. Soft-deleted rows are left out too — they are kept
  // for audit/history and must not push this past Shopify's own live
  // productsCount below (e.g. "8/7 Products Synced"). Rows still 'processing'
  // aren't synced yet either.
  const [{ totalSynced }] = await app.db
    .select({ totalSynced: count() })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, storeId),
        eq(schema.shopifyProductGarments.status, 'active'),
      ),
    );

  // Effective enablement, not the `enabled` column: a product turned on by
  // global mode or by an enabled collection counts here, and an excluded one
  // never does. See countEffectivelyEnabled for why this is SQL.
  //
  // Then subtract products that are effectively enabled but resolve to no
  // basket (no pin, no matching store/global rule) — those can never actually
  // complete a try-on (customer.routes.ts refuses them before enqueue), so
  // counting them here would overstate what "Try-On Enabled" means. Left
  // uncorrected (unroutedCounts.countsOmitted) for catalogs over the routing
  // scan's product cap, same degradation the Routing tab already accepts.
  //
  // countUnroutedProducts is a full per-product routing scan (up to 10,000
  // rows) — skip it entirely when there's nothing to correct.
  const rawTryonEnabledProducts = await countEffectivelyEnabled(app, store);
  const unroutedCounts =
    rawTryonEnabledProducts > 0 ? await countUnroutedProducts(app, store) : null;
  const tryonEnabledProducts =
    !unroutedCounts || unroutedCounts.countsOmitted
      ? rawTryonEnabledProducts
      : rawTryonEnabledProducts - (unroutedCounts.unroutedEnabled ?? 0);

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

  // Called when the merchant opens Manage. If Shopify has more products than we
  // have rows for (a CSV import, bulk edit or dropped webhooks left us behind),
  // queue a reconcile so they arrive without anyone pressing Sync. A product that
  // failed to sync still counts as seen here — the reconcile's own retry of failed
  // rows deals with those. `behindBy` lets the page know to keep watching.
  app.post(
    '/v1/shopify/products/catch-up',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      // The last answer is cached for the check window, so a page that asks twice
      // (React StrictMode in dev, two tabs) gets the same `behindBy` and can show
      // progress, instead of a bare 0 that reads as "nothing to do".
      const checkKey = `shopify:catchup:check:${store.id}`;
      const cached = await app.redis.get(checkKey);
      if (cached !== null) return { behindBy: Number(cached), queued: false };

      const live = await fetchTotalProductCount(app, store);
      if (live === null) return { behindBy: 0, queued: false };
      const [{ rows }] = await app.db
        .select({ rows: count() })
        .from(schema.shopifyProductGarments)
        .where(
          and(
            eq(schema.shopifyProductGarments.storeId, store.id),
            ne(schema.shopifyProductGarments.status, 'deleted'),
          ),
        );
      const behindBy = Math.max(0, live - rows);
      await app.redis.set(checkKey, String(behindBy), 'EX', CATCH_UP_CHECK_TTL_S);
      if (behindBy === 0) return { behindBy: 0, queued: false };

      const queued =
        (await app.redis.set(
          `shopify:catchup:queued:${store.id}`,
          '1',
          'EX',
          CATCH_UP_QUEUE_TTL_S,
          'NX',
        )) === 'OK';
      if (queued) await enqueueSync(app.redis, { storeId: store.id, mode: 'reconcile' });
      return { behindBy, queued };
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
