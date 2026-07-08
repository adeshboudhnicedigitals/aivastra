import { schema } from '@aivastra/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { SHOPIFY_API_VERSION } from './service.js';

interface ShopifyProduct {
  id: number;
  title: string;
  image?: { src?: string } | null;
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
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
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
  failedReason?: string,
) {
  await app.db
    .insert(schema.shopifyProductGarments)
    .values({
      storeId,
      shopifyProductId: productId,
      shopifyVariantId: NO_VARIANT_SENTINEL,
      r2Key,
      title,
      status,
      failedReason,
    })
    .onConflictDoUpdate({
      target: [
        schema.shopifyProductGarments.storeId,
        schema.shopifyProductGarments.shopifyProductId,
        schema.shopifyProductGarments.shopifyVariantId,
      ],
      set: { r2Key, title, status, failedReason: failedReason ?? null, syncedAt: sql`now()` },
    });
}

export async function syncProduct(
  app: FastifyInstance,
  storeId: string,
  product: ShopifyProduct,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<void> {
  const r2Key = `shopify-garments/${storeId}/${product.id}/garment.jpg`;
  const src = product.image?.src;
  if (!src) {
    await upsertGarment(
      app,
      storeId,
      product.id,
      r2Key,
      product.title,
      'failed',
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
      // redirect: 'error' stops assertShopifyCdn's host allowlist from being bypassed by
      // a redirect (e.g. 302 from an allowed host to an arbitrary/internal host) — fetch
      // throws instead of following it, which the outer catch below already handles.
      res = await fetchFn(src, { redirect: 'error', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
      throw new Error('product image exceeds 10MB');
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('product image exceeds 10MB');
    }
    const buf = Buffer.from(arrayBuffer);
    const ct = res.headers.get('content-type') ?? 'image/jpeg';
    await app.storage.putObject(r2Key, buf, ct);
    await upsertGarment(app, storeId, product.id, r2Key, product.title, 'active');
  } catch (err) {
    app.log.warn({ err, storeId, productId: product.id }, 'product sync failed');
    await upsertGarment(
      app,
      storeId,
      product.id,
      r2Key,
      product.title,
      'failed',
      (err as Error).message,
    );
  }
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
    const res = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products/${task.shopifyProductId}.json`,
      {
        headers: { 'X-Shopify-Access-Token': token },
      },
    );
    if (res.ok) {
      const { product } = (await res.json()) as { product: ShopifyProduct };
      await syncProduct(app, store.id, product);
    }
    return;
  }

  // full sync: paginate (250/page). Respect ~2 req/s.
  let url: string | null =
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250`;
  while (url) {
    const res: Response = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    if (!res.ok) break;
    const { products } = (await res.json()) as { products: ShopifyProduct[] };
    for (const p of products) await syncProduct(app, store.id, p);
    const link = res.headers.get('link') ?? '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    if (url) await new Promise((r) => setTimeout(r, 500)); // throttle
  }
}
