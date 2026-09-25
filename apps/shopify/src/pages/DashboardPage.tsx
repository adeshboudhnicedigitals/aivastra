import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  SkeletonBodyText,
  SkeletonPage,
  Text,
  Toast,
} from '@shopify/polaris';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BalanceCard } from '../components/BalanceCard';
import { ErrorBanner } from '../components/ErrorBanner';
import { PackGrid } from '../components/PackGrid';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { isTryOnOff, needsEmbedEnable, unroutedWarningCount } from '../lib/onboarding';
import type { ShopifyMe, ShopifyStats, ShopifyWelcomeCreditsResponse } from '../types';

// Uses useNavigate() directly rather than accepting navigate as a prop: both
// call sites (Dashboard, Pricing) render this from within the SPA's router
// tree, so the hook always resolves, and it keeps callers from having to
// thread a navigate function through just to render a banner.
//
// Takes the whole `me` object, not just `runway` — the banner now has to
// branch on `autorefill.status` too, since a store enrolled in auto-refill
// changes what "low credits" should mean (see below).
//
// Renders `null` at 'ok' — this is deliberately not a blocking modal, and the
// app is not disabled at zero: a merchant at zero can still manage products,
// read analytics and edit the widget, and the actual breakage is on the
// storefront, not in here.
//
// `hideCapReached` lets PricingPage suppress the CAP_REACHED banner below:
// that page already renders an equivalent "Auto-refill has stopped" banner
// with a raise-cap control inline in its auto-refill card, so rendering both
// would duplicate the same message. Suppressing it here still falls through
// to the plain low-balance banner further down if the store's balance is
// actually low — only the CAP_REACHED-specific banner is skipped.
export function LowCreditsBanner({
  me,
  hideCapReached = false,
}: {
  me: ShopifyMe;
  hideCapReached?: boolean;
}) {
  const navigate = useNavigate();
  const { runway, autorefill } = me;

  // Auto-refill has stopped at a ceiling the merchant set. This is the one
  // auto-refill state that needs their attention, and it is more urgent than a
  // plain low balance because they believe it is handled.
  if (autorefill.status === 'CAP_REACHED' && !hideCapReached) {
    return (
      <Banner
        tone="critical"
        title="Auto-refill has stopped — monthly limit reached"
        // Not `url: '/pricing'` — see the comment on the low-balance banner
        // below; same production-vs-dev basename trap.
        action={{ content: 'Raise limit', onAction: () => navigate('/pricing') }}
      >
        <Text as="p">
          Your balance is {runway.balance.toLocaleString()} credits and automatic refills are paused
          until you raise your monthly limit.
        </Text>
      </Banner>
    );
  }

  // A healthy enrolled store is never "low" — the refill fires first. But a
  // store already at literal zero (`runway.level === 'empty'`) is proof that
  // auto-refill is NOT actually keeping this store topped up right now,
  // whatever its recorded status says (stuck-PENDING purchase row, expired
  // card, missed webhook, or a declined subscription that was never really
  // approved) — falls through to the low-balance banner below instead of
  // going silent exactly when the merchant is most at risk.
  if (autorefill.status === 'ACTIVE' && runway.level !== 'empty') return null;

  if (runway.level === 'ok') return null;

  const days = runway.daysRemaining != null ? Math.max(1, Math.round(runway.daysRemaining)) : null;

  return (
    <Banner
      tone={runway.level === 'warning' ? 'warning' : 'critical'}
      title={
        runway.level === 'empty'
          ? 'You’re out of credits — try-on is paused for shoppers'
          : days != null
            ? `Low credits — about ${days} day${days === 1 ? '' : 's'} left`
            : 'Low credits'
      }
      // Not `url: '/pricing'` — Polaris's `Banner` action `url` renders a
      // plain `<a href>`, which is only safe under this app's `AppProvider`
      // (no `linkComponent` configured) when the router basename and Vite
      // base both happen to be `/`, i.e. in dev only. In production both are
      // `/shopify-admin`, so an href navigates the embedded iframe to the
      // wrong app entirely. `onAction` + `navigate()` goes through the router
      // instead, same fix as the Dashboard's own Buy-credits button.
      action={{ content: 'Buy credits', onAction: () => navigate('/pricing') }}
    >
      <Text as="p">
        {runway.balance.toLocaleString()} credits ({runway.tryOnsRemaining.toLocaleString()}{' '}
        try-ons)
        {runway.dailyBurnCredits > 0
          ? ` at about ${Math.round(runway.dailyBurnCredits)} credits/day.`
          : '.'}
      </Text>
    </Banner>
  );
}

type StatusKey = keyof ShopifyStats['statusCounts'];

const STATUS_TONE: Record<StatusKey, 'success' | 'attention' | 'critical' | 'info'> = {
  active: 'success',
  processing: 'attention',
  failed: 'critical',
  disabled: 'info',
};

const STATUS_LABEL: Record<StatusKey, string> = {
  active: 'Active',
  processing: 'Processing',
  failed: 'Failed',
  disabled: 'Disabled',
};

