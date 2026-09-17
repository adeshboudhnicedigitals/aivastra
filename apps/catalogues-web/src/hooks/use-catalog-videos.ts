'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useJobStream } from './use-job-stream';

export interface CatalogVideoItem {
  id: string;
  status: string;
  createdAt: string;
  sampleVideoId: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
}

export const PENDING_STATUSES = new Set(['QUEUED', 'PREPROCESSING', 'GENERATING', 'UPLOADING']);

// Backed by GET /v1/catalog-videos. Shared by Motion Studio's own in-flight-job
// panel and the Catalogs page's video history section — same query key, so
// submitting a job on one and viewing it on the other never race two
// independent fetches of the same list. Polls while anything is still
// in-flight and refetches off the shared job SSE stream on any terminal
// transition, so a just-finished video shows up without waiting on the poll.
//
// `enabled` defaults to true (Motion Studio only ever mounts its consumer of
// this hook once a job was actually created there, which already proves
// access). The Catalogs page — visited by every user, not just ones with
// catalog-video access — passes `enabled: catalogVideoEnabled` so the ~403
// this endpoint returns for everyone else isn't fired on every page load.
export function useCatalogVideos(options?: { enabled?: boolean }) {
  const qc = useQueryClient();

  const query = useQuery<CatalogVideoItem[]>({
    queryKey: ['catalog-videos'],
    queryFn: () => api.get('/v1/catalog-videos'),
    enabled: options?.enabled ?? true,
    refetchInterval: (q) => {
      const rows = q.state.data as CatalogVideoItem[] | undefined;
      return rows?.some((r) => PENDING_STATUSES.has(r.status)) ? 4000 : false;
    },
  });

  useJobStream((evt) => {
    if (evt.status === 'COMPLETED' || evt.status === 'FAILED') {
      qc.invalidateQueries({ queryKey: ['catalog-videos'] });
    }
  });

  return query;
}
