import { type NextRequest, NextResponse } from 'next/server';
import { clearAuthCookies, REFRESH_COOKIE } from '@/lib/auth-cookies';
import { serverApiUrl } from '@/lib/server-api';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await fetch(`${serverApiUrl()}/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `refresh=${refreshToken}` },
    }).catch(() => {});
  }
  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
}