export default function DashboardPage() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingEditor, setOpeningEditor] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then(setMe)
      .catch((err) => setError(classifyError(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A re-read that does not flip `loading`, so the page stays up (and the toast
  // below stays on screen) while the balance updates.
  const refreshMe = useCallback(
    () =>
      apiFetch<ShopifyMe>('/v1/shopify/me')
        .then(setMe)
        .catch((err) => setError(classifyError(err))),
    [],
  );

  // The welcome credits are granted the first time a store lands here — no claim
  // button, no popup. The server checks `emailBonusClaimed` and is idempotent, so
  // this is safe on a reload or a second tab; the ref just stops this mount asking
  // twice. Best-effort: if it fails the next visit tries again.
  const welcomeRequested = useRef(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!me || welcomeRequested.current || me.store.settings.emailBonusClaimed) return;
    welcomeRequested.current = true;
    apiFetch<ShopifyWelcomeCreditsResponse>('/v1/shopify/onboarding/welcome-credits', {
      method: 'POST',
    })
      .then((res) => {
        if (res.creditsGranted > 0) {
          setToastMessage(
            `${res.creditsGranted.toLocaleString()} free credits added to your balance!`,
          );
        }
        return refreshMe();
      })
      .catch(() => {});
  }, [me, refreshMe]);

  // Opens the theme editor's App embeds panel with our embed switched on. The
  // merchant still has to press Save there; only the Dashboard banner uses it.
  async function openThemeEditor() {
    if (openingEditor) return;
    setOpeningEditor(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/v1/shopify/onboarding/theme-editor-url');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setOpeningEditor(false);
    }
  }

  if (loading) {
    return (
      <SkeletonPage primaryAction>
        <SkeletonBodyText />
      </SkeletonPage>
    );
  }

  // Keyed off live product data, not getOnboardingStep: the onboarding step is
  // now derived from whether every enabled product has a basket, so a finished
  // store with hundreds of live products would read "not done" the moment one
  // new product (e.g. one no global rule matches) lands without a basket. The
  // "off" banner is for the true condition — nothing enabled resolves to a
  // basket — and the partial case gets its own, milder warning below.
  const tryOnOff = me != null && isTryOnOff(me);
  const unroutedCount = me ? unroutedWarningCount(me) : 0;
  const embedNeeded = me != null && needsEmbedEnable(me);
  return (
    <Page title="Dashboard" subtitle="Here's how virtual try-on is performing on your store.">
      <BlockStack gap="400">
        <ErrorBanner error={error} onRetry={load} />

        {embedNeeded && (
          <Banner
            tone="warning"
            title="Turn on the Try It On app embed"
            action={{
              content: 'Enable app embed',
              onAction: openThemeEditor,
            }}
          >
            <Text as="p">
              The try-on button is now switched on with one toggle instead of being placed in your
              theme, so shoppers won't see it until you enable the app embed and save. This message
              goes away once we see the button on a product page of your store.
            </Text>
          </Banner>
        )}

        {tryOnOff && (
          <Banner
            tone="warning"
            title="Virtual try-on is currently off"
            action={{ content: 'Go to Manage', onAction: () => navigate('/manage') }}
          >
            <Text as="p">
              No products are enabled right now, so shoppers won't see the try-on button. Turn it
              back on in Manage.
            </Text>
          </Banner>
        )}

        {unroutedCount > 0 && (
          <Banner
            tone="warning"
            title="Some products have no basket"
            action={{ content: 'Go to Manage', onAction: () => navigate('/manage') }}
          >
            <Text as="p">
              {unroutedCount === 1
                ? "1 enabled product has no basket, so try-on can't run on it — assign one in Manage."
                : `${unroutedCount} enabled products have no basket, so try-on can't run on them — assign one in Manage.`}
            </Text>
          </Banner>
        )}

        {me && <LowCreditsBanner me={me} />}

        <BalanceCard me={me} />

        <PackGrid onError={setError} />

        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Try-Ons
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.totalTryOns ?? 0}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Products Synced
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.syncedProductCount ?? 0}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Try-On Enabled
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.enabledProductCount ?? 0}
              </Text>
              <Text as="p" tone="subdued">
                of {me?.stats.syncedProductCount ?? 0} synced
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Today's try-ons
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.storeDailyCap
                  ? `${me.stats.todayTryOns} / ${me.stats.storeDailyCap}`
                  : (me?.stats.todayTryOns ?? 0)}
              </Text>
              {me?.stats.storeDailyCap != null &&
                me.stats.todayTryOns >= me.stats.storeDailyCap && (
                  <Banner tone="warning">
                    Your daily limit is reached. Try-on is paused until tomorrow.
                  </Banner>
                )}
              <Text as="p" tone="subdued">
                {me?.stats.capturedEmailCount ?? 0} emails collected
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="p" tone="subdued">
                Sync status
              </Text>
              {(['active', 'processing', 'failed', 'disabled'] as const).map((key) => (
                <InlineStack key={key} align="space-between" blockAlign="center">
                  <Text as="span">{STATUS_LABEL[key]}</Text>
                  <Badge tone={STATUS_TONE[key]}>{String(me?.stats.statusCounts[key] ?? 0)}</Badge>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </InlineGrid>

        <InlineStack align="space-between" blockAlign="center">
          <Button variant="plain" onClick={() => navigate('/manage')}>
            Manage Products
          </Button>
          {me?.store.connectedSince && (
            <Text as="span" tone="subdued">
              Connected since {new Date(me.store.connectedSince).toLocaleDateString()}
            </Text>
          )}
        </InlineStack>
      </BlockStack>
      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
}
