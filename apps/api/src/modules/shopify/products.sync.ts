import { schema } from '@aivastra/db';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { getUploadLimitBytes } from '../../lib/upload-limits-config.js';
import { numericIdFromGid, type SyncTask, shopifyGraphQL, toGid } from './service.js';
import { getValidAccessToken } from './token.js';

/**
 * Normalized product shape consumed by syncProduct.
 *
 * Deliberately not Shopify's wire format: syncProduct is business logic and is
 * tested directly, so the GraphQL response is mapped into this at the fetch
 * boundary by toShopifyProduct below.
 */
export interface ShopifyProduct {
  id: number;
  title: string;
  imageUrl?: string | null;
  productType?: string | null;
  tags?: string[] | null;
  vendor?: string | null;
  collections?: string[] | null;
}

/** Minimal shape we need from a fetch Response — lets tests pass a plain object
 *  (e.g. `headers: new Map(...)`) without reaching for `any`. */
interface FetchLikeResponse {
  ok: boolean;
  status?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: { get(name: string): string | null | undefined };
}
type FetchLike = (url: string, init?: RequestInit) => Promise<FetchLikeResponse>;

const ALLOWED_HOSTS = /(^|\.)(myshopify\.com|shopify\.com|cdn\.shopify\.com)$/;
const FETCH_TIMEOUT_MS = 10_000;

// Shopify product-level garment rows (no specific variant) are stored with this
// sentinel instead of NULL. Postgres UNIQUE constraints treat every NULL as distinct
// from every other NULL, so `ON CONFLICT (store_id, product_id, variant_id)` would
// never match an existing NULL-variant row on a repeat sync — each full/product sync
// would INSERT a fresh duplicate row instead of updating the one already there.
// Real Shopify variant IDs are large positive bigints, so 0 can never collide with one.
const NO_VARIANT_SENTINEL = 0;

export function assertShopifyCdn(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('image url must be https');
  if (!ALLOWED_HOSTS.test(u.hostname)) throw new Error(`image host not allowed: ${u.hostname}`);
}

// Shared selection set. Product.collections returns titles inline, which is why
// there is no longer a collects.json call or a collection-title map here: the
// REST version needed one extra request per product to learn the same thing.
//
// collections(first: 25) caps what REST paginated fully. That is safe because
// shopify_product_garments.collections is written and never read — activation
// resolves membership through shopify_collection_products (populated by
// collections.sync.ts), not this column.
const PRODUCT_FIELDS = `
  id
  title
  productType
  tags
  vendor
  featuredImage { url }
  collections(first: 25) { nodes { title } }
`;

const PRODUCTS_PAGE = `
  query ProductsPage($cursor: String) {
    products(first: 25, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ${PRODUCT_FIELDS} }
    }
  }
`;

const ONE_PRODUCT = `
  query OneProduct($id: ID!) {
    product(id: $id) { ${PRODUCT_FIELDS} }
  }
`;

// id-only, no nested fields — the query cost is trivial, so this can page at
// 250 instead of the 25 the full sync uses (that page size is bounded by the
// nested collections(25) cost, which this query doesn't have). Used only to
// build the "still exists on Shopify" id set for reconciliation — see
// reconcileDeletedProducts. Not filtered by status, same as PRODUCTS_PAGE, so
// a product Shopify still has in any state (active/draft/archived) is never
// mistaken for deleted.
const PRODUCT_IDS_PAGE = `
  query ProductIdsPage($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id }
    }
  }
`;

interface ProductIdsPageData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ id: string }>;
  };
}

interface GraphQLProductNode {
  id: string;
  title: string;
  productType?: string | null;
  tags?: string[] | null;
  vendor?: string | null;
  featuredImage?: { url?: string | null } | null;
  collections?: { nodes: Array<{ title: string }> } | null;
}

interface ProductsPageData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GraphQLProductNode[];
  };
}

/** GraphQL wire shape → the normalized shape syncProduct consumes. */
function toShopifyProduct(node: GraphQLProductNode): ShopifyProduct {
  return {
    id: numericIdFromGid(node.id),
    title: node.title,
    imageUrl: node.featuredImage?.url ?? null,
    // Empty string is Shopify's "unset" for these, and the columns are nullable.
    productType: node.productType || null,
    tags: node.tags && node.tags.length > 0 ? node.tags : null,
    vendor: node.vendor || null,
    collections: node.collections?.nodes.map((c) => c.title) ?? null,
  };
}

