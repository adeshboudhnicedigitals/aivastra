import type { MerchantAnalyticsResponse } from '@aivastra/types';
import { api } from '@/lib/api';

export type { MerchantAnalyticsResponse };

export function getMerchantAnalytics(): Promise<MerchantAnalyticsResponse> {
  return api.get<MerchantAnalyticsResponse>('/v1/merchant/analytics');
}
