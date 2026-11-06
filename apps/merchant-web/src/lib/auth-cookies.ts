import type { NextResponse } from 'next/server';

export const REFRESH_COOKIE = 'mw_refresh';

export function setAuthCookies(response: NextResponse, setCookieHeader: string | null): void {
  // The access token lives only in JS module memory (see api.ts), never a cookie,
  // so XSS cannot steal a long-lived bearer token.
  if (!setCookieHeader) return;
  // The API names its cookie `refresh`; this app stores it as `mw_refresh`.
  const m = setCookieHeader.match(/(?:^|[\s,;])refresh=([^;]+)/);
  if (!m?.[1]) return;
  response.cookies.set(REFRESH_COOKIE, m[1], {
    httpOnly: true,
    sameSite: 'lax',
    // Path '/' so middleware sees it on page navigations.
    path: '/',
    // Matches REFRESH_TOKEN_EXPIRY in the API; each refresh rotates a fresh window.
    maxAge: 7 * 24 * 60 * 60,
    secure: process.env.NODE_ENV === 'production',
  });
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(REFRESH_COOKIE, '', { maxAge: 0, path: '/' });
  response.cookies.set('access_token', '', { maxAge: 0, path: '/' });
}
