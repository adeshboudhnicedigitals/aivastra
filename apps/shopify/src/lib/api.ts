import { getIdToken } from './appBridge';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// In dev, Vite proxies /v1 to the local API (vite.config.ts) so a relative path
// works. In prod this SPA is served from admin.aivastra.com, which doesn't proxy
// /v1/* — the API is only reachable at app.aivastra.com, so requests there must
// be absolute + cross-origin (CORS-allowed, Bearer-token auth, no cookies).
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// Set once at app boot (see App.tsx) from /v1/shopify/me, so apiFetch can
// kick off a reauth redirect without every callsite threading it through.
let currentShopDomain: string | null = null;
export function setShopDomain(domain: string): void {
  currentShopDomain = domain;
}

async function parseErrorBody(res: Response): Promise<{ message: string; code?: string }> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (parsed.error?.message) return { message: parsed.error.message, code: parsed.error.code };
  } catch {
    // not JSON — fall through to raw text
  }
  return { message: text || res.statusText };
}

// The store's granted OAuth scope can fall behind what this app currently
// requires (e.g. after a scope bump ships) — Shopify then rejects our stored
// offline token. The backend surfaces that as SHOPIFY_REAUTH_REQUIRED so we
// can send the merchant through the existing one-click reauth flow instead of
// them (or us) having to notice and manually reinstall the app.
function handleReauthIfNeeded(code: string | undefined): void {
  if (code !== 'SHOPIFY_REAUTH_REQUIRED' || !currentShopDomain) return;
  const target = `${API_BASE}/v1/shopify/auth?shop=${encodeURIComponent(currentShopDomain)}`;
  // Shopify's OAuth consent page refuses to be framed — must break out of the
  // embedded admin iframe with a top-level navigation, not a fetch/redirect.
  (window.top ?? window).location.href = target;
}

// Plain fetch() has no built-in timeout — a stalled connection (dead tunnel,
// backend hang) would otherwise leave callers awaiting forever with no way to
// recover short of a full page reload.
const FETCH_TIMEOUT_MS = 12_000;
// A save can legitimately spend almost 30 seconds waiting for the per-store
// publication lock and then another 10 seconds on Shopify. Keep the ordinary
// request deadline short, but leave enough headroom for the route to return
// the committed widget plus `synced:false` instead of aborting in the SPA.
const WIDGET_CONFIG_PATCH_TIMEOUT_MS = 45_000;

function requestTimeoutMs(path: string, init: RequestInit): number {
  return path === '/v1/shopify/widget-config' && init.method?.toUpperCase() === 'PATCH'
    ? WIDGET_CONFIG_PATCH_TIMEOUT_MS
    : FETCH_TIMEOUT_MS;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out — check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Authenticated request returning the raw Response.
 *
 * Every callsite must go through this (or `apiFetch`, which wraps it) rather
 * than a bare `fetch` or an `<a href>`: it is the only place that applies the
 * absolute API base, the App Bridge bearer token, the 401 re-acquire retry and
 * the reauth redirect. Exported for responses that are not JSON — a CSV
 * download, for instance, needs the Blob, not a parsed body.
 */
export async function apiFetchResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const timeoutMs = requestTimeoutMs(path, init);
  const token = await getIdToken();
  const res = await fetchWithTimeout(
    url,
    {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    },
    timeoutMs,
  );

  if (res.status === 401) {
    // Session token may have expired between acquisition and use (~60s lifetime) — retry once with a fresh one.
    const freshToken = await getIdToken();
    const retryRes = await fetchWithTimeout(
      url,
      {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${freshToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      timeoutMs,
    );
    if (!retryRes.ok) {
      const { message, code } = await parseErrorBody(retryRes);
      handleReauthIfNeeded(code);
      throw new ApiError(retryRes.status, message, code);
    }
    return retryRes;
  }

  if (!res.ok) {
    const { message, code } = await parseErrorBody(res);
    handleReauthIfNeeded(code);
    throw new ApiError(res.status, message, code);
  }
  return res;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetchResponse(path, init);
  return res.json() as Promise<T>;
}
