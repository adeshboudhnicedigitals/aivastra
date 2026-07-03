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

interface NavGroup {
  label: string;
  items: NavItem[];
}

const groups: NavGroup[] = [
  {
    label: '',
    items: [
      {
        k: 'dashboard',
        label: 'Dashboard',
        icon: Icon.Dashboard,
        roles: ['SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ADMIN'],
      },
    ],
  },
  {
    label: 'Content',
    items: [
      {
        k: 'assets',
        label: 'Assets',
        icon: Icon.Image,
        roles: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN'],
      },
      {
        k: 'workflows',
        label: 'Workflows',
        icon: Icon.Workflow,
        roles: ['SUPER_ADMIN', 'MODERATOR'],
      },
      {
        k: 'tryon',
        label: 'Try-on',
        icon: Icon.Replace,
        roles: ['SUPER_ADMIN', 'MODERATOR'],
      },
      {
        k: 'saree',
        label: 'Saree',
        icon: Icon.Workflow,
        roles: ['SUPER_ADMIN', 'MODERATOR'],
      },
    ],
  },
  {
    label: 'Clients',
    items: [
      {
        k: 'widget-clients',
        label: 'Widget Clients',
        icon: Icon.Monitor,
        roles: ['SUPER_ADMIN', 'ADMIN'],
      },
      {
        k: 'users',
        label: 'Users',
        icon: Icon.Users,
        roles: ['SUPER_ADMIN', 'SUPPORT', 'ADMIN'],
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        k: 'jobs',
        label: 'Jobs',
        icon: Icon.Jobs,
        roles: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN'],
      },
      {
        k: 'workers',
        label: 'Workers',
        icon: Icon.Server,
        roles: ['SUPER_ADMIN'],
      },
      {
        k: 'recycle-bin',
        label: 'Recycle bin',
        icon: Icon.Trash,
        roles: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN'],
      },
    ],
  },
  {
    label: 'Sales & Support',
    items: [
      {
        k: 'contacts',
        label: 'Contacts',
        icon: Icon.Bell,
        roles: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN', 'SUPPORT'],
      },
    ],
  },
];

export function Sidebar({ page, onNav, role, collapsed, onToggleCollapse }: SidebarProps) {
  const { token } = useAuth();
  const [contactBadge, setContactBadge] = useState(0);

  useEffect(() => {
    if (!token) return;
    const fetchCount = () =>
      apiFetch<{ count: number }>('/admin/contact-requests/unread-count')
        .then(({ count }) => setContactBadge(count))
        .catch(() => {});
    void fetchCount();
    const t = setInterval(fetchCount, 5_000);
    return () => clearInterval(t);
  }, [token]);
  // Flat list for collapsed view; grouped for expanded view
  const allItems = groups.flatMap((g) => g.items);
  const visible = allItems.filter((item) => item.roles.includes(role));
  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((item) => item.roles.includes(role)) }))
    .filter((g) => g.items.length > 0);

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
              {/* biome-ignore lint/performance/noImgElement: admin panel */}
              <img
                className="collapsed-logo-icon--on"
                src={`${import.meta.env.BASE_URL}assets/logo.svg`}
                alt="Ai Vastra"
              />
              {/* biome-ignore lint/performance/noImgElement: admin panel */}
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
      </aside>
    );
  }

  return (
    <aside className="sidebar">
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
        <button
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
        >
          {/* biome-ignore lint/performance/noImgElement: admin panel */}
          <img
            src={`${import.meta.env.BASE_URL}assets/dock-to-right.svg`}
            alt="Collapse"
            style={{ width: 22, height: 22 }}
          />
        </button>
      </div>
      <nav>
        {visibleGroups.map((group) => (
          <div key={group.label || '__top__'}>
            {group.label && <div className="nav-label">{group.label}</div>}
            {group.items.map((item) => {
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
          </div>
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
    </aside>
  );
}
