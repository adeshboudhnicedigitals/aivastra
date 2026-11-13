'use client';
import { useEffect, useRef } from 'react';
import { C } from '@/components/tokens';

/**
 * Native <dialog>: the browser supplies the focus trap, Escape and the backdrop. Open while
 * `open`; `onClose` fires for Escape and after our own close. Children render only when open
 * so state inside never outlives the dialog.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  width = 560,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      style={{
        width: `min(${width}px, calc(100vw - 32px))`,
        maxHeight: 'calc(100dvh - 48px)',
        padding: 0,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        background: C.card,
        color: C.text,
      }}
    >
      {open && (
        <div style={{ padding: 20, display: 'grid', gap: 14, fontSize: 14 }}>{children}</div>
      )}
    </dialog>
  );
}
