import type { ReactElement } from 'react';
import { Icon } from './Icons';
import { useAuth } from '../context/AuthContext';

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
  { k: 'dashboard', label: 'Dashboard', icon: Icon.Dashboard, roles: ['SUPER_ADMIN', 'MODERATOR', 'SUPPORT'] },
  { k: 'assets', label: 'Assets', icon: Icon.Image, roles: ['SUPER_ADMIN', 'MODERATOR'] },
  { k: 'catalog', label: 'Catalog', icon: Icon.Catalog, roles: ['SUPER_ADMIN', 'MODERATOR'] },
  { k: 'users', label: 'Users', icon: Icon.Users, roles: ['SUPER_ADMIN', 'SUPPORT'] },
  { k: 'jobs', label: 'Jobs', icon: Icon.Jobs, roles: ['SUPER_ADMIN', 'MODERATOR'] },
  { k: 'credits', label: 'Credit Requests', icon: Icon.Credit, roles: ['SUPER_ADMIN', 'MODERATOR'] },
];

const CollapseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M9 3v18"/>
  </svg>
);

export function Sidebar({ page, onNav, role, collapsed, onToggleCollapse }: SidebarProps) {
  const { email } = useAuth();
  const visible = items.filter((item) => item.roles.includes(role));

  const emailUser = email ? email.split('@')[0] : 'Admin';
  const initials = emailUser.slice(0, 2).toUpperCase();
  const displayEmail = email ?? '';
  const showSettings = ['SUPER_ADMIN'].includes(role);

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed" onClick={onToggleCollapse} style={{ cursor: 'pointer' }}>
        <div className="brand brand--collapsed">
          <button className="brand-mark brand-mark--logo" onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }} title="Expand sidebar">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Ai Vastra" />
          </button>
        </div>
        <nav>
          {visible.map((item) => (
            <button
              key={item.k}
              className={`nav-item nav-item--icon ${item.alert ? 'alert' : ''} ${page === item.k ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onNav(item.k); }}
              title={item.label}
            >
              <item.icon />
              {item.count !== undefined && <span className="count">{item.count}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        {showSettings && (
          <button
            className={`nav-item nav-item--icon ${page === 'settings' ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onNav('settings'); }}
            title="Settings"
          >
            <Icon.Settings />
          </button>
        )}
        <div className="sidebar-foot sidebar-foot--collapsed">
          <span className="avatar" title={displayEmail}>{initials}</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark brand-mark--logo">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Ai Vastra" />
        </span>
        <span className="brand-word">aivastra</span>
        <span className="brand-sub">admin</span>
        <button className="sidebar-collapse-btn" onClick={onToggleCollapse} title="Collapse sidebar">
          <CollapseIcon />
        </button>
      </div>
      <nav>
        {visible.map((item) => (
          <button
            key={item.k}
            className={`nav-item ${item.alert ? 'alert' : ''} ${page === item.k ? 'active' : ''}`}
            onClick={() => onNav(item.k)}
          >
            {<item.icon />}
            <span>{item.label}</span>
            {item.count !== undefined && <span className="count">{item.count}</span>}
          </button>
        ))}
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
