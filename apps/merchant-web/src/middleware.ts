import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { buildCsp } from '@/lib/csp';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const PUBLIC_PATHS = ['/login', '/set-password', '/api/auth'];

export function middleware(request: NextRequest) {
  // Fresh per-request nonce (CSP). Passed to the app as an `x-nonce` request
  // header so the root layout can read it; Next stamps its own scripts with it.
  // btoa/crypto are Web APIs — middleware runs in the Edge runtime.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const withCsp = (response: NextResponse): NextResponse => {
    response.headers.set('Content-Security-Policy', csp);
    return response;
  };

  const { pathname } = request.nextUrl;
  const path =
    BASE_PATH && pathname.startsWith(BASE_PATH)
      ? pathname.slice(BASE_PATH.length) || '/'
      : pathname;

  // The team console has its own session cookie and never accepts the retailer one (spec §8).
  if (path === '/hq' || path.startsWith('/hq/')) {
    const open = path === '/hq/login' || path.startsWith('/hq/api/auth');
    if (open || request.cookies.get('hq_refresh')?.value) {
      return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
    }
    return withCsp(NextResponse.redirect(new URL(`${BASE_PATH}/hq/login`, request.url)));
  }

  if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // The access token is memory-only, so the httpOnly refresh cookie is the only
  // server-visible signal of a session; the API still validates every call.
  if (request.cookies.get('mw_refresh')?.value) {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  return withCsp(NextResponse.redirect(new URL(`${BASE_PATH}/login`, request.url)));
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
