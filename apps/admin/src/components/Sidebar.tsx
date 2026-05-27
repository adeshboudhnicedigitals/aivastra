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
  { k: 'workflows', label: 'Workflows', icon: Icon.Workflow, roles: ['SUPER_ADMIN', 'MODERATOR'] },
  { k: 'users', label: 'Users', icon: Icon.Users, roles: ['SUPER_ADMIN', 'SUPPORT'] },
  { k: 'jobs', label: 'Jobs', icon: Icon.Jobs, roles: ['SUPER_ADMIN', 'MODERATOR'] },
];

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
            <span className="collapsed-logo-icon">
              <img className="collapsed-logo-icon--on" src={`${import.meta.env.BASE_URL}assets/logo.svg`} alt="Ai Vastra" />
              <img className="collapsed-logo-icon--off" src={`${import.meta.env.BASE_URL}assets/dock-to-right.svg`} alt="Expand" />
            </span>
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
          <img src={`${import.meta.env.BASE_URL}assets/logo.svg`} alt="Ai Vastra" />
        </span>
        <img className="brand-word--logo" src={`${import.meta.env.BASE_URL}assets/logo-text.svg`} alt="Ai Vastra" />
        <button className="sidebar-collapse-btn" onClick={onToggleCollapse} title="Collapse sidebar">
          <img src={`${import.meta.env.BASE_URL}assets/dock-to-right.svg`} alt="Collapse" style={{ width: 22, height: 22 }} />
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
