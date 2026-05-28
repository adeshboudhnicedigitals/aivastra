import { type NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Reconstruct the public origin from nginx forwarded headers, falling back to the internal URL origin. */
function getWebOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (proto && host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const webOrigin = getWebOrigin(req);
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    const url = new URL(`${BASE_PATH}/login`, webOrigin);
    url.searchParams.set('error', 'oauth_failed');
    return NextResponse.redirect(url);
  }

  let data: { accessToken?: string };
  let setCookieHeader: string | null = null;

  try {
    const res = await fetch(`${API_URL}/v1/auth/google/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      const url = new URL(`${BASE_PATH}/login`, webOrigin);
      url.searchParams.set('error', 'oauth_failed');
      return NextResponse.redirect(url);
    }

    data = (await res.json()) as { accessToken?: string };
    setCookieHeader = res.headers.get('set-cookie');
  } catch {
    const url = new URL(`${BASE_PATH}/login`, webOrigin);
    url.searchParams.set('error', 'oauth_failed');
    return NextResponse.redirect(url);
  }

  if (!data.accessToken) {
    const url = new URL(`${BASE_PATH}/login`, webOrigin);
    url.searchParams.set('error', 'oauth_failed');
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(new URL(`${BASE_PATH}/studio`, webOrigin));
  setAuthCookies(response, data.accessToken, setCookieHeader);
  return response;
}
