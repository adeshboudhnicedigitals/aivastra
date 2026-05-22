import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { setToken, initAuthFailureHandler, apiFetch } from '../lib/data';

export type AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT';

interface AuthState {
  token: string | null;
  role: AdminRole | null;
  email: string | null;
  storagePublicUrl: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [storagePublicUrl, setStoragePublicUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const handleAuthFailure = useCallback(() => {
    setTokenState(null);
    setRole(null);
  }, []);

  useEffect(() => {
    initAuthFailureHandler(handleAuthFailure);
  }, [handleAuthFailure]);

  const fetchRole = useCallback(async () => {
    const me = await apiFetch<{ userId: string; email: string; role: AdminRole; storagePublicUrl?: string }>('/admin/me');
    setRole(me.role);
    setEmail(me.email);
    if (me.storagePublicUrl) setStoragePublicUrl(me.storagePublicUrl);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/v1/auth/refresh', { method: 'POST', credentials: 'include' });
        if (res.ok) {
          const { accessToken } = await res.json() as { accessToken: string };
          setToken(accessToken);
          setTokenState(accessToken);
          await fetchRole();
        }
      } catch {
        // not logged in
      } finally {
        setIsLoading(false);
      }
    })();
  }, [fetchRole]);

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken } = await apiFetch<{ accessToken: string }>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(accessToken);
    setTokenState(accessToken);
    await fetchRole();
  }, [fetchRole]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/v1/auth/logout', { method: 'POST' });
    } catch {
      // best-effort
    }
    setToken(null);
    setTokenState(null);
    setRole(null);
    setEmail(null);
    setStoragePublicUrl(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, role, email, storagePublicUrl, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
