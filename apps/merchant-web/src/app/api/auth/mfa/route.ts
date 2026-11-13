import { type NextRequest, NextResponse } from 'next/server';
import { safeJson } from '@/lib/bff';
import { setHqCookie } from '@/lib/hq-cookies';
import { forwardedIpHeaders, readSetCookie, serverApiUrl } from '@/lib/server-api';

// The second step of a team sign-in. The body names one of three fixed actions, so this is not
// an open proxy: each maps to one API path and passes only the fields that path takes.
const PATHS = {
  verify: '/admin/auth/mfa/verify',
  'enroll-start': '/admin/auth/mfa/enroll/start',
  'enroll-confirm': '/admin/auth/mfa/enroll/confirm',
} as const;

export async function POST(req: NextRequest) {
  try {
    const API_URL = serverApiUrl();
    const { action, mfaToken, code, recoveryCode } = await req.json();
    const path = PATHS[action as keyof typeof PATHS];
    if (!path) return NextResponse.json({ error: { message: 'Unknown step' } }, { status: 400 });

    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardedIpHeaders(req) },
      body: JSON.stringify({ mfaToken, code, recoveryCode }),
    });
    const [data, ok] = await safeJson(res);
    if (!ok) return NextResponse.json(data, { status: res.status });
    if (action === 'enroll-start') return NextResponse.json(data);

    const { accessToken = '', recoveryCodes } = data as {
      accessToken?: string;
      recoveryCodes?: string[];
    };
    // Same console gate as a password-only login: the role must be able to see accounts.
    const meRes = await fetch(`${API_URL}/admin/me`, {
      headers: { Authorization: `Bearer ${accessToken}`, ...forwardedIpHeaders(req) },
    });
    const [me, meOk] = await safeJson(meRes);
    const permissions = (me as { permissions?: string[] }).permissions ?? [];
    if (!meOk || !permissions.includes('accounts.read')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'This account has no console access.' } },
        { status: 403 },
      );
    }
    const response = NextResponse.json({ ok: true, kind: 'console', accessToken, recoveryCodes });
    setHqCookie(response, readSetCookie(res));
    return response;
  } catch (err) {
    console.error('mfa BFF route failed:', err);
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
