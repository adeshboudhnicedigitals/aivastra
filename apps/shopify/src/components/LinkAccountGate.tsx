import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { BRAND, FONT_STACK } from '../theme';
import { ArrowRightIcon, SpinnerIcon } from './icons';

const AIVASTRA_APP_URL = import.meta.env.VITE_AIVASTRA_APP_URL || 'https://app.aivastra.com';

function openLinkPopup(): Promise<string> {
  return new Promise((resolve, reject) => {
    const nonce = Math.random().toString(36).slice(2);
    const origin = window.location.origin;
    const popup = window.open(
      `${AIVASTRA_APP_URL}/login?next=${encodeURIComponent(
        `/widget-link-complete?origin=${encodeURIComponent(origin)}&nonce=${nonce}`,
      )}`,
      'aivastra-link',
      'width=480,height=640',
    );

    function onMessage(event: MessageEvent) {
      if (event.origin !== AIVASTRA_APP_URL) return;
      if (event.data?.type !== 'aivastra-widget-link' || event.data.nonce !== nonce) return;
      window.removeEventListener('message', onMessage);
      resolve(event.data.code as string);
    }
    window.addEventListener('message', onMessage);

    const closeCheck = setInterval(() => {
      if (popup?.closed) {
        clearInterval(closeCheck);
        window.removeEventListener('message', onMessage);
        reject(new Error('Popup closed before linking completed'));
      }
    }, 500);
  });
}

export function LinkAccountGate({ onLinked }: { onLinked: () => void }) {
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    setLinking(true);
    setError(null);
    try {
      const code = await openLinkPopup();
      await apiFetch('/v1/shopify/store/account/link', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      onLinked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLinking(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FAF9FC',
        backgroundImage:
          'radial-gradient(circle at 15% 20%, rgba(124,58,237,0.10), transparent 45%), radial-gradient(circle at 85% 80%, rgba(249,102,87,0.10), transparent 45%)',
        fontFamily: FONT_STACK,
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '420px',
          maxWidth: '100%',
          background: '#FFFFFF',
          border: `1px solid ${BRAND.border}`,
          borderRadius: '20px',
          boxShadow: '0 1px 2px rgba(23,15,38,0.04), 0 24px 48px rgba(23,15,38,0.10)',
          padding: '44px 36px 36px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            fontSize: '27px',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            background: BRAND.logoGradient,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          AiVastra
        </div>
        <div
          style={{
            marginTop: '5px',
            fontSize: '11.5px',
            fontWeight: 600,
            color: BRAND.textFaint,
            letterSpacing: '0.06em',
          }}
        >
          VIRTUAL TRY-ON FOR SHOPIFY
        </div>

        <div
          style={{
            marginTop: '30px',
            fontSize: '19px',
            fontWeight: 700,
            color: BRAND.ink,
            lineHeight: 1.3,
          }}
        >
          Connect your AiVastra account
        </div>
        <div
          style={{ marginTop: '10px', fontSize: '14px', lineHeight: 1.6, color: BRAND.textMuted }}
        >
          Billing and credits live on{' '}
          <span style={{ color: BRAND.ink, fontWeight: 600 }}>app.aivastra.com</span> — nothing is
          charged through Shopify. Link your store to start offering virtual try-on.
        </div>

        {error && (
          <div
            style={{
              marginTop: '20px',
              width: '100%',
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
              textAlign: 'left',
              background: BRAND.dangerBg,
              border: '1px solid rgba(200,30,58,0.18)',
              borderRadius: '12px',
              padding: '12px 14px',
              boxSizing: 'border-box',
            }}
          >
            <svg
              aria-hidden="true"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              style={{ flexShrink: 0, marginTop: '1px' }}
            >
              <path
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                stroke={BRAND.dangerStrong}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div style={{ fontSize: '13px', lineHeight: 1.5, color: '#8C1830' }}>
              <b>Couldn't complete the connection.</b> Please try linking your account again.
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={link}
          disabled={linking}
          style={{
            marginTop: '26px',
            width: '100%',
            height: '46px',
            border: 'none',
            borderRadius: '12px',
            background: BRAND.buttonGradient,
            color: '#fff',
            fontSize: '14.5px',
            fontWeight: 600,
            cursor: linking ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: '0 10px 24px rgba(124,58,237,0.30)',
          }}
        >
          {linking ? (
            <>
              <SpinnerIcon size={16} />
              <span>Connecting…</span>
            </>
          ) : (
            <>
              <span>Link account</span>
              <ArrowRightIcon size={14} />
            </>
          )}
        </button>

        <div style={{ marginTop: '16px', fontSize: '12px', color: BRAND.textPlaceholder }}>
          You'll be redirected to app.aivastra.com to sign in
        </div>
      </div>
    </div>
  );
}
