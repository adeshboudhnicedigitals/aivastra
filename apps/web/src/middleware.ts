import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const PUBLIC_PATHS = ['/login', '/register', '/home'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Strip basePath prefix — Next.js passes full path (inc. basePath) to middleware
  const path =
    BASE_PATH && pathname.startsWith(BASE_PATH)
      ? pathname.slice(BASE_PATH.length) || '/'
      : pathname;

  if (path.startsWith('/api/auth')) return NextResponse.next();
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();
  if (path === '/') return NextResponse.next();

  const token = request.cookies.get('access_token')?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = `${BASE_PATH}/login`;
    url.searchParams.set('next', path); // path without basePath — router.push handles it
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
