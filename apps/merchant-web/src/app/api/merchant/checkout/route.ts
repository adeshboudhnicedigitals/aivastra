import type { NextRequest } from 'next/server';
import { proxyMerchantJson } from '@/lib/merchant-auth';

export async function POST(req: NextRequest) {
  return proxyMerchantJson({
    path: '/v1/merchant/payments/orders',
    method: 'POST',
    body: await req.json(),
  });
}
