import { PhoneCall } from 'lucide-react';
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

        <a
          href="tel:+917729883692"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: C.text,
            fontSize: 14,
            fontWeight: 500,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <PhoneCall size={18} />
          +91 77298 83692
        </a>

        {/* Support button */}
        <SupportButton />

        <UserMenu />
      </div>
    </div>
  );
}
