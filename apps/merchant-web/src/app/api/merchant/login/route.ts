import { type NextRequest, NextResponse } from 'next/server';
import { safeJson } from '@/lib/bff';
import { setMerchantCookies } from '@/lib/merchant-auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${API_URL}/v1/merchant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const [data, ok] = await safeJson(res);
    if (!ok) return NextResponse.json(data, { status: res.status });

    const payload = data as { accessToken: string; refreshToken: string };
    const response = NextResponse.json({ ok: true });
    setMerchantCookies(response, payload.accessToken, payload.refreshToken);
    return response;
  } catch {
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
