// The real storefront stylesheet, imported straight from the theme extension.
// Sharing the actual CSS is what makes this preview pixel-accurate — only the
// markup below is a mirror, and src/__tests__/widget-drift.test.ts fails if it
// uses a class the Liquid does not have.
//
// If the Vite dev server refuses to serve this path, add
// `server: { fs: { allow: ['..', '../..'] } }` to apps/shopify/vite.config.ts.
import '../../../shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.css';

import samplePhoto from '../assets/sample-photo.jpg';
import sampleResult from '../assets/sample-result.jpg';
import { WIDGET_BEHAVIOR_DEFAULTS, WIDGET_COPY_DEFAULTS } from '../lib/widgetDefaults';
import type { ShopifyWidgetConfig } from '../types';

export type PreviewStep = 'upload' | 'ready' | 'generating' | 'result' | 'error';

export function WidgetPreview({
  config,
  step,
}: {
  config: ShopifyWidgetConfig;
  step: PreviewStep;
}) {
  const copy = config.copy ?? {};
  const behavior = config.behavior ?? {};
  const text = (key: keyof typeof WIDGET_COPY_DEFAULTS) =>
    copy[key]?.trim() || WIDGET_COPY_DEFAULTS[key];
  const accentColor = config.theme?.accentColor?.trim() || undefined;

  // Only .aivastra-tryon__modal-content and inward. The .aivastra-tryon__modal
  // wrapper is position:fixed and would escape the page.
  return (
    <div
      className="aivastra-tryon__modal-content widget-preview-modal-content"
      style={
        {
          '--aivastra-accent': accentColor,
          margin: '0 auto',
        } as React.CSSProperties
      }
    >
      <div className="aivastra-tryon__modal-inner">
        <div className="aivastra-tryon__header">
          <div className="aivastra-tryon__header-main">
            <div>
              <p className="aivastra-tryon__heading">{text('heading')}</p>
              <p className="aivastra-tryon__subheading">{text('subheading')}</p>
            </div>
          </div>
          <div className="aivastra-tryon__header-actions">
            <button
              type="button"
              className="aivastra-tryon__close"
              aria-label="Close"
              aria-disabled="true"
              tabIndex={-1}
            >
              &times;
            </button>
          </div>
        </div>

        <div className="aivastra-tryon__page aivastra-tryon__page--main">
          {step === 'upload' && (
            <div className="aivastra-tryon__step aivastra-tryon__step--upload">
              <fieldset className="aivastra-tryon__step-indicator" aria-label="Step 1 of 2">
                <span className="aivastra-tryon__step-dot is-active">1</span>
                <span className="aivastra-tryon__step-line" />
                <span className="aivastra-tryon__step-dot">2</span>
              </fieldset>
              <h2 className="aivastra-tryon__upload-title">{text('uploadTitle')}</h2>
              <p className="aivastra-tryon__upload-lead">{text('uploadLead')}</p>
              <div className="aivastra-tryon__avatar" />
              <div className="aivastra-tryon__button-stack">
                <span className="aivastra-tryon__choose-btn">
                  <svg
                    aria-hidden="true"
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <strong>{text('chooseLabel')}</strong>
                </span>
              </div>
              <p className="aivastra-tryon__legal">
                {text('legalText')}
                <br />
                AI can make mistakes.
              </p>
            </div>
          )}

          {step === 'ready' && (
            <div className="aivastra-tryon__step aivastra-tryon__step--ready">
              <div className="aivastra-tryon__ready-preview">
                <img className="aivastra-tryon__ready-image" src={samplePhoto} alt="Sample" />
                <span className="widget-preview-sample-badge">Sample</span>
                <button
                  type="button"
                  className="aivastra-tryon__change-photo"
                  aria-disabled="true"
                  tabIndex={-1}
                >
                  Change Photo
                </button>
              </div>
              <button
                type="button"
                className="aivastra-tryon__cta"
                aria-disabled="true"
                tabIndex={-1}
              >
                <span>{text('ctaLabel')}</span>
              </button>
              <p className="aivastra-tryon__legal">
                {text('legalText')}
                <br />
                AI can make mistakes.
              </p>
            </div>
          )}

          {step === 'generating' && (
            <div className="aivastra-tryon__step aivastra-tryon__step--progress">
              <div className="aivastra-tryon__progress-canvas">
                <p>{text('generatingText')}</p>
                <div className="aivastra-tryon__progress-bar-track">
                  {/* Frozen mid-fill so the bar is actually visible in a still preview. */}
                  <div className="aivastra-tryon__progress-bar-fill" style={{ width: '60%' }} />
                </div>
              </div>
            </div>
          )}

          {step === 'result' && (
            <div className="aivastra-tryon__step aivastra-tryon__step--result">
              <div className="widget-preview-sample-media">
                <img className="aivastra-tryon__result-image" src={sampleResult} alt="Sample" />
                <span className="widget-preview-sample-badge">Sample</span>
              </div>
              <div className="aivastra-tryon__result-actions">
                {behavior.addToCart !== false && (
                  <button
                    type="button"
                    className="aivastra-tryon__add-to-cart"
                    aria-disabled="true"
                    tabIndex={-1}
                  >
                    {behavior.addToCartLabel?.trim() || WIDGET_BEHAVIOR_DEFAULTS.addToCartLabel}
                  </button>
                )}
                {behavior.share !== false && (
                  <button
                    type="button"
                    className="aivastra-tryon__share"
                    aria-label={behavior.shareLabel?.trim() || WIDGET_BEHAVIOR_DEFAULTS.shareLabel}
                    aria-disabled="true"
                    tabIndex={-1}
                  >
                    <svg
                      aria-hidden="true"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="18" cy="5" r="2.2" />
                      <circle cx="6" cy="12" r="2.2" />
                      <circle cx="18" cy="19" r="2.2" />
                      <path d="m8 11 7.8-4.6M8 13l7.8 4.6" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="aivastra-tryon__step aivastra-tryon__step--error">
              <p>{text('errorText')}</p>
              <button
                type="button"
                className="aivastra-tryon__retry"
                aria-disabled="true"
                tabIndex={-1}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
