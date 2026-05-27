import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const PUBLIC_PATHS = ['/login', '/register', '/home'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Next.js strips basePath before middleware receives pathname.
  // Strip manually too in case it doesn't (varies by version/config).
  const path =
    BASE_PATH && pathname.startsWith(BASE_PATH)
      ? pathname.slice(BASE_PATH.length) || '/'
      : pathname;

  if (path.startsWith('/api/auth')) return NextResponse.next();
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();
  if (path === '/') return NextResponse.next();

  // Redirect old route names to new structure
  const REDIRECTS: Record<string, string> = {
    '/tryon': '/studio',
    '/dashboard': '/catalogues',
    '/jobs': '/catalogues',
    '/credits': '/pricing',
    '/account': '/settings',
  };
  for (const [from, to] of Object.entries(REDIRECTS)) {
    if (path === from || path.startsWith(`${from}/`)) {
      return NextResponse.redirect(new URL(`${BASE_PATH}${to}`, request.url));
    }
  }

  const token = request.cookies.get('access_token')?.value;
  if (!token) {
    // Use absolute URL to avoid Next.js basePath double-prefix issues
    const loginUrl = new URL(`${BASE_PATH}/login`, request.url);
    loginUrl.searchParams.set('next', path); // path without basePath; router.push handles it
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)'],
};
