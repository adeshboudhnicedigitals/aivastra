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
        path: '/api/auth',
        maxAge: 7 * 24 * 60 * 60,
        secure: process.env.NODE_ENV === 'production',
      });
    }
  }
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set('access_token', '', { maxAge: 0, path: '/' });
  response.cookies.set('refresh', '', { maxAge: 0, path: '/api/auth' });
}
