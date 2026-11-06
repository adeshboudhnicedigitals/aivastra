'use client';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { C } from '@/components/tokens';

/** Confirmation modal; controlled via `open`, parent owns the action and busy state. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>('button:not([disabled])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [open]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: click-outside-to-dismiss backdrop; Escape is handled above
    <div
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: `color-mix(in srgb, ${C.dark} 55%, transparent)`,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: onClick only stops backdrop propagation */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 24,
          width: 380,
          maxWidth: '100%',
        }}
      >
        <h3
          id="confirm-dialog-title"
          style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 8px' }}
        >
          {title}
        </h3>
        {body && (
          <p style={{ fontSize: 14, lineHeight: 1.6, color: C.mid, margin: '0 0 16px' }}>{body}</p>
        )}
        {error && (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${C.danger}`,
              fontSize: 13,
              color: C.danger,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              height: 40,
              padding: '0 18px',
              borderRadius: 8,
              border: `1px solid ${C.border2}`,
              background: C.white,
              color: C.text,
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              height: 40,
              padding: '0 18px',
              borderRadius: 8,
              border: 'none',
              background: danger ? C.danger : C.dark,
              color: C.white,
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.7 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
