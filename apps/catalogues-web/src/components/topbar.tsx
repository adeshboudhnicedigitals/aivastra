import { Menu, PhoneCall } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { SupportButton } from './SupportModal';
import { SIDEBAR_DRAWER_ID, useSidebarContext } from './sidebar-context';
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
  const { isDrawerMode, isOpen, toggle } = useSidebarContext();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(isOpen);

  // Restore focus to the hamburger after the drawer closes — regardless of
  // how it was opened (WAI-ARIA dialog/menu pattern: DOM focus returns to
  // the trigger unconditionally; :focus-visible already keeps this
  // invisible to mouse users, so there's no "unexpected jump").
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      menuButtonRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {isDrawerMode && (
          <button
            type="button"
            ref={menuButtonRef}
            onClick={toggle}
            aria-label="Toggle navigation menu"
            aria-expanded={isOpen}
            aria-controls={SIDEBAR_DRAWER_ID}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.white,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Menu size={18} color={C.text} />
          </button>
        )}
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
      </div>
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
