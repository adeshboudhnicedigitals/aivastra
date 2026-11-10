import { type ReactNode, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { runNavGuard } from '../lib/navGuard';
import type { ShopifyMe } from '../types';
import { NAV_ITEMS } from './AppNavMenu';
import { BrandHeader } from './BrandHeader';
import { Glyph } from './PageHead';
import { SupportModal } from './SupportModal';

const NAV_GLYPHS: Record<string, ReactNode> = {
  '/': <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9z" />,
  '/pricing': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  '/settings': (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="7.6" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </>
  ),
};

/**
 * Layout route for every page outside the onboarding wizard: one header bar
 * with the logo, the three section tabs, Help & Support and the store avatar,
 * then the page itself. The tabs are hidden mid-onboarding, for the same reason
 * the Shopify admin nav is (see AppNavMenu) -- every one of them would just
 * bounce back to the wizard.
 */
export function AppChrome({ me, showNav }: { me: ShopifyMe; showNav: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const storeName = me.store.shopDomain.replace(/\.myshopify\.com$/, '');

  return (
    <div className="av-page av-page-app">
      <BrandHeader
        compact
        center={
          showNav ? (
            <nav className="av-nav" aria-label="App sections">
              {NAV_ITEMS.map((item) => {
                const on = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`av-tab${on ? ' on' : ''}`}
                    aria-current={on ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      if (runNavGuard()) navigate(item.path);
                    }}
                  >
                    <Glyph size={24}>{NAV_GLYPHS[item.path]}</Glyph>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : undefined
        }
        right={
          <div className="av-hdr-right">
            <button type="button" className="av-help" onClick={() => setHelpOpen(true)}>
              <Glyph size={22}>
                <circle cx="12" cy="12" r="9.5" />
                <path d="M9.4 9.4a2.7 2.7 0 1 1 3.6 2.5c-.7.3-1 .8-1 1.6M12 17.2v.1" />
              </Glyph>
              <span>Help &amp; Support</span>
            </button>
            <span
              className="av-avatar"
              role="img"
              aria-label={`Store ${storeName}`}
              title={storeName}
            >
              {storeName.charAt(0).toUpperCase()}
            </span>
          </div>
        }
      />
      <div className="av-body">
        <Outlet />
      </div>
      <SupportModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
