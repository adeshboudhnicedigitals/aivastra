import { type NextRequest, NextResponse } from 'next/server';
import { safeJson } from '@/lib/bff';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function setMerchantCookie(response: NextResponse, setCookieHeader: string | null) {
  if (setCookieHeader) {
    const match = setCookieHeader.match(/merchant_access_token=([^;]+)/);
    if (match) {
      response.cookies.set('merchant_access_token', match[1]!, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
        secure: process.env.NODE_ENV === 'production',
      });
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${API_URL}/v1/merchant/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const [data, ok] = await safeJson(res);
    if (!ok) return NextResponse.json(data, { status: res.status });

    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    const setCookieStr = h.getSetCookie
      ? h.getSetCookie().join(', ') || null
      : res.headers.get('set-cookie');
    const response = NextResponse.json({ ok: true });
    setMerchantCookie(response, setCookieStr);
    return response;
  } catch (err) {
    console.error('merchant signup BFF route failed:', err);
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
