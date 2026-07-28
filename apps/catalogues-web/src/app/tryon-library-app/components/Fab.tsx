'use client';
import { PlusIcon } from '@/components/icons';
import { grad } from '@/components/tokens';

export function Fab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="focus-ring"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 'calc(20px + env(safe-area-inset-bottom))',
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: 'none',
        background: grad,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
        cursor: 'pointer',
        zIndex: 20,
      }}
    >
      <PlusIcon size={22} />
    </button>
  );
}
