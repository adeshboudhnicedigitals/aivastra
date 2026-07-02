import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { safeJson } from '@/lib/bff';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function token(): Promise<string | null> {
  const store = await cookies();
  return store.get('merchant_access_token')?.value ?? null;
}

export async function GET() {
  const t = await token();
  if (!t) return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  try {
    const res = await fetch(`${API_URL}/v1/merchant/me`, {
      headers: { Authorization: `Bearer ${t}` },
      cache: 'no-store',
    });
    const [data, ok] = await safeJson(res);
    return NextResponse.json(data, { status: ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest) {
  const t = await token();
  if (!t) return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  try {
    const body = await req.json();
    const res = await fetch(`${API_URL}/v1/merchant/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify(body),
    });
    const [data, ok] = await safeJson(res);
    return NextResponse.json(data, { status: ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
