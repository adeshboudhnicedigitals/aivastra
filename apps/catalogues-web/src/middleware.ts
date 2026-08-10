import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/home',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/kiosk-upload',
  '/tryon-library-app',
];
// Features not ready for real users — hidden from the sidebar (see sidebar.tsx
// devOnly) and blocked here so direct navigation can't reach them either.
const DEV_ONLY_PATHS: string[] = [];
// Features hidden in every environment (not just production) — still fully
// present in the codebase, just not reachable via nav or direct URL. See
// sidebar.tsx for the matching nav-item removal.
const ALWAYS_BLOCKED_PATHS: string[] = ['/sellio'];

// Gartex Expo Delhi campaign (docs/superpowers/specs/2026-08-01-gartex-expo-qr-campaign-design.md)
// — send /pricing traffic straight to signup with the already-configured
// gartex2026delhi campaign code instead of a page that requires login.
// Self-expiring: no follow-up deploy needed to remove it once the window
// closes. IST bounds, matching the expo's own timezone.
const GARTEX_REDIRECT_START = new Date('2026-08-05T00:00:00+05:30');
const GARTEX_REDIRECT_END = new Date('2026-08-09T23:59:59+05:30');

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Next.js strips basePath before middleware receives pathname.
  // Strip manually too in case it doesn't (varies by version/config).
  const path =
    BASE_PATH && pathname.startsWith(BASE_PATH)
      ? pathname.slice(BASE_PATH.length) || '/'
      : pathname;

  if (path.startsWith('/api/auth')) return NextResponse.next();
  if (path.startsWith('/api/catalog-app')) return NextResponse.next();

  if (
    process.env.NODE_ENV === 'production' &&
    DEV_ONLY_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
  ) {
    return NextResponse.redirect(new URL(`${BASE_PATH}/studio`, request.url));
  }

  if (ALWAYS_BLOCKED_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.redirect(new URL(`${BASE_PATH}/studio`, request.url));
  }

  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();
  if (path === '/') return NextResponse.next();

  const token = request.cookies.get('access_token')?.value;

  if (token) return NextResponse.next();

  // Access token expired/missing. Before bouncing to login, try a silent
  // refresh using the (httpOnly, 1-hour) refresh cookie. This is what stops the
  // "logged out on reload/navigation after 15 min" problem — middleware runs on
  // server navigations where the client-side 401→refresh path never fires.
  const refresh = request.cookies.get('refresh')?.value;
  if (refresh) {
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { Cookie: `refresh=${refresh}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { accessToken?: string };
        if (data.accessToken) {
          // Edge Runtime treats 'set-cookie' as a forbidden response-header name,
          // so res.headers.get('set-cookie') returns null there. Use getSetCookie()
          // (WinterCG / Node 20 API) which bypasses the restriction, falling back
          // to get() for environments that do expose it via the standard path.
          const h = res.headers as Headers & { getSetCookie?: () => string[] };
          const setCookieStr = h.getSetCookie
            ? h.getSetCookie().join(', ') || null
            : res.headers.get('set-cookie');

          const response = NextResponse.next();
          setAuthCookies(response, data.accessToken, setCookieStr);
          return response;
        }
      }
    } catch {
      // fall through to login/gartex redirect below
    }
  }

  // Real auth resolution (token, then refresh) has failed at this point --
  // this visitor is genuinely anonymous, not just carrying a stale cookie
  // from an earlier session. Gartex Expo Delhi campaign
  // (docs/superpowers/specs/2026-08-01-gartex-expo-qr-campaign-design.md):
  // send /pricing traffic straight to signup with the already-configured
  // gartex2026delhi campaign code instead of a login wall. Self-expiring --
  // no follow-up deploy needed once the window closes.
  const now = new Date();
  if (path === '/pricing' && now >= GARTEX_REDIRECT_START && now <= GARTEX_REDIRECT_END) {
    const url = new URL(`${BASE_PATH}/register`, request.url);
    url.searchParams.set('src', 'gartex2026delhi');
    return NextResponse.redirect(url);
  }

  // Use absolute URL to avoid Next.js basePath double-prefix issues
  const loginUrl = new URL(`${BASE_PATH}/login`, request.url);
  loginUrl.searchParams.set('next', path); // path without basePath; router.push handles it
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
