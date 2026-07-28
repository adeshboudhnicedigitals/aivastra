'use client';
import { ArrowLeft } from '@/components/icons';
import { C } from '@/components/tokens';
import { LibraryUserMenu } from '../LibraryUserMenu';
import { useLoggedOut } from '../logged-out-context';

type ScreenHeaderProps =
  | { variant: 'root'; title: string }
  | { variant: 'back'; title: string; subtitle?: string; onBack: () => void };

export function ScreenHeader(props: ScreenHeaderProps) {
  const onLoggedOut = useLoggedOut();
  return (
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
          gap: 12,
        }}
      >
        {props.variant === 'back' && (
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
        )}

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
          {props.variant === 'back' && props.subtitle && (
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

        {props.variant === 'root' && <LibraryUserMenu onLoggedOut={onLoggedOut} />}
      </div>
    </div>
  );
}
