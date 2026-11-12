import { type NextRequest, NextResponse } from 'next/server';
import { safeJson } from '@/lib/bff';
import { forwardedIpHeaders, serverApiUrl } from '@/lib/server-api';

// Public by design: the invite token in the body is the credential. Sets no session; the owner
// signs in with the new password afterwards.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${serverApiUrl()}/v1/auth/accept-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardedIpHeaders(req) },
      body: JSON.stringify({ token: body?.token, newPassword: body?.newPassword }),
    });
    const [data, ok] = await safeJson(res);
    return NextResponse.json(data, { status: ok ? 200 : res.status });
  } catch (err) {
    console.error('accept-invite BFF route failed:', err);
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
