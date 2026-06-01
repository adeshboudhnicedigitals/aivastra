import { type NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const res = await fetch(`${API_URL}/v1/auth/verify-email?token=${encodeURIComponent(token)}`);

  const data = (await res.json()) as { accessToken?: string };
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, data.accessToken!, res.headers.get('set-cookie'));
  return response;
}
