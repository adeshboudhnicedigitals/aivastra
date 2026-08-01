import '@shopify/polaris/build/esm/styles.css';
import { AppProvider, Banner, Box, Frame, Navigation, Spinner } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppNavMenu, NAV_ITEMS } from './components/AppNavMenu';
import { LinkAccountGate } from './components/LinkAccountGate';
import { apiFetch, setShopDomain } from './lib/api';
import {
  AppBridgeTimeoutError,
  clearRecoveryReloadMarker,
  shouldAttemptRecoveryReload,
} from './lib/appBridge';
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
          url: item.path,
          selected: location.pathname === item.path,
          onClick: () => navigate(item.path),
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
