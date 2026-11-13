import { type NextRequest, NextResponse } from 'next/server';
import { clearHqCookie, HQ_REFRESH_COOKIE } from '@/lib/hq-cookies';
import { forwardedIpHeaders, serverApiUrl } from '@/lib/server-api';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(HQ_REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await fetch(`${serverApiUrl()}/admin/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `refresh=${refreshToken}`, ...forwardedIpHeaders(req) },
    }).catch(() => {});
  }
  const response = NextResponse.json({ ok: true });
  clearHqCookie(response);
  return response;
}
