import { ApiError, networkError, readResponseBody, responseError } from './errors';

export function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Access token lives only in module memory, never in a JS-readable cookie.
// After a reload it is empty; the first call refreshes it from the httpOnly cookie.
let memToken: string | null = null;

export function initToken(token: string): void {
  memToken = token;
}

export function getToken(): string | null {
  return memToken;
}

// Single-flight: concurrent 401s share one refresh, otherwise each would spend
// the same single-use refresh token and the losers would be logged out.
let refreshInFlight: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST' });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: string };
    if (!data.accessToken) return null;
    memToken = data.accessToken;
    return data.accessToken;
  } catch {
    return null;
  }
}

export function tryRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

let forbiddenHandler: (() => void) | null = null;
/** The session provider registers here so any 403 FORBIDDEN signs the user out. */
export function setForbiddenHandler(fn: (() => void) | null): void {
  forbiddenHandler = fn;
}

async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body != null && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(`${getApiUrl()}${path}`, { ...init, headers, credentials: 'include' });
  } catch (err) {
    throw networkError(err);
  }
}

const ORG_ME_PATH = '/v1/merchant/org/me';

async function accountRejected(token: string | null): Promise<boolean> {
  try {
    return (await send(ORG_ME_PATH, {}, token)).status === 403;
  } catch {
    return false;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  // No token yet (fresh page load): refresh first rather than burn a guaranteed 401.
  let token = memToken ?? (await tryRefresh());
  let res = await send(path, init, token);

  if (res.status === 401) {
    token = await tryRefresh();
    if (!token) {
      if (typeof window !== 'undefined') window.location.href = `${BASE}/login`;
      throw new ApiError(401, {
        error: { code: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' },
      });
    }
    res = await send(path, init, token);
  }

  if (!res.ok) {
    const err = await responseError(res);
    if (err.status === 403 && err.code === 'FORBIDDEN') {
      // FORBIDDEN is also an ordinary denial (e.g. staff hitting an admin action),
      // so only sign out when the account itself is rejected: the org/me re-check
      // is 403 too. The re-check goes through send(), not apiFetch(), so its own
      // 403 cannot re-enter this branch.
      if (path === ORG_ME_PATH || (await accountRejected(token))) forbiddenHandler?.();
    }
    throw err;
  }
  return (await readResponseBody(res)) as T;
}

/** Authenticated file download (CSV export): the bearer token cannot ride a plain link. */
export async function apiDownload(path: string): Promise<Blob> {
  let token = memToken ?? (await tryRefresh());
  let res = await send(path, {}, token);
  if (res.status === 401) {
    token = await tryRefresh();
    if (!token)
      throw new ApiError(401, {
        error: { code: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.' },
      });
    res = await send(path, {}, token);
  }
  if (!res.ok) throw await responseError(res);
  return res.blob();
}

export async function signOut(): Promise<void> {
  memToken = null;
  try {
    await fetch(`${BASE}/api/auth/logout`, { method: 'POST' });
  } catch {
    // Cookie clearing is best-effort; the redirect below still ends the UI session.
  }
  if (typeof window !== 'undefined') window.location.href = `${BASE}/login`;
}
