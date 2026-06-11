import { useEffect, useLayoutEffect, useRef } from 'react';
import { createSSEConnection } from '@/lib/sse';

export interface JobStatusEvent {
  jobId: string;
  userId: string;
  type: 'STATUS';
  status: string;
  resultKey?: string;
  workerId?: string;
  errorCode?: string;
}

/**
 * Subscribes to the user-level job event stream for the lifetime of the component.
 * The callback is stored in a ref so the SSE connection is created once on mount
 * and never restarted due to callback identity changes.
 */
export function useJobStream(onEvent: (evt: JobStatusEvent) => void): void {
  const callbackRef = useRef(onEvent);
  useLayoutEffect(() => {
    callbackRef.current = onEvent;
  });

  useEffect(() => {
    const conn = createSSEConnection<JobStatusEvent>('/v1/jobs/stream', (e) => {
      if (e.type === 'STATUS') callbackRef.current(e.data);
    });
    return () => conn.close();
  }, []); // single connection per mount — callback changes handled via ref
}
