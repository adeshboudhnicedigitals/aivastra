import {
  Banner,
  BlockStack,
  Select,
  SkeletonBodyText,
  SkeletonPage,
  Text,
  TextField,
  Toast,
} from '@shopify/polaris';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppFont } from '../components/AppFont';
import { AppPage } from '../components/AppPage';
import { AvCard } from '../components/AvCard';
import { BarChart } from '../components/BarChart';
import { ChartTable } from '../components/ChartTable';
import { ErrorBanner } from '../components/ErrorBanner';
import { Glyph } from '../components/PageHead';
import { PendingPaymentBanner } from '../components/PendingPaymentBanner';
import { ANALYTICS_PRESETS, type AnalyticsPreset, resolvePreset } from '../lib/analyticsRange';
import { apiFetch, apiFetchResponse } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { isTryOnOff } from '../lib/onboarding';
import { needsButtonBlock } from '../lib/theme';
import type {
  ShopifyAnalytics,
  ShopifyMe,
  ShopifyShopperListItem,
  ShopifyWelcomeCreditsResponse,
} from '../types';

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

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// One figure per currency: a store that sells in several currencies must not
// have them summed into a number that is in none of them.
const money = (rows: { currency: string; amount: number }[]) =>
  rows.length === 0
    ? '—'
    : rows
        .map((r) =>
          new Intl.NumberFormat(undefined, { style: 'currency', currency: r.currency }).format(
            r.amount,
          ),
        )
        .join(' · ');

const PAGE_SIZE = 5;

// Period-over-period deltas are not served by /analytics yet, so the design's
// ▲/▼ chips render as a neutral placeholder until they are.
function DeltaChip() {
  return (
    <span className="av-chip info" title="Comparison with the previous period is coming soon">
      —
    </span>
  );
}

function Kpi({
  icon,
  label,
  value,
  big = false,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  big?: boolean;
  /** For stock values that do not depend on the date range: a caption instead of a period delta. */
  note?: string;
}) {
  return (
    <AvCard>
      <div className={`av2-kpi${big ? ' big' : ''}`}>
        <span className="av-tile av2-tile">{icon}</span>
        <div>
          <div className="av-k">{label}</div>
          <div className="av2-kpi-row">
            <span className="av-big">{value}</span>
            {note === undefined && <DeltaChip />}
          </div>
          {note !== undefined && <div className="av-sub">{note}</div>}
        </div>
      </div>
    </AvCard>
  );
}

