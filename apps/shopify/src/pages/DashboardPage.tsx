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
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BalanceCard } from '../components/BalanceCard';
import { EmailBonusModal } from '../components/EmailBonusModal';
import { ErrorBanner } from '../components/ErrorBanner';
import { PackGrid } from '../components/PackGrid';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import type { ShopifyMe, ShopifyStats } from '../types';

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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Auto-opens on first load (see showEmailBonusModal below); "Maybe later"
  // sets this false without touching emailBonusClaimed, so the persistent
  // card further down stays as the way back in.
  const [emailBonusModalOpen, setEmailBonusModalOpen] = useState(true);
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

  // A merchant only ever reaches Dashboard once onboarding (sync/enable,
  // routing, theme block) is fully done — see App.tsx's onboarding gate —
  // so this button is the one remaining, purely optional follow-up: telling
  // them where to go to restyle a block that's already in place.
  async function openThemeEditor() {
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

  const emailBonusClaimed = me?.store.settings.emailBonusClaimed ?? false;
  // The tile itself stays up until the store has bought a pack at least
  // once — claiming the bonus only changes what the tile says, not whether
  // it's there. The popup auto-open is still gated on the bonus itself,
  // since re-showing it after it's claimed would have nothing left to offer.
  const showFreeCreditsTile = me != null && !me.hasPurchasedPack;
  const showEmailBonusModal = me != null && !emailBonusClaimed && emailBonusModalOpen;

  return (
    <Page title="Dashboard" subtitle="Here's how virtual try-on is performing on your store.">
      <BlockStack gap="400">
        <ErrorBanner error={error} onRetry={load} />

        {me && <LowCreditsBanner me={me} />}

        <BalanceCard me={me} />

        <PackGrid
          onError={setError}
          leadingCard={
            showFreeCreditsTile ? (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Free
                    </Text>
                    <Badge tone="success">
                      {emailBonusClaimed ? 'Credits availed' : 'No purchase required'}
                    </Badge>
                  </InlineStack>

                  <Text as="p" variant="headingLg">
                    Free Credits
                  </Text>

                  {emailBonusClaimed ? (
                    <Text as="p" tone="subdued">
                      Already added to your balance.
                    </Text>
                  ) : (
                    <>
                      <BlockStack gap="100">
                        <Text as="p">5 try-ons</Text>
                        <Text as="p" tone="subdued">
                          Confirm your contact email to claim them.
                        </Text>
                      </BlockStack>

                      <Button variant="primary" onClick={() => setEmailBonusModalOpen(true)}>
                        Claim credits
                      </Button>
                    </>
                  )}
                </BlockStack>
              </Card>
            ) : undefined
          }
        />

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Customize the button
            </Text>
            <Text as="p" tone="subdued">
              Change the button's text, colors, promo message, or position by clicking the block in
              the theme editor — that's where its settings live.
            </Text>
            <InlineStack align="end">
              <Button onClick={openThemeEditor} loading={openingEditor}>
                Open theme editor
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

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

      {showEmailBonusModal && me && (
        <EmailBonusModal
          me={me}
          onClose={() => setEmailBonusModalOpen(false)}
          onClaimed={(result) => {
            load();
            setToastMessage(
              result.creditsGranted > 0
                ? `You got ${result.creditsGranted.toLocaleString()} free credits!`
                : 'Thanks for confirming your email.',
            );
          }}
        />
      )}

      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
}
