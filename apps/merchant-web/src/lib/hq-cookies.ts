import type { NextResponse } from 'next/server';

// The AiVastra team console keeps its own session, apart from the retailer one (console spec §8):
// a different cookie NAME and a PATH of /hq, so the browser never sends it to a merchant page or
// BFF route, and the retailer cookie is never sent to the console. The console BFF lives under
// /hq/api for exactly that reason (a cookie has one path).
export const HQ_REFRESH_COOKIE = 'hq_refresh';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const PATH = `${BASE}/hq`;

export function setHqCookie(response: NextResponse, setCookieHeader: string | null): void {
  if (!setCookieHeader) return;
  // The API names its cookie `refresh`; this app stores it as `hq_refresh`.
  const m = setCookieHeader.match(/(?:^|[\s,;])refresh=([^;]+)/);
  if (!m?.[1]) return;
  response.cookies.set(HQ_REFRESH_COOKIE, m[1], {
    httpOnly: true,
    sameSite: 'lax',
    path: PATH,
    // Shorter than a retailer session: this one can mint credits.
    maxAge: 24 * 60 * 60,
    secure: process.env.NODE_ENV === 'production',
  });
}

export function clearHqCookie(response: NextResponse): void {
  response.cookies.set(HQ_REFRESH_COOKIE, '', { maxAge: 0, path: PATH });
}
