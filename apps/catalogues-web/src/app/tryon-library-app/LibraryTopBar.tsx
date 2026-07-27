'use client';
import { PhoneCall } from 'lucide-react';
import { C } from '@/components/tokens';
import { LibraryUserMenu } from './LibraryUserMenu';

export function LibraryTopBar({
  title,
  subtitle,
  right,
  lead,
  onLoggedOut,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  lead?: React.ReactNode;
  onLoggedOut: () => void;
}) {
  return (
    <div
      className="library-topbar"
      style={{
        background: C.white,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <div
        className="library-topbar-identity-row"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div style={{ minWidth: 0 }}>
          {lead ?? (
            <div>
              {title && (
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 20,
                    lineHeight: '32px',
                    color: C.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
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
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <a
            href="tel:+917729883692"
            className="library-topbar-phone"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: C.text,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <PhoneCall size={18} />
            +91 77298 83692
          </a>

          <LibraryUserMenu onLoggedOut={onLoggedOut} />
        </div>
      </div>

      {right && (
        <div
          className="library-topbar-actions-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {right}
        </div>
      )}
    </div>
  );
}
