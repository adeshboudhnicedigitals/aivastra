import { proxyMerchantJson } from '@/lib/merchant-auth';

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyMerchantJson({
    path: `/v1/merchant/kiosk-devices/${id}/pairing-code`,
    method: 'POST',
  });
}
