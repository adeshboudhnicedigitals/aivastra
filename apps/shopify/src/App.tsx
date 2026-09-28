import '@shopify/polaris/build/esm/styles.css';
import { AppProvider, Banner, Box, Frame, Navigation, Spinner } from '@shopify/polaris';
// AppProvider has no built-in default strings — an empty i18n object silently
// blanks every one of Polaris's own labels (pagination Previous/Next,
// IndexFilters' "Add filter", select-all checkboxes, …), not just their visible
// text but their aria-labels too.
import enTranslations from '@shopify/polaris/locales/en.json';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppFont } from './components/AppFont';
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
import OnboardingContactPage from './pages/OnboardingContactPage';
import OnboardingIntroPage from './pages/OnboardingIntroPage';
import OnboardingLimitsPage from './pages/OnboardingLimitsPage';
import OnboardingProductsPage from './pages/OnboardingProductsPage';
import OnboardingThemePage from './pages/OnboardingThemePage';
import PricingPage from './pages/PricingPage';
import SettingsPage from './pages/SettingsPage';
import SupportPage from './pages/SupportPage';
import type { ShopifyMe, ShopifyOnboardingConfirmResponse } from './types';

// Shopify's own return URLs for a purchase/subscription confirmation — must
// never be redirected away from mid-onboarding, or a merchant returning from
// a real charge can't see whether it succeeded. BillingCallbackPage has no
// background reconciler for one-time purchases (see its own header comment),
// so a swallowed error here means a charged merchant never finds out.
const GATE_EXEMPT_PATHS = ['/billing/callback', '/billing/autorefill-callback'];
const THEME_PAGE_PATH = onboardingPath('theme');

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
  // product/basket changes, confirm-theme-block), before navigating to the next
  // step. Keeping exactly one `me` here — rather than letting each
  // onboarding page independently re-fetch its own copy — is what keeps the
  // gate effect below and each page's own step-order check from disagreeing
  // about where the merchant currently is.
  // Returns the freshly-fetched `me` (not just void) so a caller that needs to
  // validate against it right away — the products page's Continue, checking
  // whether what it just saved actually leaves the store in a valid state —
  // doesn't have to wait a render for the prop to catch up.
  const refreshMe = useCallback(async () => {
    const res = await apiFetch<ShopifyMe>('/v1/shopify/me');
    setMe(res);
    return res;
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
    const exempt = onOnboardingRoute || GATE_EXEMPT_PATHS.includes(location.pathname);
    // The hard gate (redirect + hidden nav) only applies until a store
    // finishes onboarding for the very first time. getOnboardingStep is
    // derived live from /me (isSelectionDone/isBasketsDone in
    // lib/onboarding.ts) — a store that later disables every product, or adds
    // one with no basket, would otherwise be yanked back into a locked wizard
    // with no way out. onboardingCompletedOnce latches
    // permanently once true, so a later regression is surfaced as a normal
    // Dashboard banner instead (see DashboardPage.tsx), not a re-triggered
    // gate.
    const neverCompletedOnboarding = !(me.store.settings.onboardingCompletedOnce ?? false);
    if (step !== null && neverCompletedOnboarding && !exempt) {
      navigate(onboardingPath(step), { replace: true });
    } else if (step === null && onOnboardingRoute && location.pathname !== THEME_PAGE_PATH) {
      // Not the theme page: detecting the embed is what finishes onboarding, and
      // the merchant is meant to see that and press Continue rather than be
      // moved on the moment it happens. Its Continue button navigates itself.
      navigate('/', { replace: true });
    }
  }, [me, location.pathname, navigate]);

  // Marks the store as having finished onboarding at least once. Fire-and-
  // forget and idempotent (same pattern as confirm-theme-block elsewhere in
  // this codebase) — a lost request just means this
  // fires again on the next render where step is still null, which keeps
  // happening until it succeeds.
  useEffect(() => {
    if (!me) return;
    if (getOnboardingStep(me) !== null) return;
    if (me.store.settings.onboardingCompletedOnce) return;
    apiFetch<ShopifyOnboardingConfirmResponse>('/v1/shopify/onboarding/complete', {
      method: 'POST',
    })
      .then((res) => {
        setMe((prev) =>
          prev ? { ...prev, store: { ...prev.store, settings: res.settings } } : prev,
        );
      })
      .catch(() => {
        // Best-effort — see comment above.
      });
  }, [me]);

  if (loading) {
    return (
      <AppProvider i18n={enTranslations}>
        <AppFont>
          <Spinner accessibilityLabel="Loading" size="large" />
        </AppFont>
      </AppProvider>
    );
  }

  if (error) {
    return (
      <AppProvider i18n={enTranslations}>
        <AppFont>
          <Box padding="800">
            <Banner
              title="Couldn't load AiVastra"
              tone={error.tone}
              action={{ content: 'Retry', onAction: () => window.location.reload() }}
            >
              {error.message}
            </Banner>
          </Box>
        </AppFont>
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
  const neverCompletedOnboarding = !(me.store.settings.onboardingCompletedOnce ?? false);
  const onboardingComplete = !(onboardingStep !== null && neverCompletedOnboarding);

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
    <AppProvider i18n={enTranslations}>
      <AppFont>
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
            <Route path="/onboarding" element={<OnboardingIntroPage />} />
            <Route
              path="/onboarding/products"
              element={<OnboardingProductsPage me={me} onRefresh={refreshMe} />}
            />
            {/* Old wizard step, removed when basket choice moved into page 2 —
                merchants may have it bookmarked. */}
            <Route
              path="/onboarding/routing"
              element={<Navigate to="/onboarding/products" replace />}
            />
            <Route
              path="/onboarding/contact"
              element={<OnboardingContactPage me={me} onRefresh={refreshMe} />}
            />
            <Route
              path="/onboarding/limits"
              element={<OnboardingLimitsPage me={me} onRefresh={refreshMe} />}
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
      </AppFont>
    </AppProvider>
  );
}
