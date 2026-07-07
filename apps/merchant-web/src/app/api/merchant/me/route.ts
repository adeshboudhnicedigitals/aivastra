import type { NextRequest } from 'next/server';
import { proxyMerchantJson } from '@/lib/merchant-auth';

export async function GET() {
  return proxyMerchantJson({ path: '/v1/merchant/me' });
}

export async function PATCH(req: NextRequest) {
  return proxyMerchantJson({
    path: '/v1/merchant/me',
    method: 'PATCH',
    body: await req.json(),
  });
}
