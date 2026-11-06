import { keys } from '@aivastra/storage';
import type { FastifyInstance } from 'fastify';

/** Thumbnails point at Shopify's CDN (resized there) instead of a stored copy:
 *  sync no longer stores images. A merchant-picked override has no Shopify URL,
 *  and a row from before image_url existed may have none yet, so those fall back
 *  to the stored object. */
export async function thumbnailFor(
  app: FastifyInstance,
  storeId: string,
  row: { shopifyProductId: number; r2Key: string; imageUrl: string | null },
): Promise<string> {
  const isOverride = row.r2Key !== keys.shopifyProductGarment(storeId, row.shopifyProductId);
  if (row.imageUrl && !isOverride) {
    const u = new URL(row.imageUrl);
    u.searchParams.set('width', '200');
    return u.toString();
  }
  return (await app.storage.presignGet(row.r2Key, 3600)).url;
}
