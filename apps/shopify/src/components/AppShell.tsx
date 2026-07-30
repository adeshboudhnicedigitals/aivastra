import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BRAND, FONT_STACK } from '../theme';
import { ChevronDownIcon, DashboardIcon, ProductsIcon } from './icons';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: DashboardIcon },
  { to: '/products', label: 'Products', icon: ProductsIcon },
];

export function AppShell({ children, shopDomain }: { children: ReactNode; shopDomain: string }) {
  const location = useLocation();

  return (
    <div
      style={{ minHeight: '100vh', background: BRAND.bg, fontFamily: FONT_STACK, color: BRAND.ink }}
    >
      <div
        style={{
          background: BRAND.card,
          borderBottom: `1px solid ${BRAND.border}`,
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '64px',
          position: 'sticky',
          top: 0,
          zIndex: 20,
          boxSizing: 'border-box',
        }}
      >
        {/* Empty spacer mirrors the nav pill's own width on the right (shop
            domain chip) so the nav stays visually centered without a logo. */}
        <div style={{ width: '180px' }} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            background: '#F7F6FA',
            padding: '4px',
            borderRadius: '12px',
          }}
        >
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  height: '36px',
                  padding: '0 14px',
                  borderRadius: '9px',
                  background: active ? BRAND.purpleTint : 'transparent',
                  color: active ? BRAND.purpleDark : BRAND.textMuted,
                  fontSize: '13.5px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  cursor: active ? 'default' : 'pointer',
                }}
              >
                <Icon size={16} color="currentColor" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            border: `1px solid ${BRAND.borderStrong}`,
            borderRadius: '10px',
            padding: '6px 10px 6px 12px',
            fontSize: '13px',
            color: BRAND.inkSoft,
            background: '#fff',
          }}
        >
          <span>{shopDomain}</span>
          <span
            style={{
              background: BRAND.successBg,
              color: BRAND.successText,
              fontSize: '11px',
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: '999px',
            }}
          >
            Connected
          </span>
          <ChevronDownIcon size={13} color={BRAND.textPlaceholder} />
        </div>
      </div>

      <div
        style={{
          maxWidth: '1180px',
          margin: '0 auto',
          padding: '32px 32px 80px',
          boxSizing: 'border-box',
        }}
      >
        {children}
      </div>
    </div>
  );
}
