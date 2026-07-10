import type { NextRequest } from 'next/server';
import { proxyMerchantJson } from '@/lib/merchant-auth';

export async function GET() {
  return proxyMerchantJson({ path: '/v1/merchant/catalog' });
}

export async function POST(req: NextRequest) {
  return proxyMerchantJson({
    path: '/v1/merchant/catalog',
    method: 'POST',
    body: await req.json(),
  });
}
