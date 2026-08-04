import '@shopify/polaris/build/esm/styles.css';
import { AppProvider, Banner, Box, Frame, Navigation, Spinner } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppNavMenu, NAV_ITEMS } from './components/AppNavMenu';
import { LinkAccountGate } from './components/LinkAccountGate';
import { ApiError, apiFetch, redirectToShopifyAuth, setShopDomain } from './lib/api';
import {
  AppBridgeTimeoutError,
  clearForbiddenRedirectMarker,
  clearRecoveryReloadMarker,
  shouldAttemptForbiddenRedirect,
  shouldAttemptRecoveryReload,
} from './lib/appBridge';
import { runNavGuard } from './lib/navGuard';
import AnalyticsPage from './pages/AnalyticsPage';
import DashboardPage from './pages/DashboardPage';
import ManagePage from './pages/ManagePage';
import SettingsPage from './pages/SettingsPage';
import SupportPage from './pages/SupportPage';
import WidgetDesignPage from './pages/WidgetDesignPage';
import type { ShopifyMe } from './types';

export default function App() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then((res) => {
        clearRecoveryReloadMarker();
        clearForbiddenRedirectMarker();
        setShopDomain(res.store.shopDomain);
        setMe(res);
        setLoading(false);
      })
      .catch((err) => {
        // A wedged App Bridge instance can't be recovered by retrying the call
        // in place — only a fresh document gets a fresh instance. Do that once
        // automatically so the merchant never sees an error for what is a
        // transient Shopify-side hang.
        if (err instanceof AppBridgeTimeoutError && shouldAttemptRecoveryReload()) {
          window.location.reload();
          return; // Keep the spinner up; this document is being replaced.
        }
        // requireShopifySession's only 403 is "Store not installed" — the
        // shop has no shopifyStores row yet, so there's no currentShopDomain
        // to key off. This is the path a fresh install (and Shopify's
        // automated app-review install check) takes on first load: begin
        // OAuth instead of showing an error banner. Gated the same way as the
        // reload above (one attempt per session): if OAuth completes and we
        // land back here still FORBIDDEN, redirecting again would loop the
        // merchant through OAuth forever with no visible error, so fall
        // through to the error banner instead.
        if (err instanceof ApiError && err.code === 'FORBIDDEN') {
          const shop = new URLSearchParams(window.location.search).get('shop');
          if (shop && shouldAttemptForbiddenRedirect()) {
            redirectToShopifyAuth(shop);
            return; // Keep the spinner up; top-level navigation is underway.
          }
        }
        setError((err as Error).message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <AppProvider i18n={{}}>
        <Spinner accessibilityLabel="Loading" size="large" />
      </AppProvider>
    );
  }

  if (error) {
    return (
      <AppProvider i18n={{}}>
        <Box padding="800">
          <Banner
            title="Couldn't load AiVastra"
            tone="critical"
            // A full reload, not load(): if App Bridge is the thing that's
            // wedged, re-running the same call in place hangs again.
            action={{ content: 'Retry', onAction: () => window.location.reload() }}
          >
            {error}
          </Banner>
        </Box>
      </AppProvider>
    );
  }

  if (!me?.store.ownerUserId) {
    return (
      <AppProvider i18n={{}}>
        <LinkAccountGate onLinked={load} />
      </AppProvider>
    );
  }

  // window.shopify is only defined inside the Shopify admin iframe (see
  // lib/appBridge.ts). Outside it, <ui-nav-menu> renders nothing, so Frame's
  // own `navigation` prop supplies a usable dev nav instead — Polaris's
  // <Navigation> requires a <Frame> ancestor providing frame context, which
  // it only gets by being passed in here rather than rendered as a sibling.
  // When App Bridge IS present, <ui-nav-menu> (real Shopify nav) handles
  // navigation natively, so no `navigation` prop is passed at all.
  const devNavigation = !window.shopify ? (
    <Navigation location={location.pathname}>
      <Navigation.Section
        title="AiVastra (dev)"
        items={NAV_ITEMS.map((item) => ({
          label: item.label,
          icon: item.icon,
          // Deliberately omit `url`: Polaris renders URL items as anchors and
          // navigates after onClick, even when the guard rejects the attempt.
          selected: location.pathname === item.path,
          onClick: () => {
            if (runNavGuard()) navigate(item.path);
          },
        }))}
      />
    </Navigation>
  ) : undefined;

  return (
    <AppProvider i18n={{}}>
      <AppNavMenu />
      <Frame navigation={devNavigation}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/manage" element={<ManagePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/widget-design" element={<WidgetDesignPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/support" element={<SupportPage />} />
          {/* Merchants may have bookmarked the old path while it was the only
              product surface. */}
          <Route path="/products" element={<Navigate to="/manage" replace />} />
          <Route path="/embedded" element={<Navigate to="/" replace />} />
        </Routes>
      </Frame>
    </AppProvider>
  );
}