async function upsertGarment(
  app: FastifyInstance,
  storeId: string,
  productId: number,
  r2Key: string,
  title: string,
  status: string,
  productType: string | null,
  tags: string[] | null,
  vendor: string | null,
  collections: string[] | null,
  failedReason?: string,
) {
  const [row] = await app.db
    .insert(schema.shopifyProductGarments)
    .values({
      storeId,
      shopifyProductId: productId,
      shopifyVariantId: NO_VARIANT_SENTINEL,
      r2Key,
      title,
      status,
      productType,
      tags,
      vendor,
      collections,
      failedReason,
    })
    .onConflictDoUpdate({
      target: [
        schema.shopifyProductGarments.storeId,
        schema.shopifyProductGarments.shopifyProductId,
        schema.shopifyProductGarments.shopifyVariantId,
      ],
      set: {
        title,
        status,
        productType,
        tags,
        vendor,
        collections,
        failedReason: failedReason ?? null,
        syncedAt: sql`now()`,
      },
    })
    .returning();
  return row;
}

/** Records a failed (or, for a confirmed-gone product, deleted) sync for a
 *  product we couldn't fetch from Shopify — no product data is available, so
 *  title/productType/tags/vendor/collections stay null. Upserts rather than
 *  requiring an existing row, so this also covers a product that's never been
 *  synced before (e.g. a shopper's on-demand try-on of an ID that turns out to
 *  already be gone from Shopify). */
async function upsertGarmentFailure(
  app: FastifyInstance,
  storeId: string,
  productId: number,
  failedReason: string,
  status: 'failed' | 'deleted' = 'failed',
): Promise<void> {
  const r2Key = `shopify-garments/${storeId}/${productId}/garment.jpg`;
  await upsertGarment(
    app,
    storeId,
    productId,
    r2Key,
    '',
    status,
    null,
    null,
    null,
    null,
    failedReason,
  );
}

/**
 * Reconciliation backstop for the products/delete webhook (see
 * webhook.routes.ts): marks every non-deleted shopify_product_garments row
 * for this store that is NOT in `liveProductIds` as deleted. Deletion has
 * exactly one other trigger — that webhook — which is registered once at
 * install/reauth with registration failures only logged, and even a
 * successfully-registered subscription can still have one delivery dropped
 * with nothing to notice. Called from both the 'reconcile' branch (a cheap
 * id-only hourly sweep, see startProductResyncScheduler) and the full-sync
 * branch (which already has the complete live id set as a side effect of
 * paginating every product, so no extra Shopify calls are needed there).
 *
 * liveProductIds must be the store's COMPLETE current catalog, not a partial
 * page — an empty array is treated as "Shopify has zero products for this
 * store" and marks everything deleted, not as "nothing to reconcile".
 */
async function reconcileDeletedProducts(
  app: FastifyInstance,
  storeId: string,
  liveProductIds: number[],
): Promise<void> {
  await app.db
    .update(schema.shopifyProductGarments)
    .set({ status: 'deleted' })
    .where(
      and(
        eq(schema.shopifyProductGarments.storeId, storeId),
        sql`${schema.shopifyProductGarments.status} <> 'deleted'`,
        liveProductIds.length > 0
          ? notInArray(schema.shopifyProductGarments.shopifyProductId, liveProductIds)
          : sql`true`,
      ),
    );
}

