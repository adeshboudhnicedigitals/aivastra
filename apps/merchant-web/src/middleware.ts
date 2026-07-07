import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const ACCESS_COOKIE = 'merchant_access_token';
const REFRESH_COOKIE = 'merchant_refresh_token';
const ACCESS_MAX_AGE = 15 * 60;
const PUBLIC_PATHS = ['/login', '/signup'];

function setMerchantCookies(
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

function clearMerchantCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_COOKIE, '', { maxAge: 0, path: '/' });
  response.cookies.set(REFRESH_COOKIE, '', { maxAge: 0, path: '/' });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/merchant')) return NextResponse.next();

  if (pathname === '/') {
    const destination = request.cookies.get(ACCESS_COOKIE)?.value ? '/dashboard' : '/login';
    return NextResponse.redirect(new URL(destination, request.url));
  }

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (isPublic) return NextResponse.next();

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (accessToken) return NextResponse.next();

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      const res = await fetch(`${API_URL}/v1/merchant/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.ok) {
        const data = (await res.json()) as { accessToken?: string; refreshToken?: string | null };
        if (data.accessToken) {
          const response = NextResponse.next();
          setMerchantCookies(response, data.accessToken, data.refreshToken ?? refreshToken);
          return response;
        }
      }
    } catch {
      // fall through to redirect
    }
  }

  const response = NextResponse.redirect(new URL('/login', request.url));
  clearMerchantCookies(response);
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
