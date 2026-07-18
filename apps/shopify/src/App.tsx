import '@shopify/polaris/build/esm/styles.css';
import './theme.css';
import { AppProvider, Spinner } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LinkAccountGate } from './components/LinkAccountGate';
import { apiFetch, setShopDomain } from './lib/api';
import CatalogGeneratePage from './pages/CatalogGeneratePage';
import DashboardPage from './pages/DashboardPage';
import FunnelSetupPage from './pages/FunnelSetupPage';
import GeneratedImagesPage from './pages/GeneratedImagesPage';
import ProductsPage from './pages/ProductsPage';
import type { ShopifyMe } from './types';

export default function App() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then((res) => {
        setShopDomain(res.store.shopDomain);
        setMe(res);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) {
    return (
      <AppProvider i18n={{}}>
        <Spinner accessibilityLabel="Loading" size="large" />
      </AppProvider>
    );
  }

  if (!me?.store.ownerUserId) {
    return (
      <AppProvider i18n={{}}>
        <LinkAccountGate onLinked={reload} />
      </AppProvider>
    );
  }

  return (
    <AppProvider i18n={{}}>
      <AppShell shopDomain={me.store.shopDomain}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/funnel-setup" element={<FunnelSetupPage />} />
          <Route path="/catalog-generate" element={<CatalogGeneratePage />} />
          <Route path="/generated-images" element={<GeneratedImagesPage />} />
          <Route path="/embedded" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </AppProvider>
  );
}
