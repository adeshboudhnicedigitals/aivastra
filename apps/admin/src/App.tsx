import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { ToastStack } from './components/ToastStack';
import { Topbar } from './components/Topbar';
import { useAuth } from './context/AuthContext';
import AssetsPage from './pages/AssetsPage';
import DashboardPage from './pages/DashboardPage';
import JobsPage from './pages/JobsPage';
import LoginPage from './pages/LoginPage';
import RecycleBinPage from './pages/RecycleBinPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import WorkflowsPage from './pages/WorkflowsPage';
import type { ToastItem } from './types';

type Theme = 'light' | 'dark';

const PATH_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  assets: 'Assets',
  users: 'Users',
  jobs: 'Jobs',
  workflows: 'Workflows',
  'recycle-bin': 'Recycle bin',
  settings: 'Settings',
};

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return (localStorage.getItem('aivastra-theme') as Theme) || 'dark';
}

export default function App() {
  const { token, role, isLoading } = useAuth();
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const idRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();

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
  const settingsProps = { onNav: handleNavWithFilter, toast, theme, onToggleTheme: toggleTheme };

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
        <Topbar trail={trail} onNavTrail={(i) => i === 0 && navigate('/dashboard')} />
        <main className="content">
          <Routes>
            <Route path="/" element={<DashboardPage {...pageProps} />} />
            <Route path="/dashboard" element={<DashboardPage {...pageProps} />} />
            <Route path="/assets" element={<AssetsPage {...pageProps} />} />
            <Route path="/users" element={<UsersPage {...pageProps} />} />
            <Route path="/jobs" element={<JobsPage {...pageProps} />} />
            <Route path="/workflows" element={<WorkflowsPage {...pageProps} />} />
            <Route path="/recycle-bin" element={<RecycleBinPage {...pageProps} />} />
            <Route path="/settings" element={<SettingsPage {...settingsProps} />} />
            <Route path="*" element={<DashboardPage {...pageProps} />} />
          </Routes>
        </main>
      </div>
      <ToastStack items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
