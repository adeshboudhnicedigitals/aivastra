import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/data';
import { Icon } from './Icons';

export type Page = 'dashboard' | 'chat-inbox' | 'jobs' | 'users';

const ITEMS: Array<{ k: Page; label: string; icon: () => ReactElement }> = [
  { k: 'dashboard', label: 'Dashboard', icon: Icon.Dashboard },
  { k: 'chat-inbox', label: 'Chat Inbox', icon: Icon.MessageSquare },
  { k: 'jobs', label: 'Jobs', icon: Icon.Jobs },
  { k: 'users', label: 'Users', icon: Icon.Users },
];

interface Props {
  page: Page;
  onNav: (page: Page) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ page, onNav, mobileOpen, onCloseMobile }: Props) {
  const { token, logout } = useAuth();
  const [chatInboxBadge, setChatInboxBadge] = useState(0);

  // Unclaimed-ticket count, mirrored onto both Dashboard and Chat Inbox — same
  // "OPEN" queue ChatInboxPage itself lists, so the badge always matches what
  // claiming would show. Mirrors admin-web's Sidebar (Chat Inbox + Dashboard).
  // No dedicated count endpoint exists, so this reuses the list route and
  // counts rows.
  useEffect(() => {
    if (!token) return;
    const fetchCount = () =>
      apiFetch<{ rows: unknown[] }>('/admin/chatbot/conversations?status=OPEN')
        .then(({ rows }) => setChatInboxBadge(rows.length))
        .catch(() => {});
    void fetchCount();
    const t = setInterval(fetchCount, 5_000);
    return () => clearInterval(t);
  }, [token]);

  return (
    <aside className={`sidebar${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
      <div className="brand">
        <span className="brand-mark brand-mark--logo">
          {/* biome-ignore lint/performance/noImgElement: support panel */}
          <img src={`${import.meta.env.BASE_URL}assets/logo.svg`} alt="Ai Vastra" />
        </span>
        {/* biome-ignore lint/performance/noImgElement: support panel */}
        <img
          className="brand-word--logo"
          src={`${import.meta.env.BASE_URL}assets/logo-text.svg`}
          alt="Ai Vastra"
        />
      </div>
      <nav>
        {ITEMS.map((item) => {
          const badge = item.k === 'dashboard' || item.k === 'chat-inbox' ? chatInboxBadge : 0;
          return (
            <button
              key={item.k}
              className={`nav-item ${badge > 0 ? 'alert' : ''} ${page === item.k ? 'active' : ''}`}
              onClick={() => {
                onNav(item.k);
                onCloseMobile();
              }}
            >
              <item.icon />
              <span>{item.label}</span>
              {badge > 0 && <span className="count">{badge}</span>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-spacer" />
      <button className="nav-item" onClick={() => void logout()}>
        <Icon.Logout />
        <span>Log out</span>
      </button>
    </aside>
  );
}
