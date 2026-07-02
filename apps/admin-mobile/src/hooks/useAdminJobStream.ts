import { useMemo } from 'react';
import type { AdminJobEvent } from '../types';
import { useSSE } from './useSSE';

interface UseAdminJobStreamOptions {
  onError?: (error: unknown) => void;
}

const DEFAULT_OPTIONS: UseAdminJobStreamOptions = {};

export function useAdminJobStream(
  jobId: string,
  onEvent: (event: AdminJobEvent) => void,
  options: UseAdminJobStreamOptions = DEFAULT_OPTIONS,
): void {
  const path = useMemo(() => `/admin/jobs/stream?jobId=${encodeURIComponent(jobId)}`, [jobId]);

  useSSE(
    path,
    (event) => {
      try {
        const parsed = JSON.parse(event.data) as AdminJobEvent;
        if (parsed.jobId === jobId) onEvent(parsed);
      } catch {
        // Ignore malformed stream events.
      }
    },
    options,
  );
}
