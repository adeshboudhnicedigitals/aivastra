import type { NextResponse } from 'next/server';

export function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  setCookieHeader: string | null,
): void {
  response.cookies.set('access_token', accessToken, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60,
    secure: process.env.NODE_ENV === 'production',
  });

  if (setCookieHeader) {
    const refreshMatch = setCookieHeader.match(/refresh=([^;]+)/);
    if (refreshMatch) {
      response.cookies.set('refresh', refreshMatch[1]!, {
        httpOnly: true,
        sameSite: 'lax',
        // Path '/' (not '/api/auth') so the browser sends it on protected-page
        // navigations too — lets middleware silently refresh before redirecting.
        path: '/',
        // 1h idle timeout: each refresh rotates the token with a fresh 1h
        // window (see tokens.ts), so an active user stays logged in but ~1h of
        // no requests lets both the access and refresh cookies lapse → logout.
        maxAge: 60 * 60,
        secure: process.env.NODE_ENV === 'production',
      });
    }
  }
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set('access_token', '', { maxAge: 0, path: '/' });
  response.cookies.set('refresh', '', { maxAge: 0, path: '/' });
  // Also clear the legacy '/api/auth'-scoped refresh cookie from older sessions.
  response.cookies.set('refresh', '', { maxAge: 0, path: '/api/auth' });
}
