import { type NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const res = await fetch(`${API_URL}/v1/auth/verify-email?token=${encodeURIComponent(token)}`);

  const data = (await res.json()) as { accessToken?: string };
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  const response = NextResponse.json({ ok: true });
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookieStr = h.getSetCookie
    ? h.getSetCookie().join(', ') || null
    : res.headers.get('set-cookie');
  setAuthCookies(response, data.accessToken!, setCookieStr);
  return response;
}
