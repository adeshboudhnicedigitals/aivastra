import { type NextRequest, NextResponse } from 'next/server';
import { clearAuthCookies, setAuthCookies } from '@/lib/auth-cookies';
import { safeJson } from '@/lib/bff';
import { clearHqCookie, setHqCookie } from '@/lib/hq-cookies';
import type { OrgMe } from '@/lib/roles';
import { forwardedIpHeaders, readSetCookie, serverApiUrl } from '@/lib/server-api';

const NO_ACCESS = 'This account has no merchant access.';

// One login page for everyone. The credentials decide which API answers: AiVastra team first
// (/admin/auth/login), then retailer (/v1/auth/login). Each outcome gets its own session cookie
// and token, so a team session is never usable on retailer routes or the reverse. A failure from
// both returns the retailer API's error, so the response does not reveal whether an email is staff.
export async function POST(req: NextRequest) {
  try {
    const API_URL = serverApiUrl();
    const body = await req.json();
    const post = (path: string) =>
      fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...forwardedIpHeaders(req) },
        body: JSON.stringify(body),
      });

    const teamRes = await post('/admin/auth/login');
    if (teamRes.status === 429) {
      const [limited] = await safeJson(teamRes);
      return NextResponse.json(limited, { status: 429 });
    }
    if (teamRes.ok) {
      const [data] = await safeJson(teamRes);
      const accessToken = (data as { accessToken?: string }).accessToken ?? '';
      const meRes = await fetch(`${API_URL}/admin/me`, {
        headers: { Authorization: `Bearer ${accessToken}`, ...forwardedIpHeaders(req) },
      });
      const [me, meOk] = await safeJson(meRes);
      const permissions = (me as { permissions?: string[] }).permissions ?? [];
      // Staff whose role cannot see accounts fall through to the retailer check below.
      if (meOk && permissions.includes('accounts.read')) {
        const response = NextResponse.json({ ok: true, kind: 'console', accessToken, me });
        setHqCookie(response, readSetCookie(teamRes));
        clearAuthCookies(response);
        return response;
      }
    }

    const res = await post('/v1/auth/login');
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

    const response = NextResponse.json({
      ok: true,
      kind: 'merchant',
      accessToken,
      me: meBody as OrgMe,
    });
    setAuthCookies(response, readSetCookie(res));
    clearHqCookie(response);
    return response;
  } catch (err) {
    console.error('login BFF route failed:', err);
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
