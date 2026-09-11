'use client';
import { C, grad } from '../tokens';

export function GradBtn({
  children,
  onClick,
  style = {},
  outline = false,
  disabled = false,
  type = 'button',
  className,
}: {
  children: React.ReactNode;
  // Accepts the click event so callers nesting this button inside another
  // click zone (e.g. SourcePanel's whole-card drop target) can stopPropagation
  // to avoid double-firing. Existing zero-arg callers stay valid as-is.
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
  outline?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      className={className ? `btn-hover-opacity ${className}` : 'btn-hover-opacity'}
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 38,
        padding: '0 20px',
        boxSizing: 'border-box',
        borderRadius: 8,
        fontFamily: 'inherit',
        fontWeight: 600,
        fontSize: 14,
        whiteSpace: 'nowrap',
        background: outline ? C.white : grad,
        // C.white doubles as a theme-aware surface color (it's repurposed to a
        // dark card background under html.dark — see globals.css), so it's
        // wrong for text sitting on the fixed pink/purple gradient. C.onDark
        // (--c-on-dark) is deliberately left un-themed for exactly this case.
        color: outline ? C.text : C.onDark,
        border: outline ? `1px solid ${C.border2}` : 'none',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
