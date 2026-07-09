import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/billing', label: 'Billing' },
  { to: '/products', label: 'Products' },
  { to: '/funnel-setup', label: 'Funnel Setup' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div>
      <nav
        style={{
          display: 'flex',
          gap: '16px',
          padding: '12px 20px',
          borderBottom: '1px solid #e1e3e5',
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              style={{
                fontWeight: active ? 700 : 400,
                textDecoration: active ? 'underline' : 'none',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
