import Constants from 'expo-constants';
import { useEffect, useRef } from 'react';
import { createSSEConnection, type SSEEvent } from '../lib/sse';
import { useAuthStore } from '../store/auth';

const API_URL = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:4000';

interface UseSSEOptions {
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

export function useSSE(
  path: string,
  onEvent: (event: SSEEvent) => void,
  options: UseSSEOptions = {},
): void {
  const token = useAuthStore((state) => state.token);
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  useEffect(() => {
    if (!token || options.enabled === false) return;

    const connection = createSSEConnection({
      baseUrl: API_URL,
      path,
      token,
      onEvent: (event) => onEventRef.current(event),
      onError: (error) => onErrorRef.current?.(error),
    });

    return connection.close;
  }, [options.enabled, path, token]);
}
