import { type NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as { accessToken?: string };
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, data.accessToken!, res.headers.get('set-cookie'));
  return response;
}
