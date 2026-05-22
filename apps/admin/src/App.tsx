import { useState, useCallback, useRef, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ToastStack } from './components/ToastStack';
import DashboardPage from './pages/DashboardPage';
import CatalogPage from './pages/CatalogPage';
import UsersPage from './pages/UsersPage';
import JobsPage from './pages/JobsPage';
import AssetsPage from './pages/AssetsPage';
import SettingsPage from './pages/SettingsPage';
import CreditRequestsPage from './pages/CreditRequestsPage';
import LoginPage from './pages/LoginPage';
import { useAuth } from './context/AuthContext';
import type { ToastItem } from './types';

type Page = 'dashboard' | 'assets' | 'catalog' | 'users' | 'jobs' | 'credits' | 'settings';
type Theme = 'light' | 'dark';

const PAGE_LABELS: Record<Page, string> = {
  dashboard: 'Dashboard',
  assets: 'Assets',
  catalog: 'Catalog',
  users: 'Users',
  jobs: 'Jobs',
  credits: 'Credit Requests',
  settings: 'Settings',
};

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return (localStorage.getItem('aivastra-theme') as Theme) || 'dark';
}

export default function App() {
  const { token, role, isLoading } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('aivastra-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const toast = useCallback((t: { kind?: 'error'; title: string; body?: string }) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, kind: t.kind, title: t.title, body: t.body }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const handleNav = useCallback((p: string) => {
    setPage(p as Page);
  }, []);

  const handleNavWithFilter = useCallback((_page: string, _filter?: { page: string; filter?: string }) => {
    setPage(_page as Page);
  }, []);

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        color: 'var(--muted)',
        fontFamily: 'var(--sans)',
        fontSize: '0.875rem',
      }}>
        Loading…
      </div>
    );
  }

  if (!token) {
    return <LoginPage />;
  }

  const trail = ['Aivastra', PAGE_LABELS[page]];
  const pageProps = { onNav: handleNavWithFilter, toast };
  const settingsProps = { onNav: handleNavWithFilter, toast, theme, onToggleTheme: toggleTheme };

  return (
    <div className="app">
      <Sidebar page={page} onNav={handleNav} role={role ?? ''} />
      <div className="main">
        <Topbar trail={trail} onNavTrail={(i) => i === 0 && setPage('dashboard')} />
        <main className="content">
          {page === 'dashboard' && <DashboardPage {...pageProps} />}
          {page === 'assets' && <AssetsPage {...pageProps} />}
          {page === 'catalog' && <CatalogPage {...pageProps} />}
          {page === 'users' && <UsersPage {...pageProps} />}
          {page === 'jobs' && <JobsPage {...pageProps} />}
          {page === 'credits' && <CreditRequestsPage {...pageProps} />}
          {page === 'settings' && <SettingsPage {...settingsProps} />}
        </main>
      </div>
      <ToastStack items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
