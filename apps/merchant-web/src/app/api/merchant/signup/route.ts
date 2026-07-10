import { type NextRequest, NextResponse } from 'next/server';
import { safeJson } from '@/lib/bff';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${API_URL}/v1/merchant/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const [data, ok] = await safeJson(res);
    return NextResponse.json(data, { status: ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: { message: 'Service unavailable' } }, { status: 503 });
  }
}
