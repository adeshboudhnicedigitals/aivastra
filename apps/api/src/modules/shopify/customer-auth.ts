import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';
import { signAccess, verifyAccess } from '../auth/service.js';

const LINK_CODE_TTL_SECS = 60;
const ACCOUNT_TOKEN_AUDIENCE = 'shopify-widget';
const ACCOUNT_TOKEN_EXPIRY = '30d';

export async function mintAccountLinkCode(redis: Redis, userId: string): Promise<string> {
  const code = randomUUID();
  await redis.set(`shopify:link:${code}`, userId, 'EX', LINK_CODE_TTL_SECS);
  return code;
}

export async function resolveAccountLinkCode(redis: Redis, code: string): Promise<string | null> {
  const key = `shopify:link:${code}`;
  const userId = await redis.get(key);
  if (userId) await redis.del(key);
  return userId;
}

export async function signShopifyAccountToken(
  secret: Uint8Array,
  userId: string,
  storeId: string,
): Promise<string> {
  return signAccess(secret, userId, { storeId }, ACCOUNT_TOKEN_EXPIRY, ACCOUNT_TOKEN_AUDIENCE);
}

export async function verifyShopifyAccountToken(
  secret: Uint8Array,
  token: string,
  expectedStoreId: string,
): Promise<string> {
  let payload: Awaited<ReturnType<typeof verifyAccess>>;
  try {
    payload = await verifyAccess(secret, token);
  } catch {
    throw new AppError('UNAUTHORIZED', 401, 'Invalid or expired account token');
  }
  const aud = payload.aud;
  const isShopifyWidget = Array.isArray(aud)
    ? aud.includes(ACCOUNT_TOKEN_AUDIENCE)
    : aud === ACCOUNT_TOKEN_AUDIENCE;
  if (!isShopifyWidget || payload.storeId !== expectedStoreId) {
    throw new AppError('UNAUTHORIZED', 401, 'Account token not valid for this store');
  }
  return String(payload.sub);
}
