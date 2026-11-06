'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, setForbiddenHandler, signOut } from '@/lib/api';
import type { OrgMe } from '@/lib/roles';

type Session = { me: OrgMe | null; status: 'loading' | 'ready' | 'signed-out' };

const SessionContext = createContext<Session>({ me: null, status: 'loading' });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>({ me: null, status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setForbiddenHandler(() => {
      setSession({ me: null, status: 'signed-out' });
      void signOut();
    });
    apiFetch<OrgMe>('/v1/merchant/org/me')
      .then((me) => {
        if (!cancelled) setSession({ me, status: 'ready' });
      })
      .catch(() => {
        if (!cancelled) setSession({ me: null, status: 'signed-out' });
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
