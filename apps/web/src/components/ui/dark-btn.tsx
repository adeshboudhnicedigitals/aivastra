'use client';
import { C } from '../tokens';

export function DarkBtn({
  children, onClick, style = {}, disabled = false, type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '10px 20px', borderRadius: 8, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'inherit', fontWeight: 600, fontSize: 14,
      background: C.dark, color: C.white, opacity: disabled ? 0.55 : 1, transition: 'opacity .15s', ...style,
    }}
      onMouseOver={(e) => { if (!disabled) e.currentTarget.style.opacity = '.85'; }}
      onMouseOut={(e) => { if (!disabled) e.currentTarget.style.opacity = '1'; }}>
      {children}
    </button>
  );
}
