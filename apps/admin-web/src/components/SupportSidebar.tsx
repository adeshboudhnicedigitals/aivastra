import type { ReactElement } from 'react';
import { useAuth } from '../context/AuthContext';
import { Icon } from './Icons';

// A dedicated left nav for the Support app, styled like the real admin
// Sidebar (same .sidebar/.nav-item classes) but scoped to Support's own
// four sections — not a reuse of Sidebar.tsx's full admin nav tree, since
// Support is meant to stand on its own, eventually as a separate app.

export type SupportPage = 'dashboard' | 'tickets' | 'jobs' | 'users';

const ITEMS: Array<{ k: SupportPage; label: string; icon: () => ReactElement }> = [
  { k: 'dashboard', label: 'Dashboard', icon: Icon.Dashboard },
  { k: 'tickets', label: 'Tickets', icon: Icon.MessageSquare },
  { k: 'jobs', label: 'Jobs', icon: Icon.Jobs },
  { k: 'users', label: 'Users', icon: Icon.Users },
];

interface Props {
  page: SupportPage;
  onNav: (page: SupportPage) => void;
  onExit: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function SupportSidebar({ page, onNav, onExit, mobileOpen, onCloseMobile }: Props) {
  const { logout } = useAuth();

  return (
    <aside className={`sidebar${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
      <div className="brand">
        <span className="brand-mark brand-mark--logo">
          {/* biome-ignore lint/performance/noImgElement: admin panel */}
          <img src={`${import.meta.env.BASE_URL}assets/logo.svg`} alt="Ai Vastra" />
        </span>
        {/* biome-ignore lint/performance/noImgElement: admin panel */}
        <img
          className="brand-word--logo"
          src={`${import.meta.env.BASE_URL}assets/logo-text.svg`}
          alt="Ai Vastra"
        />
      </div>
      <div className="nav-label">Support</div>
      <nav>
        {ITEMS.map((item) => (
          <button
            key={item.k}
            className={`nav-item ${page === item.k ? 'active' : ''}`}
            onClick={() => {
              onNav(item.k);
              onCloseMobile();
            }}
          >
            <item.icon />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <button className="nav-item" onClick={onExit}>
        <Icon.Back />
        <span>Back to Admin</span>
      </button>
      <button className="nav-item" onClick={() => void logout()}>
        <Icon.Logout />
        <span>Log out</span>
      </button>
    </aside>
  );
}
