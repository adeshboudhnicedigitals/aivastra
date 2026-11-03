import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { Glyph, Note } from '../components/PageHead';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { canShowProductsPage, getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe, ShopifySyncStatus } from '../types';

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 120;

export default function OnboardingProductsPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<ShopifyMe>;
}) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ imported: number; total: number | null }>({
    imported: 0,
    total: null,
  });
  const [error, setError] = useState<ClassifiedError | null>(null);
  const currentStep = getOnboardingStep(me);
  const syncStarted = useRef(false);
  const runSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      // Try-on starts on for every product. Only a store with no chosen mode is
      // set, so a mode picked earlier (or in Manage) is never overridden.
      if (!me.store.settings.activation?.mode) {
        await apiFetch('/v1/shopify/activation/mode', {
          method: 'PATCH',
          body: JSON.stringify({ mode: 'global' }),
        });
      }
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      let finished = false;
      for (let attempt = 0; attempt < MAX_POLLS && !finished; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const status = await apiFetch<ShopifySyncStatus>('/v1/shopify/products/sync/status');
        setProgress({ imported: status.imported, total: status.total });
        finished = status.state === 'idle';
      }
      if (!finished)
        throw new Error('Importing your products is taking longer than expected. Try again.');
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSyncing(false);
    }
  }, [onRefresh, me.store.settings.activation?.mode]);
  useEffect(() => {
    if (me.stats.syncedProductCount === 0 && !syncStarted.current) {
      syncStarted.current = true;
      void runSync();
    }
  }, [me.stats.syncedProductCount, runSync]);
  if (!canShowProductsPage(currentStep))
    return <Navigate to={onboardingPath(currentStep)} replace />;
  const imported = me.stats.syncedProductCount;
  const noProducts = !syncing && !error && syncStarted.current && imported === 0;
  const done = !syncing && imported > 0;
  // While syncing the live counts drive the bar; once finished (or on a revisit
  // with products already synced) every synced product is "done".
  const total = done ? imported : progress.total;
  const shown = done ? imported : Math.min(progress.imported, progress.total ?? progress.imported);
  const percent = done
    ? 100
    : total && total > 0
      ? Math.min(100, Math.round((shown / total) * 100))
      : 0;
  const failed = me.stats.statusCounts.failed;
  return (
    <OnboardingLayout
      bare
      page="products"
      fullWidth
      padding="var(--p-space-400)"
      continueDisabled={syncing || imported === 0}
      continueLoading={false}
      onContinue={() => navigate('/onboarding/contact')}
    >
      <div className="av-center">
        {error ? (
          <div style={{ width: '100%', maxWidth: 640 }}>
            <ErrorBanner
              error={error}
              onRetry={imported === 0 && !syncing ? runSync : undefined}
              onDismiss={() => setError(null)}
            />
          </div>
        ) : noProducts ? (
          <>
            <span className="av-bigtile" style={{ background: '#fdf0c8', color: '#7a5200' }}>
              <Glyph size={44}>
                <circle cx="12" cy="12" r="9.5" />
                <path d="M12 7v6M12 16.6v.1" />
              </Glyph>
            </span>
            <h1>No products found</h1>
            <p>
              We couldn&apos;t find any products in your store. Add products in Shopify, then try
              again.
            </p>
            <button
              type="button"
              className="av-btn-ghost"
              style={{ marginTop: 'var(--av-gap)' }}
              onClick={runSync}
            >
              Import again
            </button>
          </>
        ) : done ? (
          <>
            <span
              className="av-bigtile"
              style={{ background: '#dcf5e6', boxShadow: '0 10px 26px rgba(34,165,89,.18)' }}
            >
              <span
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: '#1f9d55',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                }}
              >
                <Glyph size={34}>
                  <path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth="3" />
                </Glyph>
              </span>
            </span>
            <h1>Products synced successfully!</h1>
            <p>Your Shopify product catalogue has been imported to Ai Vastra.</p>
            <div className="av-stats">
              <div className="av-stat">
                <span className="av-tile" style={{ width: 60, height: 60, borderRadius: 18 }}>
                  <Glyph size={30}>
                    <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
                    <path d="M3 12l9 4.5 9-4.5" />
                    <path d="M3 16.5L12 21l9-4.5" />
                  </Glyph>
                </span>
                <div>
                  <div className="num">{imported.toLocaleString()}</div>
                  <div className="lbl">Total products</div>
                </div>
              </div>
              <div className="av-stat" style={{ color: '#0f7a3a' }}>
                <Glyph size={40}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M7.8 12.4l2.9 2.9 5.5-5.8" />
                </Glyph>
                <div>
                  <div className="num">{Math.max(0, imported - failed).toLocaleString()}</div>
                  <div className="lbl">Synced</div>
                </div>
              </div>
              <div className="av-stat" style={{ color: '#c0262d' }}>
                <Glyph size={40}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9 9l6 6M15 9l-6 6" />
                </Glyph>
                <div>
                  <div className="num">{failed.toLocaleString()}</div>
                  <div className="lbl">Failed</div>
                </div>
              </div>
            </div>
            <div
              style={{
                width: '100%',
                maxWidth: 880,
                marginTop: 'var(--av-gap)',
                textAlign: 'left',
              }}
            >
              <Note>
                Try-on is on for all of them. You can exclude products later in Manage, and resync
                anytime.
              </Note>
            </div>
            <button
              type="button"
              className="av-btn-ghost"
              style={{ marginTop: 'var(--av-gap)' }}
              onClick={runSync}
            >
              <Glyph size={22}>
                <path d="M20 11a8 8 0 0 0-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15M20 20v-5h-5" />
              </Glyph>
              Resync Products
            </button>
          </>
        ) : (
          <>
            <span className="av-bigtile" style={{ background: '#ebe6fc', color: '#5a2cf0' }}>
              <Glyph size={44}>
                <path d="M20 11a8 8 0 0 0-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15M20 20v-5h-5" />
              </Glyph>
            </span>
            <h1>Your products are syncing</h1>
            <p>
              Please wait while we sync your products from Shopify. This may take a few moments.
            </p>
            <div
              className="av-bar"
              role="progressbar"
              aria-label="Syncing your products"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={total ? percent : undefined}
            >
              <div style={{ width: `${total ? percent : 8}%` }} />
            </div>
            <p style={{ fontSize: 17 }}>
              {total
                ? `${shown} of ${total} products synced.`
                : `${progress.imported} products synced so far.`}
            </p>
          </>
        )}
      </div>
    </OnboardingLayout>
  );
}
