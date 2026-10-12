import { useQueries } from '@tanstack/react-query';
import { useRef } from 'react';
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

// Server accepts 1-50 uuids per call; batches can reach 200 jobs, so we chunk.
const CHUNK_SIZE = 50;
const PENDING_POLL_MS = 45_000;

/**
 * Refund state for a set of completed jobs. The server is the only place that
 * knows eligibility (downloaded? free job? already requested?), so the button is
 * driven by `eligible` rather than re-derived here.
 *
 * Ids are sorted and chunked into one query per 50. A job completing mid-batch
 * changes chunk membership (and so query keys); to guarantee an already-known
 * PENDING/APPROVED lock never vanishes while its chunk refetches, results are
 * merged into a ref map that is only ever overwritten by fresh items, instead of
 * relying on per-chunk placeholder data (which is keyed by the shifting chunk).
 */
export function useRefundStatuses(jobIds: string[]) {
  const ids = [...jobIds].sort();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) chunks.push(ids.slice(i, i + CHUNK_SIZE));

  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['refund-status', chunk.join(',')],
      queryFn: () =>
        api.get<{ items: RefundStatusItem[] }>(`/v1/jobs/refund-status?jobIds=${chunk.join(',')}`),
      enabled: REFUND_REQUEST_ENABLED,
      staleTime: 30_000,
      // Only poll while a decision is outstanding, so an idle page picks up the
      // admin's approve/reject; no polling when nothing is pending.
      refetchInterval: (query: { state: { data?: { items: RefundStatusItem[] } } }) =>
        query.state.data?.items.some((i) => i.request?.status === 'PENDING')
          ? PENDING_POLL_MS
          : false,
    })),
  });

  const known = useRef(new Map<string, RefundStatusItem>());
  for (const q of queries) {
    for (const item of q.data?.items ?? []) known.current.set(item.jobId, item);
  }
  const byJob = new Map(known.current);

  const refetch = () => {
    for (const q of queries) void q.refetch();
  };
  return { byJob, refetch };
}