export async function syncProduct(
  app: FastifyInstance,
  storeId: string,
  product: ShopifyProduct,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<void> {
  const r2Key = `shopify-garments/${storeId}/${product.id}/garment.jpg`;
  const productType = product.productType ?? null;
  const tags = product.tags ?? null;
  const vendor = product.vendor ?? null;
  const collections = product.collections ?? null;
  const src = product.imageUrl;
  if (!src) {
    await upsertGarment(
      app,
      storeId,
      product.id,
      r2Key,
      product.title,
      'failed',
      productType,
      tags,
      vendor,
      collections,
      'no product image',
    );
    return;
  }
  try {
    assertShopifyCdn(src);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: FetchLikeResponse;
    try {
      res = await fetchFn(src, { redirect: 'error', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const maxSyncBytes = await getUploadLimitBytes(app, 'shopifyProductSyncMaxBytes');
    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxSyncBytes) {
      throw new Error(`product image exceeds ${maxSyncBytes / (1024 * 1024)}MB`);
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > maxSyncBytes) {
      throw new Error(`product image exceeds ${maxSyncBytes / (1024 * 1024)}MB`);
    }
    const buf = Buffer.from(arrayBuffer);
    const ct = res.headers.get('content-type') ?? 'image/jpeg';
    await app.storage.putObject(r2Key, buf, ct);
    await upsertGarment(
      app,
      storeId,
      product.id,
      r2Key,
      product.title,
      'active',
      productType,
      tags,
      vendor,
      collections,
    );
  } catch (err) {
    app.log.warn({ err, storeId, productId: product.id }, 'product sync failed');
    await upsertGarment(
      app,
      storeId,
      product.id,
      r2Key,
      product.title,
      'failed',
      productType,
      tags,
      vendor,
      collections,
      (err as Error).message,
    );
  }
}

export async function syncOneTask(app: FastifyInstance, task: SyncTask): Promise<void> {
  const [store] = await app.db
    .select()
    .from(schema.shopifyStores)
    .where(eq(schema.shopifyStores.id, task.storeId))
    .limit(1);
  if (!store || store.uninstalledAt) return;
  // Refreshed up front rather than decrypted: this runs unattended, so there is
  // no merchant present to reauthorize if the stored token has aged out.
  let token = await getValidAccessToken(app, store);
  const shop = store.shopDomain;
  // A full sync of a large catalog outlives the one-hour token: 250 products a
  // page, a collects call each, throttled. Re-reading through
  // getValidAccessToken rather than forcing a rotation means a token another
  // process already refreshed is reused, and only a genuinely stale one is
  // rotated. Reassigning `token` also fixes up the helpers below, which read it
  // at call time.
  const onUnauthorized = async () => {
    token = await getValidAccessToken(app, store);
    return token;
  };

  // Shared by 'product' mode (a single webhook-driven id) and the new-product
  // discovery branch of 'reconcile' mode below — both need to turn one
  // Shopify product id into a garment row via the identical fetch/error path.
  async function fetchAndSyncOneProduct(productId: number): Promise<void> {
    let node: GraphQLProductNode | null;
    try {
      const data = await shopifyGraphQL<{ product: GraphQLProductNode | null }>(
        shop,
        token,
        ONE_PRODUCT,
        { id: toGid('Product', productId) },
        { onUnauthorized },
      );
      node = data.product;
    } catch (err) {
      // SHOPIFY_REAUTH_REQUIRED is a store-wide auth failure, not a per-product
      // one — blanking this one garment row doesn't address it, and the whole
      // store needs reauth. Propagate it so the caller's mode aborts instead of
      // recording a misleading per-product failure.
      if (err instanceof AppError && err.code === 'SHOPIFY_REAUTH_REQUIRED') throw err;
      app.log.warn(
        { err, storeId: store.id, productId },
        'shopify product fetch failed during sync',
      );
      await upsertGarmentFailure(
        app,
        store.id,
        productId,
        `product fetch failed: ${(err as Error).message}`,
      );
      return;
    }

    if (!node) {
      // Shopify's products(...) query (and this single-product lookup) is
      // never filtered by status, so "not found" reliably means gone, not
      // merely draft/archived.
      app.log.info(
        { storeId: store.id, productId },
        'shopify product not found during sync — marking deleted',
      );
      await upsertGarmentFailure(
        app,
        store.id,
        productId,
        'product not found on Shopify',
        'deleted',
      );
      return;
    }

    await syncProduct(app, store.id, toShopifyProduct(node));
  }

  if (task.mode === 'collection') {
    if (task.shopifyCollectionId === undefined) return;
    const { syncCollectionMembership, CollectionNotFoundError } = await import(
      './collections.sync.js'
    );
    const shopifyCollectionId = task.shopifyCollectionId;
    try {
      await syncCollectionMembership(app, store, shopifyCollectionId);
    } catch (err) {
      if (err instanceof CollectionNotFoundError) {
        // Confirmed deleted on Shopify's side — the selection itself is
        // meaningless now, so remove it along with the cached membership,
        // not just the membership.
        await app.db
          .delete(schema.shopifyCollections)
          .where(
            and(
              eq(schema.shopifyCollections.storeId, store.id),
              eq(schema.shopifyCollections.shopifyCollectionId, shopifyCollectionId),
            ),
          );
        await app.db
          .delete(schema.shopifyCollectionProducts)
          .where(
            and(
              eq(schema.shopifyCollectionProducts.storeId, store.id),
              eq(schema.shopifyCollectionProducts.shopifyCollectionId, shopifyCollectionId),
            ),
          );
        await app.db
          .delete(schema.shopifyEnabledCollections)
          .where(
            and(
              eq(schema.shopifyEnabledCollections.storeId, store.id),
              eq(schema.shopifyEnabledCollections.shopifyCollectionId, shopifyCollectionId),
            ),
          );
        await app.db
          .delete(schema.shopifyExcludedCollections)
          .where(
            and(
              eq(schema.shopifyExcludedCollections.storeId, store.id),
              eq(schema.shopifyExcludedCollections.shopifyCollectionId, shopifyCollectionId),
            ),
          );
        app.log.info(
          { storeId: task.storeId, shopifyCollectionId },
          'collection deleted on Shopify — removed selection and cached membership',
        );
        return;
      }
      // Anything else (rate limit, 5xx, network) is not a deletion — log and
      // let next cycle's tick re-enqueue this same collection. The outer
      // sync-consumer loop already isolates one task's throw from the rest of
      // the stream, so re-throwing here would be redundant, not additive.
      app.log.warn(
        { err, storeId: task.storeId, shopifyCollectionId },
        'scheduled collection resync failed — will retry next cycle',
      );
    }
    return;
  }

  if (task.mode === 'product' && task.shopifyProductId) {
    await fetchAndSyncOneProduct(task.shopifyProductId);
    return;
  }

  if (task.mode === 'reconcile') {
    // Backstop for both the products/delete webhook AND the products/create
    // webhook (a delivery can be dropped, or — for a store that installed
    // before products/create existed — never registered at all until the
    // store reinstalls). Pulls just the ids Shopify currently has (no
    // image/collection fields, so this can page at 250 and skips all the R2
    // image work a full sync does), marks anything missing as deleted, and
    // fetches full data for any id Shopify has that this store has never seen
    // before. See startProductResyncScheduler — this runs hourly for every
    // store with synced products, independent of whether any webhook ever
    // fired.
    let cursor: string | null = null;
    const liveProductIds: number[] = [];
    do {
      const data: ProductIdsPageData = await shopifyGraphQL<ProductIdsPageData>(
        shop,
        token,
        PRODUCT_IDS_PAGE,
        { cursor },
        { onUnauthorized },
      );
      for (const node of data.products.nodes) {
        liveProductIds.push(numericIdFromGid(node.id));
      }
      cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
      if (cursor) await new Promise((r) => setTimeout(r, 300)); // throttle
    } while (cursor);

    // liveProductIds vs. every id this store has ANY row for (including
    // 'deleted' ones — Shopify doesn't reuse product ids, so a live id this
    // store has never had a row for is genuinely new, not a resurrection).
    const existingRows = await app.db
      .select({ id: schema.shopifyProductGarments.shopifyProductId })
      .from(schema.shopifyProductGarments)
      .where(eq(schema.shopifyProductGarments.storeId, store.id));
    const existingIds = new Set(existingRows.map((r) => r.id));
    const newProductIds = liveProductIds.filter((id) => !existingIds.has(id));
    for (const productId of newProductIds) {
      await fetchAndSyncOneProduct(productId);
      await new Promise((r) => setTimeout(r, 300)); // throttle, same cadence as the id-page loop above
    }

    await reconcileDeletedProducts(app, store.id, liveProductIds);
    return;
  }

  // Full sync, 25 products a page. Page size is bounded by Shopify's calculated
  // query cost (1000 per query): products(25) with a nested collections(25) is
  // roughly 25 + 25×25 = 650.
  let cursor: string | null = null;
  const liveProductIds: number[] = [];
  do {
    // onUnauthorized reassigns the outer `token`: a full sync of a large catalog
    // outlives the one-hour token, and this runs unattended with no merchant
    // present to reauthorize.
    const data: ProductsPageData = await shopifyGraphQL<ProductsPageData>(
      shop,
      token,
      PRODUCTS_PAGE,
      { cursor },
      { onUnauthorized },
    );
    for (const node of data.products.nodes) {
      const product = toShopifyProduct(node);
      liveProductIds.push(product.id);
      await syncProduct(app, store.id, product);
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    if (cursor) await new Promise((r) => setTimeout(r, 500)); // throttle
  } while (cursor);
  // Every product this pass saw was just upserted above; anything already in
  // the DB that wasn't seen no longer exists on Shopify. Runs on every full
  // sync, including the merchant's manual "Sync now" button, so a deletion
  // that was missed by the webhook is caught the moment they click it, not
  // just on the next hourly reconcile tick.
  await reconcileDeletedProducts(app, store.id, liveProductIds);
}
