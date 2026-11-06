import { type NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE, setAuthCookies } from '@/lib/auth-cookies';
import { safeJson } from '@/lib/bff';
import { readSetCookie, serverApiUrl } from '@/lib/server-api';

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) return NextResponse.json({ error: 'no refresh token' }, { status: 401 });

    const res = await fetch(`${serverApiUrl()}/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh=${refreshToken}` },
    });
    const [data, ok] = await safeJson(res);
    if (!ok) return NextResponse.json(data, { status: res.status });

    const response = NextResponse.json({
      accessToken: (data as { accessToken?: string }).accessToken,
    });
    setAuthCookies(response, readSetCookie(res));
    return response;
  } catch (err) {
    console.error('refresh BFF route failed:', err);
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
