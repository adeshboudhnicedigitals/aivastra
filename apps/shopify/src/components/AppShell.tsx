import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
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
          alignItems: 'center',
          gap: '4px',
          padding: '0 20px',
          height: '52px',
          borderBottom: '1px solid var(--p-color-border)',
          background: 'var(--p-color-bg-surface)',
        }}
      >
        <div
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '6px',
            marginRight: '16px',
            background:
              'linear-gradient(135deg, var(--p-color-bg-fill-brand), var(--p-color-bg-fill-brand-hover))',
          }}
        />
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              style={{
                display: 'flex',
                alignItems: 'center',
                height: '100%',
                padding: '0 14px',
                fontSize: '13.5px',
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--p-color-text)' : 'var(--p-color-text-secondary)',
                textDecoration: 'none',
                borderBottom: active
                  ? '2px solid var(--p-color-border-brand)'
                  : '2px solid transparent',
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
