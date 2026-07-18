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

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const token = await getIdToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  if (res.status === 401) {
    // Session token may have expired between acquisition and use (~60s lifetime) — retry once with a fresh one.
    const freshToken = await getIdToken();
    const retryRes = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${freshToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!retryRes.ok) {
      const { message, code } = await parseErrorBody(retryRes);
      handleReauthIfNeeded(code);
      throw new ApiError(retryRes.status, message, code);
    }
    return retryRes.json() as Promise<T>;
  }

  if (!res.ok) {
    const { message, code } = await parseErrorBody(res);
    handleReauthIfNeeded(code);
    throw new ApiError(res.status, message, code);
  }
  return res.json() as Promise<T>;
}
