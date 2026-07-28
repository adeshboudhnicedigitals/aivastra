import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { decryptToken, encryptToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';

type Store = typeof schema.shopifyStores.$inferSelect;

/**
 * Refresh this far ahead of the stated expiry rather than at it. An access
 * token that passes the check and then expires mid-flight surfaces as a 401,
 * which we cannot distinguish from a revoked install — so buy enough margin to
 * cover clock skew between us and Shopify plus the request's own duration.
 */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Shopify's documented lifetimes, used only when a response omits them. */
const DEFAULT_TOKEN_TTL_S = 3600;
const DEFAULT_REFRESH_TTL_S = 90 * 24 * 3600;

/**
 * How long to hold the per-store refresh lock. Comfortably longer than a token
 * call, short enough that a crashed process cannot wedge a store for long.
 */
const REFRESH_LOCK_TTL_S = 30;
const REFRESH_LOCK_WAIT_MS = 250;
const REFRESH_LOCK_ATTEMPTS = 20;

export interface TokenGrant {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
}

/**
 * Normalize a Shopify token response into the columns we persist.
 *
 * Shopify only returns the refresh half when the grant is an expiring one. A
 * response with no `refresh_token` therefore means a perpetual token, which
 * must be stored with null expiries so getValidAccessToken leaves it alone
 * forever rather than trying to refresh something that has no refresh path.
 */
export function toTokenGrant(res: TokenResponse, now: Date = new Date()): TokenGrant {
  if (!res.refresh_token) {
    return {
      accessToken: res.access_token,
      refreshToken: null,
      expiresAt: null,
      refreshTokenExpiresAt: null,
    };
  }
  const ttl = res.expires_in ?? DEFAULT_TOKEN_TTL_S;
  // Read the refresh lifetime off the response rather than assuming 90 days —
  // Shopify has been observed returning materially shorter windows, and
  // treating a token as valid past its real expiry means a hard lockout.
  const refreshTtl = res.refresh_token_expires_in ?? DEFAULT_REFRESH_TTL_S;
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: new Date(now.getTime() + ttl * 1000),
    refreshTokenExpiresAt: new Date(now.getTime() + refreshTtl * 1000),
  };
}

/**
 * True when `store`'s access token should be refreshed before use.
 *
 * A null expiry means a legacy perpetual token: nothing to refresh, and no
 * refresh token to do it with, so it is always considered usable.
 */
export function needsRefresh(store: Store, now: Date = new Date()): boolean {
  if (!store.refreshToken || !store.tokenExpiresAt) return false;
  return store.tokenExpiresAt.getTime() - now.getTime() <= REFRESH_SKEW_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistGrant(app: FastifyInstance, storeId: string, grant: TokenGrant) {
  const encKey = app.env.SHOPIFY_TOKEN_ENC_KEY;
  if (!encKey) throw new AppError('CONFIG', 500, 'SHOPIFY_TOKEN_ENC_KEY missing');
  await app.db
    .update(schema.shopifyStores)
    .set({
      accessToken: encryptToken(grant.accessToken, encKey),
      refreshToken: grant.refreshToken ? encryptToken(grant.refreshToken, encKey) : null,
      tokenExpiresAt: grant.expiresAt,
      refreshTokenExpiresAt: grant.refreshTokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.shopifyStores.id, storeId));
}

/**
 * Exchange a refresh token for a fresh grant.
 *
 * Retries transient failures with the *same* refresh token on purpose. Shopify
 * rotates the refresh token server-side and invalidates the old one, but
 * returns the identical response to a repeat of the same request for an hour
 * afterwards. That window is what makes a retry safe: without it, a 5xx landing
 * between rotation and our receiving the reply would consume the only refresh
 * token we hold and lock the merchant out until they reinstalled.
 */
export async function refreshAccessToken(
  app: FastifyInstance,
  shopDomain: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenGrant> {
  const attempts = 3;
  let lastStatus = 0;

  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: app.env.SHOPIFY_API_KEY,
          client_secret: app.env.SHOPIFY_API_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });
    } catch (err) {
      // Network-level failure — we cannot know whether Shopify rotated. Retry
      // into the idempotency window rather than give up on the token.
      if (i === attempts - 1) throw err;
      await sleep(REFRESH_LOCK_WAIT_MS * (i + 1));
      continue;
    }

    if (res.ok) return toTokenGrant((await res.json()) as TokenResponse);

    lastStatus = res.status;
    // 4xx means the refresh token is genuinely dead (expired, already rotated
    // outside the window, app uninstalled). Retrying cannot help and only
    // delays telling the merchant to reauthorize.
    if (res.status < 500) break;
    if (i < attempts - 1) await sleep(REFRESH_LOCK_WAIT_MS * (i + 1));
  }

  app.log.error({ shopDomain, status: lastStatus }, 'shopify token refresh failed');
  throw new AppError(
    'SHOPIFY_REAUTH_REQUIRED',
    403,
    'This store needs to reauthorize AiVastra to grant updated permissions',
  );
}

