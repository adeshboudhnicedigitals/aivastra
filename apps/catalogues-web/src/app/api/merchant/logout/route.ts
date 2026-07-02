import { type NextRequest, NextResponse } from 'next/server';

export async function POST(_req: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('merchant_access_token', '', {
    maxAge: 0,
    path: '/',
  });
  return response;
}
