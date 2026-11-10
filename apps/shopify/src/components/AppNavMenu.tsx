import { CashDollarIcon, HomeIcon, SettingsIcon } from '@shopify/polaris-icons';
import { useNavigate } from 'react-router-dom';
import { runNavGuard } from '../lib/navGuard';

// Must match BrowserRouter's basename in main.tsx. <ui-nav-menu> hands its
// hrefs to Shopify admin, which navigates the iframe to that exact path — a
// bare "/manage" would land outside the app's base in production.
const BASENAME = import.meta.env.PROD ? '/shopify-admin' : '';

// Support is deliberately not here: it lives behind the header's Help & Support
// button (AppChrome) and stays routable at /support.
export const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: HomeIcon },
  { path: '/pricing', label: 'Billing', icon: CashDollarIcon },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function AppNavMenu({ onboardingComplete }: { onboardingComplete: boolean }) {
  const navigate = useNavigate();

  // window.shopify is only defined inside the Shopify admin iframe
  // (see lib/appBridge.ts). Outside it, <ui-nav-menu> renders nothing at all
  // — the dev-mode nav is supplied by App.tsx instead, via Frame's own
  // `navigation` prop (Polaris's <Navigation> requires a <Frame> ancestor
  // providing frame context, which a sibling render here cannot give it).
  // Also hidden while onboarding is incomplete — a merchant mid-wizard has
  // nowhere else to go yet, and nav items that just bounce back to the
  // wizard would be confusing.
  if (!window.shopify || !onboardingComplete) {
    return null;
  }

  return (
    <ui-nav-menu>
      {/* Shopify requires the first child to be the app's home link and ignores
          its label, but it must still be present or the menu does not render. */}
      <a
        href={`${BASENAME}/`}
        rel="home"
        onClick={(e) => {
          e.preventDefault();
          if (runNavGuard()) navigate('/');
        }}
      >
        Dashboard
      </a>
      {NAV_ITEMS.slice(1).map((item) => (
        <a
          key={item.path}
          href={`${BASENAME}${item.path}`}
          onClick={(e) => {
            // Let Shopify keep the admin URL in sync, but do the actual route
            // change in-app — a real navigation would reload the iframe and
            // re-run the App Bridge handshake on every nav click.
            e.preventDefault();
            if (runNavGuard()) navigate(item.path);
          }}
        >
          {item.label}
        </a>
      ))}
    </ui-nav-menu>
  );
}
