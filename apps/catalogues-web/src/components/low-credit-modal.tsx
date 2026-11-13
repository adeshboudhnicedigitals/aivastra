'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { C, grad } from './tokens';

export type LowCreditKind = 'low' | 'exhausted';

/**
 * Informational heads-up shown on the studio result screen once a generation
 * settles and the balance has crossed a threshold. Never blocks: the user can
 * dismiss it (button, Esc, backdrop) and keep working.
 */
export function LowCreditModal({
  kind,
  balance,
  onClose,
}: {
  kind: LowCreditKind | null;
  balance: number;
  onClose: () => void;
}): React.ReactElement | null {
  const router = useRouter();
  const dismissRef = useRef<HTMLButtonElement>(null);
  const open = kind !== null;

  useEffect(() => {
    if (!open) return;
    dismissRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!kind) return null;

  const exhausted = kind === 'exhausted';
  const heading = exhausted ? "You've run out of credits" : 'Your credits are running low';
  const body = exhausted
    ? 'Your credit balance is now 0, so new generations will not run until you add more credits.'
    : `You have ${balance} credit${balance === 1 ? '' : 's'} left. Add more credits to keep generating without interruption.`;

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismisses modal */}
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.52)',
          backdropFilter: 'blur(4px)',
          zIndex: 1200,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="low-credit-title"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1201,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: 440,
            maxWidth: '100%',
            borderRadius: 18,
            background: C.white,
            boxShadow: '0 24px 80px rgba(0,0,0,0.22)',
            border: `1px solid ${C.border}`,
            overflow: 'hidden',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ background: exhausted ? C.danger : C.amber, padding: '18px 28px' }}>
            <div
              id="low-credit-title"
              style={{ fontSize: 17, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}
            >
              {heading}
            </div>
          </div>
          <div style={{ padding: 28 }}>
            <p style={{ margin: '0 0 24px', fontSize: 14, lineHeight: 1.6, color: C.mid }}>
              {body}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                ref={dismissRef}
                type="button"
                onClick={onClose}
                style={{
                  height: 44,
                  padding: '0 20px',
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: 'none',
                  color: C.text,
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  router.push('/pricing');
                }}
                style={{
                  height: 44,
                  padding: '0 20px',
                  borderRadius: 10,
                  border: 'none',
                  background: grad,
                  color: C.white,
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Buy Credits
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