/**
 * Decrypted access token for `store`, refreshed first if it is at or near
 * expiry.
 *
 * Call this instead of decrypting `store.accessToken` directly. Expiring
 * offline tokens live one hour, so anything that reads the column and uses it
 * later — a background sync especially — is holding a token that may already
 * be dead.
 *
 * Concurrency: refresh tokens are single-use, so parallel callers for one store
 * are serialized through a Redis lock and losers re-read the row rather than
 * refreshing again. Shopify's one-hour idempotency window means a lost race
 * would in practice return the same grant anyway; the lock is what keeps us
 * from leaning on that as the primary mechanism.
 */
export async function getValidAccessToken(app: FastifyInstance, store: Store): Promise<string> {
  const encKey = app.env.SHOPIFY_TOKEN_ENC_KEY;
  if (!encKey) throw new AppError('CONFIG', 500, 'SHOPIFY_TOKEN_ENC_KEY missing');

  if (!needsRefresh(store)) return decryptToken(store.accessToken, encKey);

  if (store.refreshTokenExpiresAt && store.refreshTokenExpiresAt.getTime() <= Date.now()) {
    // Past 90 days of no use the refresh token dies too, and only the merchant
    // reopening the app can mint a new grant.
    throw new AppError(
      'SHOPIFY_REAUTH_REQUIRED',
      403,
      'This store needs to reauthorize AiVastra to grant updated permissions',
    );
  }

  const lockKey = `shopify:token:refresh:${store.id}`;
  const held = await app.redis.set(lockKey, '1', 'EX', REFRESH_LOCK_TTL_S, 'NX');

  if (!held) {
    // Someone else is refreshing. Poll for the row they will write rather than
    // racing them for the single-use refresh token.
    for (let i = 0; i < REFRESH_LOCK_ATTEMPTS; i++) {
      await sleep(REFRESH_LOCK_WAIT_MS);
      const [fresh] = await app.db
        .select()
        .from(schema.shopifyStores)
        .where(eq(schema.shopifyStores.id, store.id))
        .limit(1);
      if (fresh && !needsRefresh(fresh)) return decryptToken(fresh.accessToken, encKey);
    }
    // Holder died before writing; its lock will lapse. Surfacing this beats
    // blocking the caller indefinitely or duplicating the refresh.
    throw new AppError('SHOPIFY', 503, 'Token refresh in progress, retry shortly');
  }

  try {
    // Re-read under the lock: a refresh may have completed between our
    // needsRefresh check and acquiring it, which would make ours a wasted
    // rotation using a now-stale refresh token.
    const [current] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, store.id))
      .limit(1);
    const row = current ?? store;
    if (!needsRefresh(row)) return decryptToken(row.accessToken, encKey);
    if (!row.refreshToken) return decryptToken(row.accessToken, encKey);

    const grant = await refreshAccessToken(
      app,
      row.shopDomain,
      decryptToken(row.refreshToken, encKey),
    );
    await persistGrant(app, row.id, grant);
    app.log.info({ storeId: row.id, expiresAt: grant.expiresAt }, 'shopify token refreshed');
    return grant.accessToken;
  } finally {
    await app.redis.del(lockKey).catch(() => {
      // Lock has a TTL; a failed release costs one stale window, not a deadlock.
    });
  }
}
