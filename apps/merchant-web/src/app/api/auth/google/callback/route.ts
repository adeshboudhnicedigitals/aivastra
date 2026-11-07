import { type NextRequest, NextResponse } from 'next/server';
import { clearAuthCookies, setAuthCookies } from '@/lib/auth-cookies';
import { forwardedIpHeaders, readSetCookie, serverApiUrl } from '@/lib/server-api';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Public origin from the proxy's forwarded headers, falling back to the internal URL. */
function publicOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (proto && host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

// The API's Google callback lands here with a one-time code (see google.routes.ts). Exchange
// it server-side, set the mw_refresh cookie and open the app; the access token is then
// obtained by the normal refresh path, so it never travels in a URL.
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const fail = (reason: string) => {
    const url = new URL(`${BASE_PATH}/login`, origin);
    url.searchParams.set('error', reason);
    const res = NextResponse.redirect(url);
    clearAuthCookies(res);
    return res;
  };

  const code = req.nextUrl.searchParams.get('code');
  if (!code) return fail('oauth_failed');

  try {
    const res = await fetch(`${serverApiUrl()}/v1/auth/google/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardedIpHeaders(req) },
      body: JSON.stringify({ code, portal: 'merchant' }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      return fail(body?.error?.code === 'NOT_A_MERCHANT' ? 'not_a_merchant' : 'oauth_failed');
    }
    const response = NextResponse.redirect(new URL(`${BASE_PATH}/`, origin));
    setAuthCookies(response, readSetCookie(res));
    return response;
  } catch {
    return fail('oauth_failed');
  }
}
