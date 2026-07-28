'use client';
import { C } from '@/components/tokens';

export function StickyBottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        background: C.white,
        borderTop: `1px solid ${C.border}`,
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
        display: 'flex',
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}
