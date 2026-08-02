import { schema } from '@aivastra/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { fetchCollectionTitleMap, nextPageUrl } from './products.sync.js';
import { shopifyAdminFetch } from './service.js';
import { getValidAccessToken } from './token.js';

/**
 * Thrown only when both `custom_collections` and `smart_collections` return a
 * genuine 404 for this ID — i.e. the collection was deleted on Shopify's
 * side. The scheduled resync (Task 6) treats this specifically as "clean up
 * this collection's rows"; any other failure (rate limit, 5xx, network) must
 * not be misread as a deletion, so it throws a plain `Error` instead and is
 * retried next cycle unchanged.
 */
export class CollectionNotFoundError extends Error {
  constructor(shopifyCollectionId: number) {
    super(`collection ${shopifyCollectionId} not found on either resource`);
    this.name = 'CollectionNotFoundError';
  }
}

async function fetchOneCollectionTitle(
  shop: string,
  token: string,
  shopifyCollectionId: number,
): Promise<string> {
  for (const resource of ['custom_collections', 'smart_collections'] as const) {
    const res = await shopifyAdminFetch(shop, token, `/${resource}/${shopifyCollectionId}.json`);
    if (res.ok) {
      const body = (await res.json()) as Record<string, { title: string }>;
      const key = resource === 'custom_collections' ? 'custom_collection' : 'smart_collection';
      const title = body[key]?.title;
      if (title) return title;
    } else if (res.status !== 404) {
      throw new Error(
        `${resource} fetch failed for collection ${shopifyCollectionId}: HTTP ${res.status}`,
      );
    }
  }
  throw new CollectionNotFoundError(shopifyCollectionId);
}

async function fetchCollectionMemberProductIds(
  shop: string,
  token: string,
  shopifyCollectionId: number,
): Promise<number[]> {
  const ids: number[] = [];
  let url: string | null = `/collects.json?collection_id=${shopifyCollectionId}&limit=250`;
  while (url) {
    const res = await shopifyAdminFetch(shop, token, url);
    if (!res.ok) throw new Error(`collects.json fetch failed: HTTP ${res.status}`);
    const { collects } = (await res.json()) as { collects: Array<{ product_id: number }> };
    for (const c of collects) ids.push(c.product_id);
    url = nextPageUrl(res);
  }
  return ids;
}

/**
 * Pulls one collection's title and full membership from Shopify and replaces
 * (not diffs) that collection's rows in `shopify_collection_products`, in one
 * transaction — a failure here must not leave a collection showing partial
 * membership.
 */
export async function syncCollectionMembership(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
  shopifyCollectionId: number,
): Promise<{ title: string; productCount: number }> {
  const token = await getValidAccessToken(app, store);
  const shop = store.shopDomain;

  // Sequential, not Promise.all: fetching the title first establishes whether
  // the collection still exists on Shopify's side. Running both concurrently
  // would race a single-fetch "collects.json failed" (plain Error) against the
  // two-fetch custom+smart lookup that produces CollectionNotFoundError — the
  // faster plain Error would usually win even when the real cause is that the
  // collection was deleted.
  const title = await fetchOneCollectionTitle(shop, token, shopifyCollectionId);
  const productIds = await fetchCollectionMemberProductIds(shop, token, shopifyCollectionId);

  await app.db.transaction(async (tx) => {
    await tx
      .insert(schema.shopifyCollections)
      .values({ storeId: store.id, shopifyCollectionId, title })
      .onConflictDoUpdate({
        target: [schema.shopifyCollections.storeId, schema.shopifyCollections.shopifyCollectionId],
        set: { title, syncedAt: new Date() },
      });

    await tx
      .delete(schema.shopifyCollectionProducts)
      .where(
        and(
          eq(schema.shopifyCollectionProducts.storeId, store.id),
          eq(schema.shopifyCollectionProducts.shopifyCollectionId, shopifyCollectionId),
        ),
      );

    if (productIds.length > 0) {
      await tx.insert(schema.shopifyCollectionProducts).values(
        productIds.map((shopifyProductId) => ({
          storeId: store.id,
          shopifyCollectionId,
          shopifyProductId,
        })),
      );
    }
  });

  return { title, productCount: productIds.length };
}

/**
 * Live search over every custom + smart collection, for the "Add
 * collections"/"Exclude collections" picker modal. Shopify's REST collections
 * endpoints only support exact-title filtering, not substring search, so this
 * fetches the full list (already what `fetchCollectionTitleMap` does for the
 * product sync's collection-title join) and filters in memory.
 */
export async function searchCollections(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
  q: string,
): Promise<Array<{ shopifyCollectionId: number; title: string }>> {
  const token = await getValidAccessToken(app, store);
  const titleById = await fetchCollectionTitleMap(store.shopDomain, token);
  const needle = q.toLowerCase();
  return [...titleById.entries()]
    .filter(([, title]) => title.toLowerCase().includes(needle))
    .map(([shopifyCollectionId, title]) => ({ shopifyCollectionId, title }));
}
