import { Shirt } from 'lucide-react';
import Link from 'next/link';
import { SupportButton } from './SupportModal';
import { C } from './tokens';
import { UserMenu } from './user-menu';

export function TopBar({
  title,
  subtitle,
  right,
  lead,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  lead?: React.ReactNode;
}) {
  return (
    <div
      style={{
        height: 76,
        background: C.white,
        borderBottom: `1px solid ${C.border}`,
        padding: '0 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}
    >
      {lead ?? (
        <div>
          {title && (
            <div style={{ fontWeight: 600, fontSize: 20, lineHeight: '32px', color: C.text }}>
              {title}
            </div>
          )}
          {subtitle && (
            <div
              style={{
                fontWeight: 500,
                fontSize: 14,
                lineHeight: '20px',
                color: C.mid,
                marginTop: 2,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {right}

        {/* AI Virtual Try-On CTA */}
        {/* <Link
          href="/tryon"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: 163,
            height: 40,
            padding: '0 10px',
            borderRadius: 8,
            background: 'linear-gradient(180deg, #7C3AED 0%, #310380 100%)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            boxShadow: '0 2px 8px rgba(124,58,237,0.35)',
            boxSizing: 'border-box',
          }}
        >
          <Shirt size={15} />
          AI Virtual Try-On
        </Link> */}

        {/* Support button */}
        <SupportButton />

        <UserMenu />
      </div>
    </div>
  );
}
