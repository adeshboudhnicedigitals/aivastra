import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/bff';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function POST() {
  const store = await cookies();
  const t = store.get('merchant_access_token')?.value;
  if (!t) return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  try {
    const res = await fetch(`${API_URL}/v1/merchant/api-keys/regenerate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}` },
    });
    const [data, ok] = await safeJson(res);
    return NextResponse.json(data, { status: ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
