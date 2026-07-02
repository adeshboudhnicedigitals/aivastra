import { useEffect, useRef } from 'react';
import { NOTIFICATION_EVENTS, triggerNotifications } from '../lib/notifications';
import { useNotificationConfig } from '../store/notifications';
import type { JobStatus } from '../types';

/**
 * Fires sound/Slack notifications once per terminal job status transition.
 * Call this from a job detail view with the live status.
 */
export function useJobNotifications(
  jobId: string,
  currentStatus: JobStatus | null | undefined,
): void {
  const config = useNotificationConfig();
  const notifiedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!currentStatus || !config.loaded) return;
    if (!NOTIFICATION_EVENTS.includes(currentStatus)) return;

    const key = `${jobId}:${currentStatus}`;
    if (notifiedKey.current === key) return;
    notifiedKey.current = key;

    void triggerNotifications(config, currentStatus, jobId);
  }, [currentStatus, jobId, config]);
}
