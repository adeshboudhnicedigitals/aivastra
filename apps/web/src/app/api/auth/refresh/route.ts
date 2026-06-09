import { type NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('refresh')?.value;
  if (!refreshToken) return NextResponse.json({ error: 'no refresh token' }, { status: 401 });

  const res = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `refresh=${refreshToken}` },
  });

  const data = (await res.json()) as { accessToken?: string };
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  const response = NextResponse.json({ accessToken: data.accessToken });
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookieStr = h.getSetCookie
    ? h.getSetCookie().join(', ') || null
    : res.headers.get('set-cookie');
  setAuthCookies(response, data.accessToken!, setCookieStr);
  return response;
}
