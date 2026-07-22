import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getUploadLimitBytes } from '../../lib/upload-limits-config.js';
import { assignFunnelFromRules } from './funnel-rules.js';
import { shopifyAdminFetch } from './service.js';

interface ShopifyProduct {
  id: number;
  title: string;
  image?: { src?: string } | null;
  product_type?: string;
  tags?: string;
  vendor?: string;
  /** Collection titles this product belongs to — resolved by the caller (syncOneTask)
   *  via collects.json, since Shopify's product resource doesn't include collections. */
  collections?: string[];
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

/** Records a failed sync for a product we couldn't even fetch from Shopify
 *  (deleted, wrong API scope, deprecated REST resource, etc.) — no product
 *  data is available, so title/productType/tags/vendor/collections stay null. */
async function upsertGarmentFailure(
  app: FastifyInstance,
  storeId: string,
  productId: number,
  failedReason: string,
): Promise<void> {
  const r2Key = `shopify-garments/${storeId}/${productId}/garment.jpg`;
  const row = await upsertGarment(
    app,
    storeId,
    productId,
    r2Key,
    '',
    'failed',
    null,
    null,
    null,
    null,
    failedReason,
  );
  if (row.funnelAssignmentSource !== 'manual') {
    await assignFunnelFromRules(app, row.id, storeId, {
      productType: null,
      tags: null,
      vendor: null,
      collections: null,
    });
  }
}

export async function syncProduct(
  app: FastifyInstance,
  storeId: string,
  product: ShopifyProduct,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<void> {
  const r2Key = `shopify-garments/${storeId}/${product.id}/garment.jpg`;
  const productType = product.product_type ?? null;
  const tags = product.tags
    ? product.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : null;
  const vendor = product.vendor ?? null;
  const collections = product.collections ?? null;
  const src = product.image?.src;
  if (!src) {
    const row = await upsertGarment(
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
    if (row.funnelAssignmentSource !== 'manual') {
      await assignFunnelFromRules(app, row.id, storeId, { productType, tags, vendor, collections });
    }
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
    const row = await upsertGarment(
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
    if (row.funnelAssignmentSource !== 'manual') {
      await assignFunnelFromRules(app, row.id, storeId, { productType, tags, vendor, collections });
    }
  } catch (err) {
    app.log.warn({ err, storeId, productId: product.id }, 'product sync failed');
    const row = await upsertGarment(
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
    if (row.funnelAssignmentSource !== 'manual') {
      await assignFunnelFromRules(app, row.id, storeId, { productType, tags, vendor, collections });
    }
  }
}

function nextPageUrl(res: { headers: { get(name: string): string | null } }): string | null {
  const link = res.headers.get('link') ?? '';
  const next = link.match(/<([^>]+)>;\s*rel="next"/);
  return next ? next[1] : null;
}

/** Shopify's product resource has no `collections` field — the id→title map is
 *  fetched once per sync run from custom/smart collections, then joined against
 *  each product's `collects.json` membership. */
async function fetchCollectionTitleMap(shop: string, token: string): Promise<Map<number, string>> {
  const titleById = new Map<number, string>();
  for (const resource of ['custom_collections', 'smart_collections'] as const) {
    let url: string | null = `/${resource}.json?limit=250`;
    while (url) {
      const res = await shopifyAdminFetch(shop, token, url);
      if (!res.ok) break;
      const body = (await res.json()) as Record<string, Array<{ id: number; title: string }>>;
      for (const c of body[resource] ?? []) titleById.set(c.id, c.title);
      url = nextPageUrl(res);
    }
  }
  return titleById;
}

async function fetchProductCollectionTitles(
  shop: string,
  token: string,
  productId: number,
  titleById: Map<number, string>,
): Promise<string[]> {
  const titles: string[] = [];
  let url: string | null = `/collects.json?product_id=${productId}&limit=250`;
  while (url) {
    const res = await shopifyAdminFetch(shop, token, url);
    if (!res.ok) break;
    const { collects } = (await res.json()) as { collects: Array<{ collection_id: number }> };
    for (const c of collects) {
      const title = titleById.get(c.collection_id);
      if (title) titles.push(title);
    }
    url = nextPageUrl(res);
  }
  return titles;
}

export async function syncOneTask(
  app: FastifyInstance,
  task: { storeId: string; mode: 'full' | 'product'; shopifyProductId?: number },
): Promise<void> {
  const [store] = await app.db
    .select()
    .from(schema.shopifyStores)
    .where(eq(schema.shopifyStores.id, task.storeId))
    .limit(1);
  if (!store || store.uninstalledAt) return;
  const { decryptToken } = await import('../../lib/crypto.js');
  const token = decryptToken(store.accessToken, app.env.SHOPIFY_TOKEN_ENC_KEY ?? '');
  const shop = store.shopDomain;

  if (task.mode === 'product' && task.shopifyProductId) {
    const res = await shopifyAdminFetch(shop, token, `/products/${task.shopifyProductId}.json`);
    if (res.ok) {
      const { product } = (await res.json()) as { product: ShopifyProduct };
      const titleById = await fetchCollectionTitleMap(shop, token);
      const collections = await fetchProductCollectionTitles(shop, token, product.id, titleById);
      await syncProduct(app, store.id, { ...product, collections });
      return;
    }
    // Previously a silent no-op here: no row, no log — a persistently-failing
    // product (deleted, wrong scope, deprecated REST resource) re-enqueued via
    // customer.routes.ts on every try-on attempt and never left a trace to
    // debug from. Record it the same way syncProduct's own try/catch does.
    app.log.warn(
      { storeId: store.id, productId: task.shopifyProductId, status: res.status },
      'shopify product fetch failed during sync',
    );
    await upsertGarmentFailure(
      app,
      store.id,
      task.shopifyProductId,
      `product fetch HTTP ${res.status}`,
    );
    return;
  }

  // full sync: paginate (250/page). Respect ~2 req/s. One extra collects.json
  // call per product (plus one-off collection title map) roughly doubles
  // outbound REST calls — each round-trip's own latency provides de-facto spacing.
  const titleById = await fetchCollectionTitleMap(shop, token);
  let url: string | null = `/products.json?limit=250`;
  while (url) {
    const res: Response = await shopifyAdminFetch(shop, token, url);
    if (!res.ok) {
      // Previously a silent `break` here: the whole catalog sync would stop
      // with zero rows written and zero log line — a bad/expired token made
      // "My Products" look permanently empty with no way to tell why. Throwing
      // lets sync-consumer.ts's existing catch log it as a failed task.
      throw new Error(`products.json fetch failed: HTTP ${res.status} (${url})`);
    }
    const { products } = (await res.json()) as { products: ShopifyProduct[] };
    for (const p of products) {
      const collections = await fetchProductCollectionTitles(shop, token, p.id, titleById);
      await syncProduct(app, store.id, { ...p, collections });
    }
    url = nextPageUrl(res);
    if (url) await new Promise((r) => setTimeout(r, 500)); // throttle
  }
}
