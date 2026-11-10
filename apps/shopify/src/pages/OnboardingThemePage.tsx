import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import tutorialImage from '../assets/theme-tutorial.png';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { Glyph, Note, PageHead } from '../components/PageHead';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { getOnboardingStep } from '../lib/onboarding';
import type { ShopifyMe } from '../types';

const THEME_STEPS = [
  {
    title: 'Open Theme Settings',
    description: 'Click the button below. The Try It On button is added to your product page.',
  },
  {
    title: 'Position the Try It On button',
    description: 'Drag it where you want it on the product page, then click Save.',
  },
  {
    title: 'Optional: turn on the product image icon',
    description: 'Use the second button to add a try-on icon on your product photos.',
  },
];

export default function OnboardingThemePage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<ShopifyMe>;
}) {
  const navigate = useNavigate();
  const [openingEditor, setOpeningEditor] = useState<'block' | 'embed' | null>(null);
  const [checking, setChecking] = useState(false);
  // Set once the merchant has pressed Refresh and it still isn't detected, so the
  // page can say so instead of leaving them wondering whether anything happened.
  const [checkedNotFound, setCheckedNotFound] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);

  const blockDone = me.store.settings.themeBlockConfirmed ?? false;
  const iconDone = me.store.settings.themeEmbedConfirmed ?? false;

  // The embed is switched on in another tab and detected the first time the
  // widget loads on a live product page, so there is nothing to click here —
  // just look again on a timer and whenever the merchant comes back to this tab.
  // Deliberately calls onRefresh (cheap, DB-only) rather than the Admin-API-
  // backed check-theme-embed endpoint above — polling Shopify's Admin API
  // automatically every 5s for every merchant with this tab open would burn
  // API rate-limit budget for no benefit; that check is reserved for the
  // explicit, human-paced "Refresh status" click.
  useEffect(() => {
    if (blockDone) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void onRefresh().catch(() => {});
    };
    const timer = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [blockDone, onRefresh]);

  // The merchant enables the embed in the theme editor's own tab and comes back
  // to this page, which stays open. Refresh re-reads the store's status now
  // instead of waiting for the 5s timer above.
  async function checkStatus() {
    setChecking(true);
    setError(null);
    try {
      // Best-effort: the Admin API check is an accelerator, not a prerequisite.
      // If it fails for any reason, onRefresh still surfaces whatever the
      // storefront-ping path already recorded — this call must never block it.
      await apiFetch('/v1/shopify/onboarding/check-theme-embed', { method: 'POST' }).catch(
        () => {},
      );
      await onRefresh();
      setCheckedNotFound(true);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setChecking(false);
    }
  }

  const currentStep = getOnboardingStep(me);

  async function openThemeEditor(which: 'block' | 'embed') {
    setOpeningEditor(which);
    setError(null);
    try {
      const links = await apiFetch<{ blockUrl: string; embedUrl: string }>(
        '/v1/shopify/onboarding/theme-editor-url',
      );
      window.open(which === 'block' ? links.blockUrl : links.embedUrl, '_blank', 'noopener');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setOpeningEditor(null);
    }
  }

  return (
    <OnboardingLayout
      bare
      page="theme"
      hideBack={currentStep === null}
      continueLabel="Finish Setup"
      onContinue={() => navigate('/')}
      continueDisabled={!blockDone}
      fullWidth
      padding="var(--p-space-400)"
    >
      <div style={{ maxWidth: 1080, width: '100%', margin: '0 auto' }}>
        <PageHead
          icon={
            <Glyph size={44}>
              <path d="M4 9.5L5.5 4h13L20 9.5" />
              <path d="M4 9.5a2.8 2.8 0 0 0 5.4 0 2.8 2.8 0 0 0 5.2 0 2.8 2.8 0 0 0 5.4 0" />
              <path d="M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20" />
            </Glyph>
          }
          title="Activate Virtual Try-On"
          subtitle="Follow the steps below to enable Virtual Try-On in your Shopify theme."
        />
        <div style={{ marginTop: 12 }}>
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        </div>
        <div className="av-cols">
          <div className="av-asteps">
            <h2>Activation Steps</h2>
            {THEME_STEPS.map((step, index) => (
              <div
                key={step.title}
                className={`av-as${index === THEME_STEPS.length - 1 ? ' last' : ''}`}
              >
                <span className="num">{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </div>
            ))}
            <div className="av-btn-stack">
              <button
                type="button"
                className="av-btn-primary av-btn-sm"
                onClick={() => openThemeEditor('block')}
                disabled={blockDone || openingEditor !== null}
                aria-busy={openingEditor === 'block' || undefined}
              >
                Open theme settings
              </button>
              <button
                type="button"
                className="av-btn-ghost av-btn-sm"
                onClick={() => openThemeEditor('embed')}
                disabled={iconDone || openingEditor !== null}
                aria-busy={openingEditor === 'embed' || undefined}
              >
                Add try-on icon to product images (optional)
              </button>
            </div>
          </div>
          <div className="av-mock">
            {/* biome-ignore lint/performance/noImgElement: Vite SPA; the Next.js <Image> advice does not apply */}
            <img
              src={tutorialImage}
              alt="The theme editor on a product page, with the Try It On button block added above the product description and the Save button at the top right"
            />
          </div>
        </div>

        <div className="av-status">
          <div>
            <h2>Activation status</h2>
            <p>
              {blockDone
                ? iconDone
                  ? 'Product image icon on.'
                  : 'Product image icon: optional, not turned on.'
                : 'Checks whether Virtual Try-On is enabled in your store.'}
            </p>
          </div>
          <div aria-live="polite">
            {blockDone ? (
              <span className="av-pill on">
                <i />
                Activated
              </span>
            ) : (
              <span className="av-pill off">
                <i />
                Not activated
              </span>
            )}
          </div>
          <button
            type="button"
            className="av-btn-ghost av-btn-sm"
            onClick={checkStatus}
            disabled={checking || (blockDone && iconDone)}
            aria-busy={checking || undefined}
          >
            <Glyph size={20}>
              <path d="M20 11a8 8 0 0 0-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15M20 20v-5h-5" />
            </Glyph>
            {checking ? 'Checking…' : 'Check Status'}
          </button>
        </div>

        {!blockDone && checkedNotFound && (
          <div style={{ marginTop: 'var(--av-gap)' }}>
            <Note>
              Not detected yet. Make sure the Try It On button is saved to your product page, then
              press Check Status again in a moment, or open any product page on your live store (not
              the theme editor preview), which also confirms it automatically.
            </Note>
          </div>
        )}
      </div>
    </OnboardingLayout>
  );
}
