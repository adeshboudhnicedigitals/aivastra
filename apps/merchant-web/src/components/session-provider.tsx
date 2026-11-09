'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, setForbiddenHandler, signOut } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import type { OrgMe } from '@/lib/roles';

// Why the session ended; carried to /login?error= so the sign-in screen can say so.
export type SignedOutReason = 'no_access' | 'unreachable' | 'session_expired';

type Session = {
  me: OrgMe | null;
  status: 'loading' | 'ready' | 'signed-out';
  reason?: SignedOutReason;
};

const SessionContext = createContext<Session>({ me: null, status: 'loading' });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>({ me: null, status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setForbiddenHandler(() => {
      setSession({ me: null, status: 'signed-out', reason: 'no_access' });
      void signOut();
    });
    apiFetch<OrgMe>('/v1/merchant/org/me')
      .then((me) => {
        if (!cancelled) setSession({ me, status: 'ready' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A non-ApiError is a failed fetch (API down, or this origin missing from CORS_ORIGIN).
        const reason: SignedOutReason =
          err instanceof ApiError
            ? err.status === 401
              ? 'session_expired'
              : 'no_access'
            : 'unreachable';
        setSession({ me: null, status: 'signed-out', reason });
      });
    return () => {
      cancelled = true;
      setForbiddenHandler(null);
    };
  }, []);

  const value = useMemo(() => session, [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  return useContext(SessionContext);
}
