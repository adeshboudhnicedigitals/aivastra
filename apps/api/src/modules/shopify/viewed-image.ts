import type { schema } from '@aivastra/db';
import { keys } from '@aivastra/storage';
import type { FastifyInstance } from 'fastify';
import { fetchLiveProductImages } from './products.routes.js';
import { ensureGarmentImage } from './products.sync.js';

/** File name with Shopify's resize suffix removed (`shirt_600x.jpg` ->
 *  `shirt.jpg`). Storefronts serve `/cdn/shop/files/...` while the Admin API
 *  returns `cdn.shopify.com/s/files/...`, so the path differs between the two
 *  and only the file name is comparable. */
export function imageBasename(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, 'https://x.invalid').pathname;
  } catch {
    return null;
  }
  const name = pathname.split('/').pop()?.toLowerCase();
  if (!name) return null;
  return name.replace(
    /_(?:\d*x\d*(?:_crop_\w+)?|pico|icon|thumb|small|compact|medium|large|grande|master)(?:@\d+x)?(?=\.\w+$)/,
    '',
  );
}

/**
 * The garment key for the image the shopper was looking at, or null to keep the
 * product's normal garment.
 *
 * The URL comes from the browser and is only ever a hint: it is matched against
 * the product's own images read live from Shopify, and the download uses
 * Shopify's URL for the match, never the one that was sent. Null for anything
 * that does not match, is the image already in use, or fails to fetch, so a
 * hint can never make a try-on fail or pull in an image from outside the product.
 *
 * A merchant-picked override (r2Key differs from the synced default) wins: they
 * chose that garment on purpose.
 */
export async function resolveViewedGarmentKey(
  app: FastifyInstance,
  store: typeof schema.shopifyStores.$inferSelect,
  garment: { r2Key: string; imageUrl: string | null },
  productId: number,
  hintUrl: string,
): Promise<{ r2Key: string; imageId: number } | null> {
  if (garment.r2Key !== keys.shopifyProductGarment(store.id, productId)) return null;
  const wanted = imageBasename(hintUrl);
  if (!wanted) return null;
  if (garment.imageUrl && imageBasename(garment.imageUrl) === wanted) return null;
  try {
    const images = await fetchLiveProductImages(app, store, String(productId));
    const match = images.find((img) => imageBasename(img.src) === wanted);
    if (!match) return null;
    const r2Key = keys.shopifyProductGarmentViewed(store.id, productId, match.id);
    await ensureGarmentImage(app, { r2Key, imageUrl: match.src });
    return { r2Key, imageId: match.id };
  } catch (err) {
    app.log.warn({ err, storeId: store.id, productId }, 'viewed image unavailable, using default');
    return null;
  }
}
