import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useToastStore } from '../store/toast';

interface UseApiOptions {
  enabled?: boolean;
}

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useApi<T>(path: string, options: UseApiOptions = {}): UseApiResult<T> {
  const { enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const hasData = useRef(false);
  hasData.current = data !== null;

  let currentData = data;
  let currentError = error;
  let currentLoading = loading;
  const lastPath = useRef(path);
  if (path !== lastPath.current) {
    lastPath.current = path;
    setData(null);
    setError(null);
    currentData = null;
    currentError = null;
    currentLoading = enabled;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    const currentRequest = ++requestId.current;
    setLoading(true);

    try {
      const nextData = await apiFetch<T>(path);
      if (mounted.current && currentRequest === requestId.current) {
        setData(nextData);
        setError(null);
      }
    } catch (cause) {
      if (mounted.current && currentRequest === requestId.current) {
        const err = cause instanceof Error ? cause : new Error('Request failed');
        setError(err);
        if (hasData.current) {
          useToastStore.getState().show(err.message, 'error');
        }
      }
    } finally {
      if (mounted.current && currentRequest === requestId.current) setLoading(false);
    }
  }, [enabled, path]);

  useEffect(() => {
    if (enabled) {
      void refresh();
    } else {
      requestId.current += 1;
      setLoading(false);
    }
  }, [enabled, refresh]);

  return { data: currentData, loading: currentLoading, error: currentError, refresh };
}
