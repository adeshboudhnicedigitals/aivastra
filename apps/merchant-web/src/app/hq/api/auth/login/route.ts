import { type NextRequest, NextResponse } from 'next/server';
import { safeJson } from '@/lib/bff';
import { clearHqCookie, setHqCookie } from '@/lib/hq-cookies';
import { forwardedIpHeaders, readSetCookie, serverApiUrl } from '@/lib/server-api';

export async function POST(req: NextRequest) {
  try {
    const API_URL = serverApiUrl();
    const body = await req.json();
    const res = await fetch(`${API_URL}/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardedIpHeaders(req) },
      body: JSON.stringify(body),
    });
    const [data, ok] = await safeJson(res);
    if (!ok) return NextResponse.json(data, { status: res.status });

    const accessToken = (data as { accessToken?: string }).accessToken ?? '';
    // The console is only for roles that can see accounts: check before keeping the session.
    const meRes = await fetch(`${API_URL}/admin/me`, {
      headers: { Authorization: `Bearer ${accessToken}`, ...forwardedIpHeaders(req) },
    });
    const [me, meOk] = await safeJson(meRes);
    const permissions = (me as { permissions?: string[] }).permissions ?? [];
    if (!meOk || !permissions.includes('accounts.read')) {
      const denied = NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'This account has no console access.' } },
        { status: 403 },
      );
      clearHqCookie(denied);
      return denied;
    }
    const response = NextResponse.json({ ok: true, accessToken, me });
    setHqCookie(response, readSetCookie(res));
    return response;
  } catch (err) {
    console.error('hq login BFF route failed:', err);
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
