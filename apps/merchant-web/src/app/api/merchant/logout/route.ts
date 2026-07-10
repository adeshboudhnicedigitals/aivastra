import { NextResponse } from 'next/server';
import { clearMerchantCookies, getMerchantRefreshCookie } from '@/lib/merchant-auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function POST() {
  const refreshToken = await getMerchantRefreshCookie();

  if (refreshToken) {
    try {
      await fetch(`${API_URL}/v1/merchant/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
    } catch {
      // ignore and clear cookies locally
    }
  }

  const response = NextResponse.json({ ok: true });
  clearMerchantCookies(response);
  return response;
}
