import '@shopify/polaris/build/esm/styles.css';
import { AppProvider, Banner, Box, Frame, Navigation, Spinner } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppNavMenu, NAV_ITEMS } from './components/AppNavMenu';
import { apiFetch, setShopDomain } from './lib/api';
import {
  AppBridgeTimeoutError,
  clearRecoveryReloadMarker,
  shouldAttemptRecoveryReload,
} from './lib/appBridge';
import { type ClassifiedError, classifyError } from './lib/errors';
import { runNavGuard } from './lib/navGuard';
import { getOnboardingStep, onboardingPath } from './lib/onboarding';
import AnalyticsPage from './pages/AnalyticsPage';
import AutorefillCallbackPage from './pages/AutorefillCallbackPage';
import BillingCallbackPage from './pages/BillingCallbackPage';
import DashboardPage from './pages/DashboardPage';
import ManagePage from './pages/ManagePage';
import OnboardingIntroPage from './pages/OnboardingIntroPage';
import OnboardingProductsPage from './pages/OnboardingProductsPage';
import OnboardingRoutingPage from './pages/OnboardingRoutingPage';
import OnboardingThemePage from './pages/OnboardingThemePage';
import PricingPage from './pages/PricingPage';
import SettingsPage from './pages/SettingsPage';
import SupportPage from './pages/SupportPage';
import type { ShopifyMe } from './types';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [me, setMe] = useState<ShopifyMe | null>(null);
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
        const classified = classifyError(err);
        if (classified.code === 'SHOPIFY_REAUTH_REQUIRED') {
          return; // Keep the spinner up; apiFetch's top-level redirect is in flight.
        }
        setError(classified);
        setLoading(false);
      });
  }, []);

  // Onboarding pages call this (via the `onRefresh` prop passed to their
  // routes below) after an action that changes onboarding progress (sync,
  // confirm-routing, confirm-theme-block), before navigating to the next
  // step. Keeping exactly one `me` here — rather than letting each
  // onboarding page independently re-fetch its own copy — is what keeps the
  // gate effect below and each page's own step-order check from disagreeing
  // about where the merchant currently is.
  const refreshMe = useCallback(async () => {
    const res = await apiFetch<ShopifyMe>('/v1/shopify/me');
    setMe(res);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The onboarding hard gate. Coarse-grained on purpose: it only corrects
  // two violations — escaping to a non-onboarding route while incomplete,
  // and lingering under /onboarding once complete. It deliberately does NOT
  // try to force the exact current onboarding sub-route to match the exact
  // current step — each onboarding page already does that itself (via its
  // own getOnboardingStep check against this same `me`), and doing it here
  // too would double-guess a page's own just-completed, already-reflected-
  // in-`me` action the instant it calls navigate() to move to the next step.
  useEffect(() => {
    if (!me) return;
    const step = getOnboardingStep(me);
    const onOnboardingRoute = location.pathname.startsWith('/onboarding');
    if (step !== null && !onOnboardingRoute) {
      navigate(onboardingPath(step), { replace: true });
    } else if (step === null && onOnboardingRoute) {
      navigate('/', { replace: true });
    }
  }, [me, location.pathname, navigate]);

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
            tone={error.tone}
            action={{ content: 'Retry', onAction: () => window.location.reload() }}
          >
            {error.message}
          </Banner>
        </Box>
      </AppProvider>
    );
  }

  // load() sets `me` and `loading: false` together on success, and every
  // failure path above returns early while leaving `loading: true` — so by
  // the time both early returns above are behind us, `me` is always set.
  // This exists only so TypeScript can narrow it to non-null below.
  if (!me) {
    return null;
  }

  const onboardingStep = getOnboardingStep(me);
  const onboardingComplete = onboardingStep === null;

  const devNavigation =
    !window.shopify && onboardingComplete ? (
      <Navigation location={location.pathname}>
        <Navigation.Section
          title="AiVastra (dev)"
          items={NAV_ITEMS.map((item) => ({
            label: item.label,
            icon: item.icon,
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
      <AppNavMenu onboardingComplete={onboardingComplete} />
      <Frame navigation={devNavigation}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/manage" element={<ManagePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/billing/callback" element={<BillingCallbackPage />} />
          <Route path="/billing/autorefill-callback" element={<AutorefillCallbackPage />} />
          <Route path="/onboarding" element={<OnboardingIntroPage me={me} />} />
          <Route
            path="/onboarding/products"
            element={<OnboardingProductsPage me={me} onRefresh={refreshMe} />}
          />
          <Route
            path="/onboarding/routing"
            element={<OnboardingRoutingPage me={me} onRefresh={refreshMe} />}
          />
          <Route
            path="/onboarding/theme"
            element={<OnboardingThemePage me={me} onRefresh={refreshMe} />}
          />
          {/* Merchants may have bookmarked the old path while it was the only
              product surface. */}
          <Route path="/products" element={<Navigate to="/manage" replace />} />
          {/* Merchants may have bookmarked the old path while Routing was its
              own page. */}
          <Route path="/routing" element={<Navigate to="/manage" replace />} />
          <Route path="/embedded" element={<Navigate to="/" replace />} />
          {/* Widget Design page removed — merchants may have it bookmarked or
              pinned in Shopify admin's nav history. */}
          <Route path="/widget-design" element={<Navigate to="/" replace />} />
        </Routes>
      </Frame>
    </AppProvider>
  );
}
