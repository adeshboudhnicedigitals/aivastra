import { proxyMerchantJson } from '@/lib/merchant-auth';

export async function GET() {
  return proxyMerchantJson({ path: '/v1/merchant/catalogues' });
}
