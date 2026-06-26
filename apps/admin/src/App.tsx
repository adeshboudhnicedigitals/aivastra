import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { ToastStack } from './components/ToastStack';
import { Topbar } from './components/Topbar';
import { useAuth } from './context/AuthContext';
import { apiFetch, patchAdminPreferences } from './lib/data';
import AssetsPage from './pages/AssetsPage';
import DashboardPage from './pages/DashboardPage';
import JobsPage from './pages/JobsPage';
import LoginPage from './pages/LoginPage';
import RecycleBinPage from './pages/RecycleBinPage';
import SettingsPage from './pages/SettingsPage';
import TryonPage from './pages/TryonPage';
import UsersPage from './pages/UsersPage';
import { WidgetClientDetail } from './pages/WidgetClientDetail';
import { WidgetClients } from './pages/WidgetClients';
import WorkflowsPage from './pages/WorkflowsPage';
import type { ToastItem } from './types';

type Theme = 'light' | 'dark' | 'system';

const PATH_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  assets: 'Assets',
  users: 'Users',
  jobs: 'Jobs',
  workflows: 'Workflows',
  'recycle-bin': 'Recycle bin',
  settings: 'Settings',
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

export default function App() {
  const { token, role, isLoading } = useAuth();
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const skipSyncRef = useRef(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const idRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();

  // Apply theme to DOM + persist locally
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolveTheme(theme));
    localStorage.setItem('aivastra-theme', theme);
  }, [theme]);

  // Track OS preference changes when in system mode
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () =>
      document.documentElement.setAttribute('data-theme', resolveTheme('system'));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // Load server preference on login
  useEffect(() => {
    if (!token || isLoading) return;
    let cancelled = false;
    apiFetch<{ preferences?: { theme?: Theme } }>('/admin/me')
      .then((me) => {
        if (cancelled) return;
        const serverValue = me.preferences?.theme;
        if (serverValue) {
          skipSyncRef.current = true;
          setThemeState(serverValue);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, isLoading]);

  // Debounced server sync on user-initiated changes
  useEffect(() => {
    if (!token) return;
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      patchAdminPreferences({ theme }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [theme, token]);

  function setTheme(next: Theme) {
    setThemeState(next);
  }

  const toggleTheme = useCallback(() => {
    const order: Theme[] = ['light', 'dark', 'system'];
    setThemeState((t) => order[(order.indexOf(t) + 1) % order.length]);
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

  const handleNav = useCallback(
    (p: string) => {
      navigate(`/${p}`);
    },
    [navigate],
  );

  const handleNavWithFilter = useCallback(
    (_page: string, _filter?: { page: string; filter?: string }) => {
      navigate(`/${_page}`);
    },
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

  const segment = location.pathname.slice(1).split('/')[0] || 'dashboard';
  const pageLabel = PATH_LABELS[segment] ?? 'Dashboard';
  const trail = ['Aivastra', pageLabel];
  const pageProps = { onNav: handleNavWithFilter, toast };
  const settingsProps = { onNav: handleNavWithFilter, toast, theme, setTheme };

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        page={segment}
        onNav={handleNav}
        role={role ?? ''}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />
      <div className="main">
        <Topbar
          trail={trail}
          onNavTrail={(i) => i === 0 && navigate('/dashboard')}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <main className="content">
          <Routes>
            <Route path="/" element={<DashboardPage {...pageProps} />} />
            <Route path="/dashboard" element={<DashboardPage {...pageProps} />} />
            <Route path="/assets" element={<AssetsPage {...pageProps} />} />
            <Route path="/users" element={<UsersPage {...pageProps} />} />
            <Route path="/jobs" element={<JobsPage {...pageProps} />} />
            <Route path="/workflows" element={<WorkflowsPage {...pageProps} />} />
            <Route path="/tryon" element={<TryonPage {...pageProps} />} />
            <Route path="/recycle-bin" element={<RecycleBinPage {...pageProps} />} />
            <Route path="/settings" element={<SettingsPage {...settingsProps} />} />
            <Route path="/widget-clients" element={<WidgetClients {...pageProps} />} />
            <Route path="/widget-clients/:id" element={<WidgetClientDetail {...pageProps} />} />
            <Route path="*" element={<DashboardPage {...pageProps} />} />
          </Routes>
        </main>
      </div>
      <ToastStack items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
