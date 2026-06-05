'use client';
import { useState } from 'react';
import { C } from '@/components/tokens';

export function Tooltip({
  tip,
  children,
  position = 'top',
}: {
  tip?: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
}) {
  const [visible, setVisible] = useState(false);

  if (!tip) return <>{children}</>;

  return (
    <div
      role="presentation"
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          style={{
            position: 'absolute',
            [position === 'top' ? 'bottom' : 'top']: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: C.dark,
            color: C.white,
            fontSize: 12,
            fontWeight: 500,
            padding: '6px 12px',
            borderRadius: 6,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 100,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
          }}
        >
          {tip}
          {/* Arrow */}
          <div
            style={{
              position: 'absolute',
              [position === 'top' ? 'top' : 'bottom']: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              [position === 'top' ? 'borderBottom' : 'borderTop']: `5px solid ${C.dark}`,
            }}
          />
        </div>
      )}
    </div>
  );
}
