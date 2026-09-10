'use client';
import { useState } from 'react';
import { C } from '@/components/tokens';

export function Tooltip({
  tip,
  children,
  position = 'top',
  align = 'center',
  containerStyle,
}: {
  tip?: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  containerStyle?: React.CSSProperties;
}) {
  const [visible, setVisible] = useState(false);

  if (!tip) return <>{children}</>;

  const alignStyles: Record<
    'start' | 'center' | 'end',
    { box: React.CSSProperties; arrow: React.CSSProperties }
  > = {
    center: {
      box: { left: '50%', transform: 'translateX(-50%)' },
      arrow: { left: '50%', transform: 'translateX(-50%)' },
    },
    end: {
      box: { right: 0 },
      arrow: { right: 23 },
    },
    start: {
      box: { left: 0 },
      arrow: { left: 23 },
    },
  };

  const currentAlign = alignStyles[align] ?? alignStyles.center;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-region wrapper for the tooltip; onFocus/onBlur give keyboard users the same behavior, no ARIA role fits a bare trigger container
    <div
      style={{ position: 'relative', display: 'inline-flex', ...containerStyle }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          style={{
            position: 'absolute',
            [position === 'top' ? 'bottom' : 'top']: 'calc(100% + 8px)',
            ...currentAlign.box,
            background: C.dark,
            color: C.onDark,
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
              ...currentAlign.arrow,
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              [position === 'top' ? 'borderTop' : 'borderBottom']: `5px solid ${C.dark}`,
            }}
          />
        </div>
      )}
    </div>
  );
}
