import type { NextRequest } from 'next/server';
import { proxyMerchantJson } from '@/lib/merchant-auth';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyMerchantJson({
    path: `/v1/merchant/kiosk-devices/${id}`,
    method: 'PATCH',
    body: await req.json(),
  });
}
