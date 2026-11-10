import type { CSSProperties } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import designBg from '../assets/design-bg.jpg';
import { runNavGuard } from '../lib/navGuard';
import type { ShopifyMe } from '../types';
import { NAV_ITEMS } from './AppNavMenu';
import { BrandHeader } from './BrandHeader';

/**
 * Layout route for every page outside the onboarding wizard: branded header
 * with the store chip, then the pill tabs, then the page itself. The tabs are
 * hidden mid-onboarding, for the same reason the Shopify admin nav is (see
 * AppNavMenu) -- every one of them would just bounce back to the wizard.
 */
// Pages laid out to fit one screen (no page scroll). Manage's long lists scroll
// inside their own card instead.
const FIT_PATHS = ['/', '/manage', '/pricing'];

export function AppChrome({ me, showNav }: { me: ShopifyMe; showNav: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const shop = me.store.shopDomain;
  const storeName = shop.replace(/\.myshopify\.com$/, '');

  return (
    <div
      className={`av-page${FIT_PATHS.includes(location.pathname) ? ' fit' : ''}`}
      style={{ '--av-bg': `url(${designBg})` } as CSSProperties}
    >
      <BrandHeader
        right={
          <span className="av-store">
            <i aria-hidden>{storeName.charAt(0).toUpperCase()}</i>
            {storeName}
          </span>
        }
      />
      {showNav && (
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
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
      <div className="av-body">
        <Outlet />
      </div>
    </div>
  );
}
