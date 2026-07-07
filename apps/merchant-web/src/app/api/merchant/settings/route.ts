import type { NextRequest } from 'next/server';
import { proxyMerchantJson } from '@/lib/merchant-auth';

export async function PATCH(req: NextRequest) {
  return proxyMerchantJson({
    path: '/v1/merchant/settings',
    method: 'PATCH',
    body: await req.json(),
  });
}
