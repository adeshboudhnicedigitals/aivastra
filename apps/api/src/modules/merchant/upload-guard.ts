import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

const MERCHANT_CATALOG_MAX_BYTES = 5 * 1024 * 1024;
const MERCHANT_CATALOG_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function assertMerchantUploadKey(
  app: FastifyInstance,
  merchantId: string,
  key: string,
  label: string,
) {
  if (!key.startsWith(`merchant-catalog/${merchantId}/`)) {
    throw new AppError('FORBIDDEN', 403, `${label} key does not belong to this merchant`);
  }

  const owner = await app.redis.get(`upload:owner:${key}`);
  if (owner !== merchantId) {
    throw new AppError('FORBIDDEN', 403, `${label} upload session expired or not owned`);
  }

  let head: { contentLength: number; contentType: string | null };
  try {
    head = await app.storage.headObject(key);
  } catch {
    throw new AppError('BAD_UPLOAD', 400, `${label} not found`);
  }

  if (head.contentLength > MERCHANT_CATALOG_MAX_BYTES) {
    throw new AppError('BAD_UPLOAD', 413, `${label} exceeds 5MB limit`);
  }
  if (!head.contentType || !MERCHANT_CATALOG_CONTENT_TYPES.has(head.contentType)) {
    throw new AppError('BAD_UPLOAD', 400, `${label} must be jpeg, png, or webp`);
  }
}
