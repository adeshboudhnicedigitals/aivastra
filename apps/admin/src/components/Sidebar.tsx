import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/data';
import { Icon } from './Icons';

interface SidebarProps {
  page: string;
  onNav: (page: string) => void;
  role: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  k: string;
  label: string;
  icon: () => ReactElement;
  roles: string[];
  count?: number;
  alert?: boolean;
}

const items: NavItem[] = [
  {
    k: 'dashboard',
    label: 'Dashboard',
    icon: Icon.Dashboard,
    roles: ['SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ADMIN'],
  },
  { k: 'assets', label: 'Assets', icon: Icon.Image, roles: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN'] },
  {
    k: 'widget-clients',
    label: 'Widget Clients',
    icon: Icon.Users,
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },
  { k: 'workflows', label: 'Workflows', icon: Icon.Workflow, roles: ['SUPER_ADMIN', 'MODERATOR'] },
  { k: 'tryon', label: 'Tryon', icon: Icon.Workflow, roles: ['SUPER_ADMIN', 'MODERATOR'] },
  {
    k: 'contacts',
    label: 'Contacts',
    icon: Icon.Bell,
    roles: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN', 'SUPPORT'],
  },
  { k: 'users', label: 'Users', icon: Icon.Users, roles: ['SUPER_ADMIN', 'SUPPORT', 'ADMIN'] },
  { k: 'jobs', label: 'Jobs', icon: Icon.Jobs, roles: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN'] },
  { k: 'workers', label: 'Workers', icon: Icon.Server, roles: ['SUPER_ADMIN'] },
  {
    k: 'recycle-bin',
    label: 'Recycle bin',
    icon: Icon.Trash,
    roles: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN'],
  },
];

export function Sidebar({ page, onNav, role, collapsed, onToggleCollapse }: SidebarProps) {
  const { email, token } = useAuth();
  const [contactBadge, setContactBadge] = useState(0);

  useEffect(() => {
    if (!token) return;
    const fetchCount = () =>
      apiFetch<{ count: number }>('/admin/contact-requests/unread-count')
        .then(({ count }) => setContactBadge(count))
        .catch(() => {});
    void fetchCount();
    const t = setInterval(fetchCount, 30_000);
    return () => clearInterval(t);
  }, [token]);
  const visible = items.filter((item) => item.roles.includes(role));

  const emailUser = email ? email.split('@')[0] : 'Admin';
  const initials = emailUser.slice(0, 2).toUpperCase();
  const displayEmail = email ?? '';
  const showSettings = ['SUPER_ADMIN'].includes(role);

  if (collapsed) {
    return (
      <aside
        className="sidebar sidebar--collapsed"
        onClick={onToggleCollapse}
        style={{ cursor: 'pointer' }}
      >
        <div className="brand brand--collapsed">
          <button
            className="brand-mark brand-mark--logo"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            title="Expand sidebar"
          >
            <span className="collapsed-logo-icon">
              <img
                className="collapsed-logo-icon--on"
                src={`${import.meta.env.BASE_URL}assets/logo.svg`}
                alt="Ai Vastra"
              />
              <img
                className="collapsed-logo-icon--off"
                src={`${import.meta.env.BASE_URL}assets/dock-to-right.svg`}
                alt="Expand"
              />
            </span>
          </button>
        </div>
        <nav>
          {visible.map((item) => {
            const badge = item.k === 'contacts' ? contactBadge : (item.count ?? 0);
            return (
              <button
                key={item.k}
                className={`nav-item nav-item--icon ${item.alert || (item.k === 'contacts' && contactBadge > 0) ? 'alert' : ''} ${page === item.k ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onNav(item.k);
                }}
                title={item.label}
              >
                <item.icon />
                {badge > 0 && <span className="count">{badge}</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-spacer" />
        {showSettings && (
          <button
            className={`nav-item nav-item--icon ${page === 'settings' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onNav('settings');
            }}
            title="Settings"
          >
            <Icon.Settings />
          </button>
        )}
        <div className="sidebar-foot sidebar-foot--collapsed">
          <span className="avatar" title={displayEmail}>
            {initials}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark brand-mark--logo">
          <img src={`${import.meta.env.BASE_URL}assets/logo.svg`} alt="Ai Vastra" />
        </span>
        <img
          className="brand-word--logo"
          src={`${import.meta.env.BASE_URL}assets/logo-text.svg`}
          alt="Ai Vastra"
        />
        <button
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
        >
          <img
            src={`${import.meta.env.BASE_URL}assets/dock-to-right.svg`}
            alt="Collapse"
            style={{ width: 22, height: 22 }}
          />
        </button>
      </div>
      <nav>
        {visible.map((item) => {
          const badge = item.k === 'contacts' ? contactBadge : (item.count ?? 0);
          return (
            <button
              key={item.k}
              className={`nav-item ${item.alert || (item.k === 'contacts' && contactBadge > 0) ? 'alert' : ''} ${page === item.k ? 'active' : ''}`}
              onClick={() => onNav(item.k)}
            >
              <item.icon />
              <span>{item.label}</span>
              {badge > 0 && <span className="count">{badge}</span>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-spacer" />
      {showSettings && (
        <button
          className={`nav-item ${page === 'settings' ? 'active' : ''}`}
          onClick={() => onNav('settings')}
        >
          <Icon.Settings />
          <span>Settings</span>
        </button>
      )}
      <div className="sidebar-foot">
        <span className="avatar">{initials}</span>
        <div className="who">
          <b>{emailUser}</b>
          <span>{displayEmail}</span>
          <span className="role-pill">{role}</span>
        </div>
      </div>
    </aside>
  );
}
