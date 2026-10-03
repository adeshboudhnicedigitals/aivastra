import type { WordpressConnectResponse } from '@aivastra/types';
import { api } from '@/lib/api';

export function connectWordpress(
  siteUrl: string,
  siteName?: string,
  phone?: string,
): Promise<WordpressConnectResponse> {
  return api.post<WordpressConnectResponse>('/v1/merchant/wordpress-connect', {
    siteUrl,
    siteName,
    phone,
  });
}
