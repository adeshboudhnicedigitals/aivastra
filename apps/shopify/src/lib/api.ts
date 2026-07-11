import { getIdToken } from './appBridge';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// In dev, Vite proxies /v1 to the local API (vite.config.ts) so a relative path
// works. In prod this SPA is served from admin.aivastra.com, which doesn't proxy
// /v1/* — the API is only reachable at app.aivastra.com, so requests there must
// be absolute + cross-origin (CORS-allowed, Bearer-token auth, no cookies).
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

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
      const body = await retryRes.text();
      throw new ApiError(retryRes.status, body || retryRes.statusText);
    }
    return retryRes.json() as Promise<T>;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body || res.statusText);
  }
  return res.json() as Promise<T>;
}
