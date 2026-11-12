import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, initAuthFailureHandler, setToken } from '../lib/data';

export type AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT' | 'ADMIN';

interface AuthState {
  token: string | null;
  role: AdminRole | null;
  email: string | null;
  permissions: string[];
  hasPermission: (permission: string) => boolean;
  // Sidebar-only visibility override, independent of `permissions` — see
  // role-nav-overrides.routes.ts. `undefined` means "no override, use the
  // permission-driven default".
  isNavVisible: (navKey: string) => boolean | undefined;
  isLoading: boolean;
  /** Resolves to a challenge when a second factor is owed (no session exists yet), else null. */
  login: (email: string, password: string) => Promise<MfaChallenge | null>;
  /** Completes sign-in with the access token a passed second factor returned. */
  finishLogin: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

export type MfaChallenge = { step: 'verify' | 'enroll'; mfaToken: string };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [navOverrides, setNavOverrides] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  const handleAuthFailure = useCallback(() => {
    setTokenState(null);
    setRole(null);
    setPermissions([]);
    setNavOverrides({});
  }, []);

  useEffect(() => {
    initAuthFailureHandler(handleAuthFailure);
  }, [handleAuthFailure]);

  const hasPermission = useCallback(
    (permission: string) => {
      if (role === 'SUPER_ADMIN') return true;
      return permissions.includes(permission);
    },
    [role, permissions],
  );

  const isNavVisible = useCallback((navKey: string) => navOverrides[navKey], [navOverrides]);

  const fetchRole = useCallback(async () => {
    const me = await apiFetch<{
      userId: string;
      email: string;
      role: AdminRole;
      permissions?: string[];
      navOverrides?: Record<string, boolean>;
    }>('/admin/me');
    setRole(me.role);
    setEmail(me.email);
    setPermissions(me.permissions ?? []);
    setNavOverrides(me.navOverrides ?? {});
  }, []);

  useEffect(() => {
    (async () => {
      if (!sessionStorage.getItem('admin_hasSession')) {
        setIsLoading(false);
        return;
      }
      try {
        const res = await fetch('/admin/auth/refresh', { method: 'POST', credentials: 'include' });
        if (res.ok) {
          const { accessToken } = (await res.json()) as { accessToken: string };
          setToken(accessToken);
          setTokenState(accessToken);
          await fetchRole();
        } else {
          sessionStorage.removeItem('admin_hasSession');
        }
      } catch {
        // not logged in
      } finally {
        setIsLoading(false);
      }
    })();
  }, [fetchRole]);

  const finishLogin = useCallback(
    async (accessToken: string) => {
      setToken(accessToken);
      try {
        await fetchRole();
        setTokenState(accessToken);
        sessionStorage.setItem('admin_hasSession', '1');
      } catch (err) {
        setToken(null);
        throw err;
      }
    },
    [fetchRole],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<MfaChallenge | null> => {
      const res = await apiFetch<{
        accessToken?: string;
        mfaRequired?: 'verify' | 'enroll';
        mfaToken?: string;
      }>('/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      // Password was right but a second factor is owed: no token or cookie exists yet.
      if (res.mfaRequired && res.mfaToken) return { step: res.mfaRequired, mfaToken: res.mfaToken };
      await finishLogin(res.accessToken as string);
      return null;
    },
    [finishLogin],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch('/admin/auth/logout', { method: 'POST' });
    } catch {
      // best-effort
    }
    sessionStorage.removeItem('admin_hasSession');
    setToken(null);
    setTokenState(null);
    setRole(null);
    setEmail(null);
    setPermissions([]);
    setNavOverrides({});
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        role,
        email,
        permissions,
        hasPermission,
        isNavVisible,
        isLoading,
        login,
        finishLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
