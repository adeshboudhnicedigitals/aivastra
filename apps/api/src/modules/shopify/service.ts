import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';

// Shopify Admin API version used by every outbound call in this module.
// Shopify retires versions ~1 year after release — bump this centrally,
// not per-callsite, so it never goes stale in only some places.
export const SHOPIFY_API_VERSION = '2026-07';

// Every direct call to Shopify's Admin API (REST or GraphQL) must go through
// this wrapper instead of a raw fetch(). A store's granted OAuth scope can
// fall behind app.env.SHOPIFY_SCOPES after we ship a scope bump — Shopify
// then rejects the stored offline token with a 401/403 that looks identical
// to "token is just broken". Centralizing the call here means every route
// gets the same SHOPIFY_REAUTH_REQUIRED signal instead of each callsite
// reinventing (or forgetting) that distinction.
//
// The fifth argument accepts either a bare fetch (legacy callers, mostly tests)
// or an options object. Passing `onUnauthorized` opts into one refresh-and-retry
// on a 401, which is the backstop for expiring offline tokens: getValidAccessToken
// refreshes ahead of expiry, but only this covers a token that lapses after the
// check and before the call.
export interface ShopifyAdminFetchOptions {
  fetchImpl?: typeof fetch;
  /**
   * Called once on a 401 to obtain a fresh access token, after which the
   * request is retried. Supply it wherever a store row is in hand — it is what
   * saves a caller holding a token across a long run, where the hour can lapse
   * between acquiring the token and this particular call going out.
   *
   * Only 401 triggers it. A 403 is an authorization verdict on a token Shopify
   * accepted, so a newer token of the same scope would be refused identically.
   */
  onUnauthorized?: () => Promise<string>;
}

export async function shopifyAdminFetch(
  shopDomain: string,
  accessToken: string,
  path: string,
  init: RequestInit = {},
  fetchImplOrOptions: typeof fetch | ShopifyAdminFetchOptions = {},
): Promise<Response> {
  const opts: ShopifyAdminFetchOptions =
    typeof fetchImplOrOptions === 'function'
      ? { fetchImpl: fetchImplOrOptions }
      : fetchImplOrOptions;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const url = path.startsWith('http')
    ? path
    : `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const send = (token: string) =>
    fetchImpl(url, {
      ...init,
      headers: { ...init.headers, 'X-Shopify-Access-Token': token },
    });

  let res = await send(accessToken);

  if (res.status === 401 && opts.onUnauthorized) {
    const refreshed = await opts.onUnauthorized();
    // Only retry on a genuinely different token. Re-sending the same one would
    // burn a second call to reach the identical 401.
    if (refreshed && refreshed !== accessToken) res = await send(refreshed);
  }

  if (res.status === 401 || res.status === 403) {
    throw new AppError(
      'SHOPIFY_REAUTH_REQUIRED',
      403,
      'This store needs to reauthorize AiVastra to grant updated permissions',
    );
  }
  return res;
}

function safeEq(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyWebhookHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(hmacHeader, 'base64');
  } catch {
    return false;
  }
  return safeEq(digest, provided);
}

export function verifyQueryHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const digest = createHmac('sha256', secret).update(msg).digest('hex');
  return safeEq(Buffer.from(digest, 'utf8'), Buffer.from(hmac, 'utf8'));
}

export function shopHostFromDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

interface SessionClaims {
  iss?: string;
  dest?: string;
  aud?: string;
  exp?: number;
  nbf?: number;
}

export function verifySessionToken(
  token: string,
  secret: string,
  apiKey: string,
): { dest: string; shopDomain: string } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed session token');
  const [headB64, bodyB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headB64, 'base64url').toString()) as { alg?: string };
  if (header.alg !== 'HS256') throw new Error('unexpected token alg'); // never accept `none`
  const expected = createHmac('sha256', secret).update(`${headB64}.${bodyB64}`).digest('base64url');
  if (!safeEq(Buffer.from(expected), Buffer.from(sigB64))) throw new Error('bad signature');

  const claims = JSON.parse(Buffer.from(bodyB64, 'base64url').toString()) as SessionClaims;
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < now) throw new Error('token expired');
  if (typeof claims.nbf === 'number' && claims.nbf > now + 5)
    throw new Error('token not yet valid');
  if (claims.aud !== apiKey) throw new Error('aud mismatch');
  if (!claims.dest || !claims.iss) throw new Error('missing dest/iss');
  if (shopHostFromDomain(claims.dest) !== shopHostFromDomain(claims.iss))
    throw new Error('iss/dest host mismatch');
  const shopDomain = shopHostFromDomain(claims.dest);
  return { dest: claims.dest, shopDomain };
}

export interface SyncTask {
  storeId: string;
  mode: 'full' | 'product' | 'collection';
  shopifyProductId?: number;
  shopifyCollectionId?: number;
}

export async function enqueueSync(redis: Redis, task: SyncTask): Promise<void> {
  await redis.xadd('shopify:sync', '*', 'task', JSON.stringify(task));
}
