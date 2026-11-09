import { type NextRequest, NextResponse } from 'next/server';
import { clearAuthCookies, setAuthCookies } from '@/lib/auth-cookies';
import { safeJson } from '@/lib/bff';
import type { OrgMe } from '@/lib/roles';
import { forwardedIpHeaders, readSetCookie, serverApiUrl } from '@/lib/server-api';

const NO_ACCESS = 'This account has no merchant access.';

export async function POST(req: NextRequest) {
  try {
    const API_URL = serverApiUrl();
    const body = await req.json();
    const res = await fetch(`${API_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardedIpHeaders(req) },
      body: JSON.stringify(body),
    });
    const [data, ok] = await safeJson(res);
    if (!ok) return NextResponse.json(data, { status: res.status });

    const accessToken = (data as { accessToken?: string }).accessToken ?? '';
    const meRes = await fetch(`${API_URL}/v1/merchant/org/me`, {
      headers: { Authorization: `Bearer ${accessToken}`, ...forwardedIpHeaders(req) },
    });
    if (meRes.status === 403) {
      // Generic on purpose: do not reveal which check (merchant / role / status) failed.
      const denied = NextResponse.json(
        { error: { code: 'FORBIDDEN', message: NO_ACCESS } },
        { status: 403 },
      );
      clearAuthCookies(denied);
      return denied;
    }
    const [meBody, meOk] = await safeJson(meRes);
    if (!meOk) {
      const failed = NextResponse.json(meBody, { status: meRes.status });
      clearAuthCookies(failed);
      return failed;
    }

    const response = NextResponse.json({ ok: true, accessToken, me: meBody as OrgMe });
    setAuthCookies(response, readSetCookie(res));
    return response;
  } catch (err) {
    console.error('login BFF route failed:', err);
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
