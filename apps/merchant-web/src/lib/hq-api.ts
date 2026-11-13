import { getApiUrl } from './api';
import { ApiError, networkError, readResponseBody, responseError } from './errors';

// The console's own API client. Separate from lib/api.ts on purpose: a different in-memory
// token, a different refresh endpoint (/hq/api/auth), and it only ever talks to /admin/*. A
// console token must never ride a retailer request, nor the other way round.

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
let memToken: string | null = null;

export function initHqToken(token: string | null): void {
  memToken = token;
}

let inFlight: Promise<string | null> | null = null;
function refresh(): Promise<string | null> {
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/hq/api/auth/refresh`, { method: 'POST' });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken?: string };
        memToken = data.accessToken ?? null;
        return memToken;
      } catch {
        return null;
      }
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body != null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    // No cookies: the console API call is bearer-only.
    return await fetch(`${getApiUrl()}${path}`, { ...init, headers });
  } catch (err) {
    throw networkError(err);
  }
}

export async function hqFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = memToken ?? (await refresh());
  let res = await send(path, init, token);
  if (res.status === 401) {
    token = await refresh();
    if (!token) {
      if (typeof window !== 'undefined') window.location.href = `${BASE}/login`;
      throw new ApiError(401, {
        error: { code: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' },
      });
    }
    res = await send(path, init, token);
  }
  if (!res.ok) throw await responseError(res);
  return (await readResponseBody(res)) as T;
}

export async function hqSignOut(): Promise<void> {
  memToken = null;
  try {
    await fetch(`${BASE}/hq/api/auth/logout`, { method: 'POST' });
  } catch {
    // The cookie expires on its own.
  }
}
