import type { MessagingAccountsResponse } from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Shared by Settings and the studio chip. `enabled: false` from the api means the
// bot is switched off for this environment — callers render nothing.
export function useWhatsappStatus() {
  return useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => api.get<MessagingAccountsResponse>('/v1/messaging/accounts'),
    staleTime: 60_000,
  });
}
