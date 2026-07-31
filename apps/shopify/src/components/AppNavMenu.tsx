import { Navigation } from '@shopify/polaris';
import { HomeIcon, ProductIcon, QuestionCircleIcon } from '@shopify/polaris-icons';
import { useLocation, useNavigate } from 'react-router-dom';

// Must match BrowserRouter's basename in main.tsx. <ui-nav-menu> hands its
// hrefs to Shopify admin, which navigates the iframe to that exact path — a
// bare "/manage" would land outside the app's base in production.
const BASENAME = import.meta.env.PROD ? '/shopify-admin' : '';

const ITEMS = [
  { path: '/', label: 'Dashboard', icon: HomeIcon },
  { path: '/manage', label: 'Manage', icon: ProductIcon },
  { path: '/support', label: 'Support', icon: QuestionCircleIcon },
];

export function AppNavMenu() {
  const navigate = useNavigate();
  const location = useLocation();

  // window.shopify is only defined inside the Shopify admin iframe
  // (see lib/appBridge.ts). Outside it, <ui-nav-menu> renders nothing at all,
  // which would leave local dev with no way to change page.
  if (!window.shopify) {
    return (
      <Navigation location={location.pathname}>
        <Navigation.Section
          title="AiVastra (dev)"
          items={ITEMS.map((item) => ({
            label: item.label,
            icon: item.icon,
            url: item.path,
            selected: location.pathname === item.path,
            onClick: () => navigate(item.path),
          }))}
        />
      </Navigation>
    );
  }

  return (
    <ui-nav-menu>
      {/* Shopify requires the first child to be the app's home link and ignores
          its label, but it must still be present or the menu does not render. */}
      <a href={`${BASENAME}/`} rel="home">
        Dashboard
      </a>
      {ITEMS.slice(1).map((item) => (
        <a
          key={item.path}
          href={`${BASENAME}${item.path}`}
          onClick={(e) => {
            // Let Shopify keep the admin URL in sync, but do the actual route
            // change in-app — a real navigation would reload the iframe and
            // re-run the App Bridge handshake on every nav click.
            e.preventDefault();
            navigate(item.path);
          }}
        >
          {item.label}
        </a>
      ))}
    </ui-nav-menu>
  );
}
