import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { REFUND_REQUEST_ENABLED } from '@/lib/feature-flags';

export interface RefundStatusItem {
  jobId: string;
  eligible: boolean;
  request: {
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    reasonCode: string;
    adminNote: string | null;
    createdAt: string;
    reviewedAt: string | null;
  } | null;
}

/**
 * Refund state for a set of completed jobs in one request. The server is the only
 * place that knows eligibility (downloaded? free job? already requested?), so the
 * button is driven by `eligible` rather than re-derived here.
 */
export function useRefundStatuses(jobIds: string[]) {
  const ids = [...jobIds].sort();
  const query = useQuery({
    queryKey: ['refund-status', ids.join(',')],
    queryFn: () =>
      api.get<{ items: RefundStatusItem[] }>(`/v1/jobs/refund-status?jobIds=${ids.join(',')}`),
    enabled: REFUND_REQUEST_ENABLED && ids.length > 0 && ids.length <= 50,
    staleTime: 30_000,
  });
  const byJob = new Map((query.data?.items ?? []).map((i) => [i.jobId, i]));
  return { byJob, refetch: query.refetch };
}
