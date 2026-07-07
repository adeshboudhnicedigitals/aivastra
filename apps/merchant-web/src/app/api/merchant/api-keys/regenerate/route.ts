import { proxyMerchantJson } from '@/lib/merchant-auth';

export async function POST() {
  return proxyMerchantJson({ path: '/v1/merchant/api-keys/regenerate', method: 'POST' });
}
