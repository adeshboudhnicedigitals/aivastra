'use client';
import { Loader2 } from 'lucide-react';
import { C } from '@/components/tokens';

/** Loading / empty / error wrapper for list-style content. */
export function ListState({
  status,
  isEmpty,
  emptyText,
  error,
  onRetry,
  children,
}: {
  status: 'pending' | 'error' | 'success';
  isEmpty: boolean;
  emptyText: string;
  error?: string | null;
  onRetry?: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  if (status === 'pending') {
    return (
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 24,
          color: C.mid,
          fontSize: 14,
        }}
      >
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        Loading...
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div
        role="alert"
        style={{
          padding: 16,
          borderRadius: 10,
          border: `1px solid ${C.danger}`,
          color: C.danger,
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span>{error ?? 'Something went wrong.'}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              height: 36,
              padding: '0 14px',
              borderRadius: 8,
              border: `1px solid ${C.border2}`,
              background: C.white,
              color: C.text,
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }
  if (isEmpty) {
    return <div style={{ padding: 24, color: C.mid, fontSize: 14 }}>{emptyText}</div>;
  }
  return <>{children}</>;
}
