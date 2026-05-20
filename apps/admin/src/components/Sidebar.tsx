import { Icon } from './Icons';

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
  { k: 'models', label: 'Models', icon: Icon.Image, roles: ['SUPER_ADMIN', 'MODERATOR'] },
  { k: 'catalog', label: 'Catalog', icon: Icon.Catalog, roles: ['SUPER_ADMIN', 'MODERATOR'] },
  { k: 'users', label: 'Users', icon: Icon.Users, roles: ['SUPER_ADMIN', 'SUPPORT'], count: 12 },
  { k: 'jobs', label: 'Jobs', icon: Icon.Jobs, roles: ['SUPER_ADMIN', 'MODERATOR'], count: 23, alert: true },
  { k: 'settings', label: 'Settings', icon: Icon.Settings, roles: ['SUPER_ADMIN'] },
];

export function Sidebar({ page, onNav, role }: SidebarProps) {
  const visible = items.filter((item) => item.roles.includes(role));

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
      <div className="sidebar-foot">
        <span className="avatar">RM</span>
        <div className="who">
          <b>Rohan Mehta</b>
          <span>rohan@aivastra</span>
        </div>
        <span className="role-pill">{role}</span>
      </div>
    </aside>
  );
}
