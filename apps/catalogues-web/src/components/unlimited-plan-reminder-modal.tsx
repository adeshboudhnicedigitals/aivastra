'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { C, grad } from './tokens';

export type UnlimitedPlanReminderStage = 'seven_day' | 'three_day' | 'expired';

export function UnlimitedPlanReminderModal({
  open,
  stage,
  daysRemaining,
  endDateLabel,
  onClose,
}: {
  open: boolean;
  stage: UnlimitedPlanReminderStage | null;
  daysRemaining: number | null;
  endDateLabel: string | null;
  onClose: () => void;
}): React.ReactElement | null {
  const router = useRouter();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = modalRef.current;
    if (!el) return;
    const focusable = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const nodes = el.querySelectorAll<HTMLElement>(focusable);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    first?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [open, onClose]);

  if (!open || !stage) return null;

  const accent = stage === 'expired' ? C.danger : stage === 'three_day' ? C.danger : C.amber;
  const heading =
    stage === 'expired'
      ? 'Your monthly plan has expired'
      : `Your monthly plan ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
  const body =
    stage === 'expired'
      ? `Your monthly plan expired on ${endDateLabel ?? 'the scheduled date'}. Your account is now using your regular credit balance.`
      : `Your monthly plan is active until ${endDateLabel ?? 'the scheduled date'}. After that, your account goes back to using your regular credit balance.`;
  const ctaLabel = stage === 'expired' ? 'Renew Now' : 'Renew Early';

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
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlimited-plan-reminder-title"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1201,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: stops backdrop click-through, not itself interactive content */}
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            width: 460,
            maxWidth: '100%',
            borderRadius: 18,
            background: C.white,
            boxShadow: '0 24px 80px rgba(0,0,0,0.22)',
            border: `1px solid ${C.border}`,
            overflow: 'hidden',
          }}
        >
          <div style={{ background: accent, padding: '18px 28px' }}>
            <div
              id="unlimited-plan-reminder-title"
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
                {ctaLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