function Pager({
  page,
  pages,
  total,
  noun,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  noun: string;
  onPage: (p: number) => void;
}) {
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="av2-pager">
      <span>{`Showing ${from}–${to} of ${total} ${noun}`}</span>
      {pages > 1 && (
        <div className="av2-pages">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            ‹
          </button>
          {Array.from({ length: pages }, (_, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: page numbers are the identity
              key={i}
              type="button"
              className={i === page ? 'on' : undefined}
              aria-current={i === page ? 'page' : undefined}
              onClick={() => onPage(i)}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pages - 1}
            onClick={() => onPage(page + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

function SectionHead({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="av2-sec-head">
      <div className="av2-sec-title">
        <span className="av-tile av2-tile sm">{icon}</span>
        <div>
          <h2 className="av-h2">{title}</h2>
          <p className="av-sub">{subtitle}</p>
        </div>
      </div>
      <div className="av2-tools">{children}</div>
    </div>
  );
}

const searchIcon = (
  <Glyph size={20}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </Glyph>
);

type ContactSort = 'firstSeen' | 'tryOns';
type ProductSort = 'tryOns' | 'shoppers' | 'rate';

export default function DashboardPage() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [checkingEmbed, setCheckingEmbed] = useState(false);
  // What Check now found when it did not clear the banner; without it a negative
  // result looks identical to the button doing nothing.
  const [embedCheckMessage, setEmbedCheckMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  // Analytics, folded in from the retired Analytics page.
  const [preset, setPreset] = useState<AnalyticsPreset>('30d');
  const [analytics, setAnalytics] = useState<ShopifyAnalytics | null>(null);
  // Independent of the date range -- the shopper list is not range-scoped.
  const [shoppers, setShoppers] = useState<ShopifyShopperListItem[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [contactSort, setContactSort] = useState<ContactSort>('firstSeen');
  const [contactPage, setContactPage] = useState(0);
  const [productQuery, setProductQuery] = useState('');
  const [productSort, setProductSort] = useState<ProductSort>('tryOns');
  const [productPage, setProductPage] = useState(0);

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

  // Products added to Shopify outside the app (CSV import, bulk edit, missed
  // webhooks) are picked up by asking the API to reconcile; the counts then
  // refresh until they catch up. Manage used to do this when opened. Best-effort.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { behindBy } = await apiFetch<{ behindBy: number }>('/v1/shopify/products/catch-up', {
        method: 'POST',
      });
      for (let i = 0; i < 20 && behindBy > 0 && !cancelled; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!cancelled) await refreshMe();
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshMe]);

  const connectedSince = me?.store.connectedSince;
  useEffect(() => {
    if (!connectedSince) return;
    const range = resolvePreset(preset, new Date(connectedSince));
    apiFetch<ShopifyAnalytics>(`/v1/shopify/analytics?from=${range.from}&to=${range.to}`)
      .then(setAnalytics)
      .catch((err) => setError(classifyError(err)));
  }, [connectedSince, preset]);

  useEffect(() => {
    apiFetch<{ items: ShopifyShopperListItem[] }>('/v1/shopify/shoppers')
      .then((res) => setShoppers(res.items))
      .catch((err) => {
        setError(classifyError(err));
        setShoppers([]);
      });
  }, []);

  // The welcome credits are granted the first time a store lands here — no claim
  // button, no popup. The server checks `emailBonusClaimed` and is idempotent, so
  // this is safe on a reload or a second tab; the ref just stops this mount asking
  // twice. Best-effort: if it fails the next visit tries again.
  const welcomeRequested = useRef(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const location = useLocation();
  // Set by BillingCallbackPage once a pack's payment settled. Router state
  // survives reloads and history re-entry, so clear it after showing the toast
  // or it would announce the same purchase again.
  useEffect(() => {
    const added = (location.state as { creditsAdded?: number } | null)?.creditsAdded;
    if (!added) return;
    setToastMessage(`${added.toLocaleString()} credits added`);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);
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

  // Opens the product template with the Try It On button block staged. The
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

  // For stores that already added the block before reopening this page —
  // an explicit, human-paced check against the Admin API, same budget
  // rationale as OnboardingThemePage's "Refresh status". Best-effort: a failed
  // check still falls through to refreshMe(), which picks up whatever the
  // storefront-ping path already recorded, same as that page's checkStatus.
  async function checkEmbedNow() {
    if (checkingEmbed) return;
    setCheckingEmbed(true);
    setEmbedCheckMessage(null);
    try {
      const result = await apiFetch<{ themeBlockConfirmed: boolean; reason?: 'scope' | 'error' }>(
        '/v1/shopify/onboarding/check-theme-embed',
        { method: 'POST' },
      ).catch(() => null);
      await refreshMe();
      // Confirmed clears the banner through refreshMe; anything else says why not.
      if (result?.themeBlockConfirmed) return;
      if (result === null || result.reason === 'error') {
        setEmbedCheckMessage("We couldn't check your theme just now. Try again in a moment.");
      } else if (result.reason === 'scope') {
        setEmbedCheckMessage(
          'We need permission to read your theme. Reopen the app from your Shopify admin, approve the permissions request, then press Check now again.',
        );
      } else {
        setEmbedCheckMessage(
          'Not detected yet. Make sure the Try It On button is saved on your product page template (press Save in the theme editor), then press Check now again.',
        );
      }
    } finally {
      setCheckingEmbed(false);
    }
  }

  async function exportCsv() {
    // Not a plain <a href>: this SPA is served from a different origin than the
    // API in production, and /v1/shopify/shoppers.csv is behind
    // requireShopifySession, which needs the App Bridge bearer token that a
    // link navigation cannot carry. Fetch it authenticated, then hand the
    // browser a blob URL to download.
    setExporting(true);
    setError(null);
    try {
      const res = await apiFetchResponse('/v1/shopify/shoppers.csv');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = 'shoppers.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setExporting(false);
    }
  }

  const contacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    return (shoppers ?? [])
      .filter((s) => (q ? s.email.toLowerCase().includes(q) : true))
      .sort((a, b) =>
        contactSort === 'tryOns'
          ? b.tryOnCount - a.tryOnCount
          : new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime(),
      );
  }, [shoppers, contactQuery, contactSort]);

  const products = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return (analytics?.products ?? [])
      .filter((p) => (q ? (p.title ?? '').toLowerCase().includes(q) : true))
      .sort((a, b) =>
        productSort === 'shoppers'
          ? b.uniqueShoppers - a.uniqueShoppers
          : productSort === 'rate'
            ? b.addToCartRate - a.addToCartRate
            : b.tryOns - a.tryOns,
      );
  }, [analytics, productQuery, productSort]);

  if (loading) {
    return (
      <AppFont>
        <SkeletonPage primaryAction>
          <SkeletonBodyText />
        </SkeletonPage>
      </AppFont>
    );
  }

  // Keyed off live product data, not getOnboardingStep: the onboarding step is
  // now derived from whether every enabled product has a basket, so a finished
  // store with hundreds of live products would read "not done" the moment one
  // new product (e.g. one no global rule matches) lands without a basket. The
  // "off" banner is for the true condition — nothing enabled resolves to a
  // basket — and the partial case gets its own, milder warning below.
  const tryOnOff = me != null && isTryOnOff(me);
  const embedNeeded = me != null && needsButtonBlock(me);
  const cards = analytics?.cards;
  const stats = me?.stats;
  const contactPages = Math.max(1, Math.ceil(contacts.length / PAGE_SIZE));
  const productPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const contactRows = contacts.slice(contactPage * PAGE_SIZE, (contactPage + 1) * PAGE_SIZE);
  const productRows = products.slice(productPage * PAGE_SIZE, (productPage + 1) * PAGE_SIZE);
  const balance = me?.creditBalance ?? 0;

  return (
    <AppFont>
      <AppPage
        title="Dashboard"
        subtitle="Monitor your Virtual Try-On performance and manage your store."
      >
        <BlockStack gap="400">
          <ErrorBanner error={error} onRetry={load} onDismiss={() => setError(null)} />

          {embedNeeded && (
            <Banner
              tone="warning"
              title="Add the Try It On button to your product page"
              action={{
                content: 'Add button',
                onAction: openThemeEditor,
              }}
              secondaryAction={{
                content: 'Check now',
                onAction: checkEmbedNow,
              }}
            >
              <Text as="p">
                Try It On is now a button you add to your product page (the app embed is now a small
                icon on your product photos). Until you add it, shoppers only see the icon. Already
                added it? Press Check now, or this message clears on its own once we see the button
                on a product page of your store.
              </Text>
              {embedCheckMessage && (
                <Text as="p" tone="caution">
                  {embedCheckMessage}
                </Text>
              )}
            </Banner>
          )}

          {tryOnOff && (
            <Banner
              tone="warning"
              title="Virtual try-on is currently off"
              action={{ content: 'Go to Settings', onAction: () => navigate('/settings') }}
            >
              <Text as="p">
                No products are enabled right now, so shoppers won't see the try-on button. Turn it
                back on in Settings.
              </Text>
            </Banner>
          )}

          {me && <LowCreditsBanner me={me} />}
          {me && <PendingPaymentBanner shopDomain={me.store.shopDomain} include="awaiting" />}

          <div className="av2-top">
            <section className="av-c av2-balance">
              <span className="av-tile av2-tile lg">
                <Glyph size={34}>
                  <ellipse cx="12" cy="6" rx="7" ry="3" />
                  <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
                </Glyph>
              </span>
              <div className="av2-balance-main">
                <div className="av-k">Current Balance</div>
                <div className="av-big">{balance.toLocaleString()} credits</div>
                <div className="av2-plan">
                  Plan: <span className="av-chip brand">{me?.currentPack?.label ?? 'Free'}</span>
                </div>
              </div>
              <button type="button" className="av-btn-primary" onClick={() => navigate('/pricing')}>
                Buy Credits
              </button>
            </section>
            <Kpi
              icon={
                <Glyph size={22}>
                  <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
                  <path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5" />
                </Glyph>
              }
              label="Products Synced"
              value={String(stats?.syncedProductCount ?? 0)}
              note="Products in your store"
            />
          </div>

          <div className="av2-perf-head">
            <div>
              <h2 className="av-h2">Performance</h2>
              <p className="av-sub">Activity in the selected period.</p>
            </div>
            <div className="av2-range">
              <span className="av2-range-icon" aria-hidden>
                <Glyph size={20}>
                  <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
                  <path d="M3.5 10h17M8 3v4M16 3v4" />
                </Glyph>
              </span>
              <Select
                label="Date range"
                labelHidden
                options={ANALYTICS_PRESETS.map((p) => ({ label: p.label, value: p.id }))}
                value={preset}
                onChange={(v) => setPreset(v as AnalyticsPreset)}
              />
            </div>
          </div>

          <div className="av2-kpis av2-perf">
            <Kpi
              big
              icon={
                <Glyph size={30}>
                  <path d="M5 8h14l-1 12H6L5 8z" />
                  <path d="M9 8V6a3 3 0 0 1 6 0v2" />
                </Glyph>
              }
              label="Total Try-Ons"
              value={String(cards?.tryOns ?? stats?.totalTryOns ?? 0)}
            />
            <Kpi
              big
              icon={
                <Glyph size={30}>
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M2.5 20c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6" />
                  <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.3c2 .6 3.5 2.6 3.5 5.7" />
                </Glyph>
              }
              label="Unique Shoppers"
              value={String(cards?.uniqueShoppers ?? 0)}
            />
            <Kpi
              big
              icon={
                <Glyph size={30}>
                  <path d="M2.5 3.5h3l2.2 11h10.6l2-8H6.5" />
                  <circle cx="9" cy="19.5" r="1.5" />
                  <circle cx="17" cy="19.5" r="1.5" />
                </Glyph>
              }
              label="Added to Cart"
              value={String(cards?.addedToCart ?? 0)}
            />
            <Kpi
              big
              icon={
                <Glyph size={30}>
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="M4 7.5l8 5.5 8-5.5" />
                </Glyph>
              }
              label="Contacts Captured"
              value={String(cards?.emailsCaptured ?? 0)}
            />
            {/* Never "Conversion rate" -- a merchant reads that as purchased. */}
            <Kpi
              big
              icon={
                <Glyph size={30}>
                  <path d="M3 17l5-5 4 4 8-9" />
                  <path d="M15 7h5v5" />
                </Glyph>
              }
              label="Add-to-Cart Rate"
              value={pct(cards?.addToCartRate ?? 0)}
            />
            {/* Orders paid within 7 days of a completed try-on of the same product. */}
            <Kpi
              big
              icon={
                <Glyph size={30}>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M14.5 9h-4a1.8 1.8 0 0 0 0 3.6h3a1.8 1.8 0 0 1 0 3.6h-4M12 7v10" />
                </Glyph>
              }
              label="Try-On Revenue"
              value={money(cards?.revenue ?? [])}
            />
          </div>

          {cards && cards.turnedAway.total > 0 && (
            <AvCard>
              <div className="av-k">Turned away</div>
              <div className="av-big">{cards.turnedAway.total}</div>
              <div className="av-sub">
                Shoppers who hit a limit · store cap {cards.turnedAway.storeCap} · per-shopper cap{' '}
                {cards.turnedAway.shopperCap}
              </div>
            </AvCard>
          )}

          {analytics && (
            <div className="av2-charts">
              <AvCard>
                <BlockStack gap="300">
                  <h2 className="av-h2">Try-ons per day</h2>
                  <BarChart
                    orientation="vertical"
                    data={analytics.daily.map((d) => ({ label: d.day, value: d.tryOns }))}
                  />
                  <ChartTable
                    id="daily-table"
                    columns={['Day', 'Try-ons']}
                    rows={analytics.daily.map((d) => ({ label: d.day, value: String(d.tryOns) }))}
                  />
                </BlockStack>
              </AvCard>
              <AvCard>
                <BlockStack gap="300">
                  <h2 className="av-h2">Shopper journey</h2>
                  <BarChart
                    orientation="horizontal"
                    data={[
                      { label: 'Clicked try-on', value: analytics.funnel.buttonClick },
                      { label: 'Uploaded a photo', value: analytics.funnel.upload },
                      { label: 'Generated a try-on', value: analytics.funnel.tryOn },
                      { label: 'Viewed the result', value: analytics.funnel.resultView },
                      { label: 'Added to cart', value: analytics.funnel.addToCart },
                    ]}
                  />
                  <Text as="p" tone="subdued" variant="bodySm">
                    Steps 1, 2, 4 and 5 are measured in the shopper&apos;s browser and can be
                    blocked. Try-ons are measured on our servers and are exact — so a later step can
                    show more shoppers than an earlier one.
                  </Text>
                  {analytics.funnel.unattributed > 0 && (
                    <Text as="p" tone="subdued" variant="bodySm">
                      {`${analytics.funnel.unattributed} try-ons came from an older widget version and could not be matched to a shopper, so they are not in this chart.`}
                    </Text>
                  )}
                  <ChartTable
                    id="funnel-table"
                    columns={['Step', 'Shoppers']}
                    rows={[
                      { label: 'Clicked try-on', value: String(analytics.funnel.buttonClick) },
                      { label: 'Uploaded a photo', value: String(analytics.funnel.upload) },
                      { label: 'Generated a try-on', value: String(analytics.funnel.tryOn) },
                      { label: 'Viewed the result', value: String(analytics.funnel.resultView) },
                      { label: 'Added to cart', value: String(analytics.funnel.addToCart) },
                    ]}
                  />
                </BlockStack>
              </AvCard>
            </div>
          )}

          <AvCard>
            <SectionHead
              icon={
                <Glyph size={24}>
                  <path d="M3 12V4h8l10 10-8 8L3 12z" />
                  <circle cx="7.5" cy="8.5" r="1.4" />
                </Glyph>
              }
              title="Product Performance"
              subtitle="See which products drive the most engagement and conversions."
            >
              <div className="av2-tool-search wide">
                <TextField
                  label="Search products"
                  labelHidden
                  type="search"
                  prefix={searchIcon}
                  placeholder="Search products"
                  value={productQuery}
                  onChange={(v) => {
                    setProductQuery(v);
                    setProductPage(0);
                  }}
                  autoComplete="off"
                />
              </div>
              <div className="av2-tool-select wide">
                <Select
                  label="Sort products"
                  labelHidden
                  options={[
                    { label: 'Sort by: Try-Ons', value: 'tryOns' },
                    { label: 'Sort by: Shoppers', value: 'shoppers' },
                    { label: 'Sort by: Add-to-Cart Rate', value: 'rate' },
                  ]}
                  value={productSort}
                  onChange={(v) => setProductSort(v as ProductSort)}
                />
              </div>
            </SectionHead>
            <div className="av2-scroll">
              <table className="av2-table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Try-Ons</th>
                    <th scope="col">Shoppers</th>
                    <th scope="col">Added to Cart</th>
                    <th scope="col">Add-to-Cart Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {productRows.map((p) => (
                    <tr key={p.shopifyProductId}>
                      <td>{p.title ?? `#${p.shopifyProductId}`}</td>
                      <td>{p.tryOns}</td>
                      <td>{p.uniqueShoppers}</td>
                      <td>{p.addedToCart}</td>
                      <td>{pct(p.addToCartRate)}</td>
                    </tr>
                  ))}
                  {productRows.length === 0 && (
                    <tr>
                      <td colSpan={5}>No products match.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager
              page={productPage}
              pages={productPages}
              total={products.length}
              noun="products"
              onPage={setProductPage}
            />
          </AvCard>

          <AvCard>
            <SectionHead
              icon={
                <Glyph size={24}>
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M2.5 20c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6" />
                  <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.3c2 .6 3.5 2.6 3.5 5.7" />
                </Glyph>
              }
              title="Collected Contacts"
              subtitle="Shoppers who signed in to try on."
            >
              <div className="av2-tool-search">
                <TextField
                  label="Search contacts"
                  labelHidden
                  type="search"
                  prefix={searchIcon}
                  placeholder="Search contacts"
                  value={contactQuery}
                  onChange={(v) => {
                    setContactQuery(v);
                    setContactPage(0);
                  }}
                  autoComplete="off"
                />
              </div>
              <div className="av2-tool-select">
                <Select
                  label="Sort contacts"
                  labelHidden
                  options={[
                    { label: 'Sort: First seen', value: 'firstSeen' },
                    { label: 'Sort: Try-ons', value: 'tryOns' },
                  ]}
                  value={contactSort}
                  onChange={(v) => setContactSort(v as ContactSort)}
                />
              </div>
              <button
                type="button"
                className="av-btn-ghost"
                onClick={exportCsv}
                disabled={exporting || !shoppers || shoppers.length === 0}
                aria-busy={exporting || undefined}
              >
                Export CSV
              </button>
            </SectionHead>
            {shoppers && shoppers.length === 0 ? (
              <div className="av-empty" style={{ marginTop: 16 }}>
                <b>No contacts collected yet</b>
                <span>Turn on "Require login" under Settings → Limits to start collecting.</span>
              </div>
            ) : (
              <div className="av2-scroll">
                <table className="av2-table">
                  <thead>
                    <tr>
                      <th scope="col">Email</th>
                      <th scope="col">First Seen</th>
                      <th scope="col">Try-Ons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contactRows.map((s) => (
                      <tr key={s.id}>
                        <td>{s.email}</td>
                        <td>{new Date(s.firstSeenAt).toLocaleDateString()}</td>
                        <td>{s.tryOnCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager
              page={contactPage}
              pages={contactPages}
              total={contacts.length}
              noun="contacts"
              onPage={setContactPage}
            />
          </AvCard>

          {me?.store.connectedSince && (
            <Text as="span" tone="subdued">
              Connected since {new Date(me.store.connectedSince).toLocaleDateString()}
            </Text>
          )}
        </BlockStack>
        {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
      </AppPage>
    </AppFont>
  );
}
