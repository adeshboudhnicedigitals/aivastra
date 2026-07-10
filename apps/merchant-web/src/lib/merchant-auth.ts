import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { safeJson } from './bff';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const ACCESS_COOKIE = 'merchant_access_token';
const REFRESH_COOKIE = 'merchant_refresh_token';
const ACCESS_MAX_AGE = 15 * 60;

type RefreshPayload = {
  accessToken: string;
  refreshToken: string | null;
};

const refreshInFlight = new Map<string, Promise<RefreshPayload | null>>();

export function setMerchantCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken?: string | null,
): void {
  response.cookies.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });

  if (refreshToken !== undefined && refreshToken !== null) {
    response.cookies.set(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
  }
}

export function clearMerchantCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_COOKIE, '', { maxAge: 0, path: '/' });
  response.cookies.set(REFRESH_COOKIE, '', { maxAge: 0, path: '/' });
}

async function refreshMerchantTokens(refreshToken: string): Promise<RefreshPayload | null> {
  let inFlight = refreshInFlight.get(refreshToken);
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/merchant/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          cache: 'no-store',
        });
        if (!res.ok) return null;
        const [data, ok] = await safeJson(res);
        if (!ok) return null;
        const payload = data as Partial<RefreshPayload>;
        if (typeof payload.accessToken !== 'string') return null;
        return {
          accessToken: payload.accessToken,
          refreshToken:
            payload.refreshToken === null || typeof payload.refreshToken === 'string'
              ? payload.refreshToken
              : null,
        };
      } catch {
        return null;
      }
    })().finally(() => {
      refreshInFlight.delete(refreshToken);
    });
    refreshInFlight.set(refreshToken, inFlight);
  }
  return inFlight;
}

async function merchantApiFetch(
  path: string,
  accessToken: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  const options: RequestInit = {
    method: init.method ?? 'GET',
    headers,
    cache: 'no-store',
  };

  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(init.body);
  }

  return fetch(`${API_URL}${path}`, options);
}

export async function proxyMerchantJson(init: {
  path: string;
  method?: string;
  body?: unknown;
}): Promise<NextResponse> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value ?? null;
  const refreshToken = store.get(REFRESH_COOKIE)?.value ?? null;

  if (!accessToken && !refreshToken) {
    const response = NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    clearMerchantCookies(response);
    return response;
  }

  let responseFromApi = accessToken
    ? await merchantApiFetch(init.path, accessToken, init)
    : new Response(null, { status: 401 });
  let refreshed: RefreshPayload | null = null;

  if (responseFromApi.status === 401 && refreshToken) {
    refreshed = await refreshMerchantTokens(refreshToken);
    if (refreshed?.accessToken) {
      responseFromApi = await merchantApiFetch(init.path, refreshed.accessToken, init);
    }
  }

  const [data, ok] = await safeJson(responseFromApi);
  const response = NextResponse.json(data, {
    status: ok ? 200 : responseFromApi.status,
  });

  if (refreshed?.accessToken) {
    setMerchantCookies(response, refreshed.accessToken, refreshed.refreshToken ?? refreshToken);
  }

  if (responseFromApi.status === 401) {
    clearMerchantCookies(response);
  }

  return response;
}

export async function getMerchantAccessCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

export async function getMerchantRefreshCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}
