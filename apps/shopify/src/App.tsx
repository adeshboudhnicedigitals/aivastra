import '@shopify/polaris/build/esm/styles.css';
import './theme.css';
import { AppProvider, Banner, Box, Frame, Spinner } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppNavMenu } from './components/AppNavMenu';
import { LinkAccountGate } from './components/LinkAccountGate';
import { apiFetch, setShopDomain } from './lib/api';
import {
  AppBridgeTimeoutError,
  clearRecoveryReloadMarker,
  shouldAttemptRecoveryReload,
} from './lib/appBridge';
import DashboardPage from './pages/DashboardPage';
import ManagePage from './pages/ManagePage';
import SupportPage from './pages/SupportPage';
import type { ShopifyMe } from './types';

export default function App() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <AppProvider i18n={{}}>
      <AppNavMenu />
      <Frame>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/manage" element={<ManagePage />} />
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
