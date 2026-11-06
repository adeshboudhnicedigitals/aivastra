'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { C } from '@/components/tokens';

type Kind = 'error' | 'success';
type Toast = { id: number; message: string; kind: Kind };
type ToastApi = { show: (message: string, kind?: Kind) => void };

const DISMISS_MS = 5000;
const ToastContext = createContext<ToastApi>({ show: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: Kind = 'error') => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, message, kind }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
    };
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          left: 16,
          zIndex: 1200,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            style={{
              pointerEvents: 'auto',
              maxWidth: 420,
              padding: '10px 14px',
              borderRadius: 10,
              background: C.card,
              border: `1px solid ${t.kind === 'error' ? C.danger : C.mint}`,
              color: t.kind === 'error' ? C.danger : C.text,
              fontSize: 14,
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              style={{
                border: 'none',
                background: 'transparent',
                color: C.mid,
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
