import { Icon } from './Icons';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  page: string;
  onNav: (page: string) => void;
  role: string;
}

interface NavItem {
  k: string;
  label: string;
  icon: () => JSX.Element;
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

export function Sidebar({ page, onNav, role }: SidebarProps) {
  const { email } = useAuth();
  const visible = items.filter((item) => item.roles.includes(role));

  const emailUser = email ? email.split('@')[0] : 'Admin';
  const initials = emailUser.slice(0, 2).toUpperCase();
  const displayEmail = email ?? '';

  const showSettings = ['SUPER_ADMIN'].includes(role);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">A</span>
        <span className="brand-word">aivastra</span>
        <span className="brand-sub">admin</span>
      </div>
      <nav>
        <div className="nav-label">Operate</div>
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
