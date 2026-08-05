'use client';
import { ArrowLeft, PlusIcon } from '@/components/icons';
import { Logo } from '@/components/logo';
import { C } from '@/components/tokens';
import { LibraryUserMenu } from '../LibraryUserMenu';
import { useLoggedOut } from '../logged-out-context';

// Same stops as the shared `grad` token, different angle — kept local to this
// app section so it doesn't shift the gradient on other pages that use `grad`.
const ctaGradient = 'linear-gradient(135deg, #521D9C 0.33%, #BD2587 50.77%, #F96657 99.67%)';

type ScreenHeaderProps =
  | { variant: 'root' }
  | {
      variant: 'back';
      title: string;
      subtitle?: string;
      onBack: () => void;
      action?: { label: string; onClick: () => void };
    };

export function ScreenHeader(props: ScreenHeaderProps) {
  const onLoggedOut = useLoggedOut();
  return (
    <>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div
          style={{
            height: 56,
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Logo small />
          <LibraryUserMenu onLoggedOut={onLoggedOut} compact />
        </div>
      </div>

      {props.variant === 'back' && (
        <div style={{ padding: '12px 16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={props.onBack}
            aria-label="Back"
            className="focus-ring hover-surface"
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: 10,
              border: 'none',
              background: 'transparent',
              color: C.text,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <ArrowLeft />
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 17,
                fontWeight: 600,
                color: C.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {props.title}
            </div>
            {props.subtitle && (
              <div
                style={{
                  fontSize: 12,
                  color: C.mid,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {props.subtitle}
              </div>
            )}
          </div>

          {props.action && (
            <button
              type="button"
              onClick={props.action.onClick}
              className="focus-ring hover-surface"
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 36,
                padding: '0 14px',
                borderRadius: 8,
                border: 'none',
                background: ctaGradient,
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              <PlusIcon size={12} />
              <span className="hide-mobile-tablet">{props.action.label}</span>
              <span className="show-mobile-tablet-only">Add</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}
