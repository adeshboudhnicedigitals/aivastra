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

  // Only .aivastra-tryon__modal-content and inward. The .aivastra-tryon__modal
  // wrapper is position:fixed and would escape the page.
  return (
    <div
      className="aivastra-tryon__modal-content"
      style={
        {
          '--aivastra-accent': config.theme?.accentColor ?? undefined,
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
        </div>

        {step === 'upload' && (
          <div className="aivastra-tryon__step aivastra-tryon__step--upload">
            <div className="aivastra-tryon__step-indicator">
              <span className="aivastra-tryon__step-dot is-active">1</span>
              <span className="aivastra-tryon__step-line" />
              <span className="aivastra-tryon__step-dot">2</span>
            </div>
            <h2 className="aivastra-tryon__upload-title">{text('uploadTitle')}</h2>
            <p className="aivastra-tryon__upload-lead">{text('uploadLead')}</p>
            <div className="aivastra-tryon__avatar" />
            <div className="aivastra-tryon__button-stack">
              <span className="aivastra-tryon__choose-btn">
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
              <span className="aivastra-tryon__change-photo">Change Photo</span>
            </div>
            <span className="aivastra-tryon__cta">
              <span>{text('ctaLabel')}</span>
            </span>
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
            <img className="aivastra-tryon__result-image" src={sampleResult} alt="Sample" />
            <div className="aivastra-tryon__result-actions">
              {behavior.addToCart !== false && (
                <span className="aivastra-tryon__add-to-cart">
                  {behavior.addToCartLabel?.trim() || WIDGET_BEHAVIOR_DEFAULTS.addToCartLabel}
                </span>
              )}
              {behavior.share !== false && (
                <span
                  className="aivastra-tryon__share"
                  role="img"
                  aria-label={behavior.shareLabel?.trim() || WIDGET_BEHAVIOR_DEFAULTS.shareLabel}
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
                </span>
              )}
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="aivastra-tryon__step aivastra-tryon__step--error">
            <p>{text('errorText')}</p>
            <span className="aivastra-tryon__retry">Try again</span>
          </div>
        )}
      </div>
    </div>
  );
}
