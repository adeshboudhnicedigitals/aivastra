import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaginatedResponse } from '../types';

export function usePagination<T>(fetchPage: (page: number) => Promise<PaginatedResponse<T>>) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paginating, setPaginating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setRefreshing(true);
    setError(null);
    try {
      const result = await fetchPage(1);
      if (currentRequest !== requestId.current) return;
      setItems(result.items);
      setPage(result.page);
      setTotal(result.total);
    } catch (cause) {
      if (currentRequest === requestId.current)
        setError(cause instanceof Error ? cause : new Error('Request failed'));
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (page === 0 || loading || refreshing || paginating || items.length >= total) return;
    const currentRequest = ++requestId.current;
    setPaginating(true);
    try {
      const result = await fetchPage(page + 1);
      if (currentRequest !== requestId.current) return;
      setItems((current) => [...current, ...result.items]);
      setPage(result.page);
      setTotal(result.total);
      setError(null);
    } catch (cause) {
      if (currentRequest === requestId.current)
        setError(cause instanceof Error ? cause : new Error('Request failed'));
    } finally {
      if (currentRequest === requestId.current) setPaginating(false);
    }
  }, [fetchPage, items.length, loading, page, paginating, refreshing, total]);

  useEffect(() => {
    setLoading(true);
    setItems([]);
    setPage(0);
    setTotal(0);
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  return {
    items,
    loading,
    refreshing,
    paginating,
    error,
    hasMore: items.length < total,
    refresh,
    loadMore,
  };
}
