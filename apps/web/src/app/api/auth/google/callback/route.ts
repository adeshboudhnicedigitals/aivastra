import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookies } from '@/lib/auth-cookies';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    const url = new URL(`${BASE_PATH}/login`, req.url);
    url.searchParams.set('error', 'oauth_failed');
    return NextResponse.redirect(url);
  }

  let data: { accessToken?: string };
  let setCookieHeader: string | null = null;

  try {
    const res = await fetch(`${API_URL}/v1/auth/google/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      const url = new URL(`${BASE_PATH}/login`, req.url);
      url.searchParams.set('error', 'oauth_failed');
      return NextResponse.redirect(url);
    }

    data = await res.json() as { accessToken?: string };
    setCookieHeader = res.headers.get('set-cookie');
  } catch {
    const url = new URL(`${BASE_PATH}/login`, req.url);
    url.searchParams.set('error', 'oauth_failed');
    return NextResponse.redirect(url);
  }

  if (!data.accessToken) {
    const url = new URL(`${BASE_PATH}/login`, req.url);
    url.searchParams.set('error', 'oauth_failed');
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(new URL(`${BASE_PATH}/studio`, req.url));
  setAuthCookies(response, data.accessToken, setCookieHeader);
  return response;
}
