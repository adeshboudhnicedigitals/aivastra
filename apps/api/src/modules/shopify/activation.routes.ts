import { schema } from '@aivastra/db';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { searchCollections, syncCollectionMembership } from './collections.sync.js';
import { mergeStoreSettingsObject, storeSettingsJson } from './settings-json.js';

const ModeBody = z.object({ mode: z.enum(['global', 'selective']) });
const CollectionIdsBody = z.object({ shopifyCollectionIds: z.array(z.number().int()).min(1) });
const SearchQuery = z.object({ q: z.string().min(1) });

async function summaryCounts(app: FastifyInstance, storeId: string) {
  const [{ enabledCollections }] = await app.db
    .select({ enabledCollections: count() })
    .from(schema.shopifyEnabledCollections)
    .where(eq(schema.shopifyEnabledCollections.storeId, storeId));

  const [{ excludedCollections }] = await app.db
    .select({ excludedCollections: count() })
    .from(schema.shopifyExcludedCollections)
    .where(eq(schema.shopifyExcludedCollections.storeId, storeId));

  const [{ individuallyEnabledProducts }] = await app.db
    .select({ individuallyEnabledProducts: count() })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, storeId),
        eq(schema.shopifyProductGarments.enabled, true),
      ),
    );

  const [{ excludedProducts }] = await app.db
    .select({ excludedProducts: count() })
    .from(schema.shopifyProductGarments)
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, storeId),
        eq(schema.shopifyProductGarments.excluded, true),
      ),
    );

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

  return {
    enabledCollections,
    excludedCollections,
    individuallyEnabledProducts,
    excludedProducts,
    failedToSync,
  };
}

function registerCollectionSetRoutes(
  app: FastifyInstance,
  basePath: string,
  table: typeof schema.shopifyEnabledCollections | typeof schema.shopifyExcludedCollections,
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
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const shopifyCollectionId = Number(
        (req.params as { shopifyCollectionId: string }).shopifyCollectionId,
      );

      await app.db
        .delete(table)
        .where(
          and(eq(table.storeId, store.id), eq(table.shopifyCollectionId, shopifyCollectionId)),
        );
      await app.db
        .delete(schema.shopifyCollectionProducts)
        .where(
          and(
            eq(schema.shopifyCollectionProducts.storeId, store.id),
            eq(schema.shopifyCollectionProducts.shopifyCollectionId, shopifyCollectionId),
          ),
        );
      return { ok: true };
    },
  );
}

export async function shopifyActivationRoutes(app: FastifyInstance) {
  app.get('/v1/shopify/activation', { preHandler: app.requireShopifySession }, async (req) => {
    const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
    return {
      mode: store.settings.activation?.mode ?? 'selective',
      counts: await summaryCounts(app, store.id),
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
  );
  registerCollectionSetRoutes(
    app,
    '/v1/shopify/activation/exclusions/collections',
    schema.shopifyExcludedCollections,
  );
}
