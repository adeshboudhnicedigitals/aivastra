'use client';
import { C, grad } from '../tokens';

export function GradBtn({
  children,
  onClick,
  style = {},
  outline = false,
  disabled = false,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
  outline?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '10px 20px',
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        fontWeight: 600,
        fontSize: 14,
        whiteSpace: 'nowrap',
        background: outline ? C.white : grad,
        color: outline ? C.text : C.white,
        border: outline ? `1px solid ${C.border2}` : 'none',
        opacity: disabled ? 0.55 : 1,
        transition: 'opacity .15s',
        ...style,
      }}
      onMouseOver={(e) => {
        if (!disabled) e.currentTarget.style.opacity = '.85';
      }}
      onMouseOut={(e) => {
        if (!disabled) e.currentTarget.style.opacity = '1';
      }}
    >
      {children}
    </button>
  );
}
