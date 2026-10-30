import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Page } from './components/Sidebar';
import { Sidebar } from './components/Sidebar';
import { ToastStack } from './components/ToastStack';
import { Topbar } from './components/Topbar';
import { useAuth } from './context/AuthContext';
import { useBreadcrumbContext } from './context/BreadcrumbContext';
import { apiErrorMessage, apiFetch, patchAdminPreferences } from './lib/data';
import ChatInboxPage from './pages/ChatInboxPage';
import DashboardPage from './pages/DashboardPage';
import JobsPage from './pages/JobsPage';
import LoginPage from './pages/LoginPage';
import UsersPage from './pages/UsersPage';
import type { ToastItem } from './types';

type Theme = 'light' | 'dark' | 'system';

const PAGE_LABELS: Record<Page, string> = {
  dashboard: 'Dashboard',
  'chat-inbox': 'Chat Inbox',
  jobs: 'Jobs',
  users: 'Users',
};

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const raw = localStorage.getItem('aivastra-theme');
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'system')
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return t;
}

function pageFromPath(pathname: string): Page {
  const segment = pathname.slice(1).split('/')[0];
  if (segment === 'chat-inbox' || segment === 'jobs' || segment === 'users') return segment;
  return 'dashboard';
}

export default function App() {
  const { token, isLoading } = useAuth();
  const { crumbs: registeredCrumbs } = useBreadcrumbContext();
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const idRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolveTheme(theme));
    localStorage.setItem('aivastra-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () =>
      document.documentElement.setAttribute('data-theme', resolveTheme('system'));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!token || isLoading) return;
    let cancelled = false;
    apiFetch<{ preferences?: { theme?: Theme } }>('/admin/me')
      .then((me) => {
        if (cancelled) return;
        const serverValue = me.preferences?.theme;
        if (serverValue) setThemeState(serverValue);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, isLoading]);

  const toast = useCallback(
    (t: { kind?: 'error' | 'warning' | 'success'; title: string; body?: string }) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, kind: t.kind, title: t.title, body: t.body }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, 4000);
    },
    [],
  );

  const updateTheme = useCallback(
    (nextTheme: Theme) => {
      const previousTheme = theme;
      setThemeState(nextTheme);
      if (!token) return;
      patchAdminPreferences({ theme: nextTheme }).catch((e) => {
        setThemeState(previousTheme);
        toast({
          kind: 'error',
          title: 'Failed to sync theme preference',
          body: apiErrorMessage(e, 'Please try again.'),
        });
      });
    },
    [theme, token, toast],
  );

  const toggleTheme = useCallback(() => {
    const order: Theme[] = ['light', 'dark', 'system'];
    updateTheme(order[(order.indexOf(theme) + 1) % order.length]);
  }, [theme, updateTheme]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const goToPage = useCallback(
    (p: Page, filter?: { status?: string }) =>
      navigate(p === 'dashboard' ? '/' : `/${p}`, { state: filter }),
    [navigate],
  );

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          color: 'var(--muted)',
          fontFamily: 'var(--sans)',
          fontSize: '0.875rem',
        }}
      >
        Loading…
      </div>
    );
  }

  if (!token) {
    return <LoginPage />;
  }

  const page = pageFromPath(location.pathname);
  const trail = [
    { label: 'Aivastra', href: '/' },
    { label: PAGE_LABELS[page], href: location.pathname },
    ...registeredCrumbs,
  ];
  const pageProps = { toast };

  return (
    <div className="app">
      <Sidebar
        page={page}
        onNav={goToPage}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />
      {mobileNavOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} />
      )}
      <div className="main">
        <Topbar
          trail={trail}
          onNavTrail={(href) => navigate(href)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        <main className="content">
          <Routes>
            <Route path="/" element={<DashboardPage {...pageProps} onNavigateTab={goToPage} />} />
            <Route path="/chat-inbox" element={<ChatInboxPage {...pageProps} />} />
            <Route path="/jobs" element={<JobsPage {...pageProps} />} />
            <Route path="/users" element={<UsersPage {...pageProps} />} />
            <Route path="*" element={<DashboardPage {...pageProps} onNavigateTab={goToPage} />} />
          </Routes>
        </main>
      </div>
      <ToastStack items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
