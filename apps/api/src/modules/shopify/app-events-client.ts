import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { EVENT_HANDLE } from './payg.js';

const TOKEN_URL = 'https://api.shopify.com/auth/access_token';
const EVENTS_URL = 'https://api.shopify.com/app/unstable/events';
const REDIS_TOKEN_KEY = 'shopify:app-events:token';
// Refresh 5 minutes before Shopify's real 60-minute expiry so a token is
// never used past the point Shopify would reject it.
const REFRESH_MARGIN_SECONDS = 300;

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

async function defaultFetchToken(app: FastifyInstance): Promise<TokenResponse> {
  const clientId = app.env.SHOPIFY_APP_EVENTS_CLIENT_ID;
  const clientSecret = app.env.SHOPIFY_APP_EVENTS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new AppError('SHOPIFY', 500, 'App Events client credentials are not configured');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    throw new AppError('SHOPIFY', 502, `App Events token request failed: HTTP ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

interface GetTokenDeps {
  fetchToken?: (app: FastifyInstance) => Promise<TokenResponse>;
}

/**
 * App-level JWT for the App Events API — one shared token for the whole app,
 * unlike every other Shopify integration point here (which uses a per-store
 * offline token). Cached in Redis so concurrent callers across requests share
 * one token instead of each fetching their own.
 */
export async function getAppEventsToken(
  app: FastifyInstance,
  deps: GetTokenDeps = {},
): Promise<string> {
  const cached = await app.redis.get(REDIS_TOKEN_KEY);
  if (cached) return cached;

  const fetchToken = deps.fetchToken ?? defaultFetchToken;
  const { access_token, expires_in } = await fetchToken(app);
  const ttl = Math.max(60, expires_in - REFRESH_MARGIN_SECONDS);
  await app.redis.set(REDIS_TOKEN_KEY, access_token, 'EX', ttl);
  return access_token;
}

interface PostEventResult {
  ok: boolean;
  status: number;
}

async function defaultPostEvent(
  token: string,
  body: {
    shop_id: string;
    event_handle: string;
    timestamp: string;
    idempotency_key: string;
    attributes: { value: number };
  },
): Promise<PostEventResult> {
  const res = await fetch(EVENTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status };
}

interface ReportUsageEventDeps {
  getToken?: (app: FastifyInstance) => Promise<string>;
  postEvent?: typeof defaultPostEvent;
}

/**
 * Reports one try-on as usage. A 202 here means "Shopify accepted the
 * request", never "Shopify billed it" — the App Events API has no
 * synchronous billing-validation error. Confirming an event was actually
 * billed is what the reconciliation check in billing.ts is for.
 */
export async function reportUsageEvent(
  app: FastifyInstance,
  params: { shopifyShopId: number; jobId: string },
  deps: ReportUsageEventDeps = {},
): Promise<'reported' | 'failed'> {
  const getToken = deps.getToken ?? getAppEventsToken;
  const postEvent = deps.postEvent ?? defaultPostEvent;

  const token = await getToken(app);
  const result = await postEvent(token, {
    shop_id: `gid://shopify/Shop/${params.shopifyShopId}`,
    event_handle: EVENT_HANDLE,
    timestamp: new Date().toISOString(),
    idempotency_key: `usage:${params.jobId}`,
    attributes: { value: 1 },
  });
  return result.ok ? 'reported' : 'failed';
}
