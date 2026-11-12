'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { C } from '@/components/tokens';
import { hqFetch } from '@/lib/hq-api';

export type HqMe = { userId: string; email: string; role: string; permissions: string[] };
type Ctx = { me: HqMe; can: (permission: string) => boolean };

const HqContext = createContext<Ctx | null>(null);

export function useHq(): Ctx {
  const v = useContext(HqContext);
  if (!v) throw new Error('useHq outside HqSession');
  return v;
}

/** Loads /admin/me once and gates the console: no session or no accounts.read means sign-in. */
export function HqSession({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<HqMe | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    hqFetch<HqMe>('/admin/me')
      .then((m) => {
        if (m.permissions.includes('accounts.read')) setMe(m);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    if (failed) window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/hq/login`;
  }, [failed]);
  if (!me) {
    return (
      <div role="status" style={{ padding: 24, color: C.mid, fontSize: 14 }}>
        Loading...
      </div>
    );
  }
  return (
    <HqContext.Provider value={{ me, can: (p) => me.permissions.includes(p) }}>
      {children}
    </HqContext.Provider>
  );
}
