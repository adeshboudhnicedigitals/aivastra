import { type NextRequest, NextResponse } from 'next/server';
import { safeJson } from '@/lib/bff';
import { clearHqCookie, HQ_REFRESH_COOKIE, setHqCookie } from '@/lib/hq-cookies';
import { forwardedIpHeaders, readSetCookie, serverApiUrl } from '@/lib/server-api';

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get(HQ_REFRESH_COOKIE)?.value;
    if (!refreshToken) return NextResponse.json({ error: 'no refresh token' }, { status: 401 });
    const res = await fetch(`${serverApiUrl()}/admin/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh=${refreshToken}`, ...forwardedIpHeaders(req) },
    });
    const [data, ok] = await safeJson(res);
    if (!ok) {
      const failed = NextResponse.json(data, { status: res.status });
      if (res.status === 401) clearHqCookie(failed);
      return failed;
    }
    const response = NextResponse.json({
      accessToken: (data as { accessToken?: string }).accessToken,
    });
    setHqCookie(response, readSetCookie(res));
    return response;
  } catch (err) {
    console.error('hq refresh BFF route failed:', err);
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
