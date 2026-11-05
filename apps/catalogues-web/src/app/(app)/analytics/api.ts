import type { MerchantAnalyticsResponse } from '@aivastra/types';
import { api } from '@/lib/api';

export type AnalyticsRange = '7d' | '30d' | '90d';

export function getMerchantAnalytics(range: AnalyticsRange): Promise<MerchantAnalyticsResponse> {
  return api.get<MerchantAnalyticsResponse>(`/v1/merchant/analytics?range=${range}`);
}
