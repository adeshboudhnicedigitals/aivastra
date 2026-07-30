import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { SIDEBAR_DRAWER_ID, useSidebarContext } from '../context/SidebarContext';
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
        k: 'dev-api',
        label: 'Dev API',
        icon: Icon.Workflow,
        roles: ['SUPER_ADMIN', 'MODERATOR'],
      },
      {
        k: 'saree',
        label: 'Saree',
        icon: Icon.Workflow,
        roles: ['SUPER_ADMIN', 'MODERATOR'],
      },
      {
        k: 'shopify-funnels',
        label: 'Shopify',
        icon: Icon.Workflow,
        roles: ['SUPER_ADMIN', 'MODERATOR'],
      },
    ],
  },
  {
    label: 'Clients',
    items: [
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
      {
        k: 'credit-analysis',
        label: 'Credit Analysis',
        icon: Icon.Coin,
        roles: ['SUPER_ADMIN', 'SUPPORT', 'ADMIN'],
      },
    ],
  },
  {
    label: 'Sales & Support',
    items: [
      {
        k: 'chat-inbox',
        label: 'Chat Inbox',
        icon: Icon.MessageSquare,
        roles: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN', 'SUPPORT'],
      },
      {
        k: 'contacts',
        label: 'Contacts',
        icon: Icon.Bell,
        roles: ['SUPER_ADMIN', 'MODERATOR', 'ADMIN', 'SUPPORT'],
      },
      {
        k: 'chatbot-qna',
        label: 'Chatbot Q&A',
        icon: Icon.MessageSquare,
        roles: ['SUPER_ADMIN', 'ADMIN'],
      },
    ],
  },
];

export function Sidebar({ page, onNav, role, collapsed, onToggleCollapse }: SidebarProps) {
  const { token } = useAuth();
  const { isDrawerMode, isOpen, close } = useSidebarContext();
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

  const allItems = groups.flatMap((g) => g.items);
  const visible = allItems.filter((item) => item.roles.includes(role));
  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((item) => item.roles.includes(role)) }))
    .filter((g) => g.items.length > 0);

  const showSettings = ['SUPER_ADMIN'].includes(role);

  function handleNav(k: string) {
    onNav(k);
    if (isDrawerMode) close();
  }

  const sidebarContent = (
    <aside
      className={`sidebar${collapsed && !isDrawerMode ? ' sidebar--collapsed' : ''}`}
      style={isDrawerMode ? { height: '100%', borderRight: 'none' } : undefined}
    >
      {collapsed && !isDrawerMode ? (
        // Collapsed icon-only sidebar (desktop only)
        <>
          <div className="brand brand--collapsed">
            <button
              className="brand-mark brand-mark--logo"
              onClick={onToggleCollapse}
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
                  onClick={() => handleNav(item.k)}
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
              onClick={() => handleNav('settings')}
              title="Settings"
            >
              <Icon.Settings />
            </button>
          )}
        </>
      ) : (
        // Expanded sidebar
        <>
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
            {!isDrawerMode && (
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
            )}
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
                      onClick={() => handleNav(item.k)}
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
              onClick={() => handleNav('settings')}
            >
              <Icon.Settings />
              <span>Settings</span>
            </button>
          )}
        </>
      )}
    </aside>
  );

  if (isDrawerMode) {
    return createPortal(
      <>
        {/* Backdrop — always mounted, opacity-toggled for smooth animation */}
        <div
          aria-hidden="true"
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 1300,
            opacity: isOpen ? 1 : 0,
            pointerEvents: isOpen ? 'auto' : 'none',
            transition: 'opacity 180ms ease',
          }}
        />
        {/* Drawer Panel container */}
        <div
          id={SIDEBAR_DRAWER_ID}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            height: '100dvh',
            width: 240,
            zIndex: 1301,
            transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
            opacity: isOpen ? 1 : 0,
            pointerEvents: isOpen ? 'auto' : 'none',
            transition: 'transform 180ms ease, opacity 180ms ease',
            boxShadow: isOpen ? 'var(--shadow-lg)' : 'none',
          }}
        >
          {sidebarContent}
        </div>
      </>,
      document.body,
    );
  }

  return sidebarContent;
}
