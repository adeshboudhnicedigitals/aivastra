import { X } from 'lucide-react';
import * as React from 'react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 500,
}: ModalProps) {
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="animate-fade-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <button
        type="button"
        aria-label="Close modal"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          padding: 0,
          border: 'none',
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(4px)',
          cursor: 'default',
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Modal'}
        className="card animate-slide-up"
        style={{
          width: '100%',
          maxWidth,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        {(title || description) && (
          <div className="card-header" style={{ paddingRight: 'var(--space-12)' }}>
            {title && <h2 className="card-title">{title}</h2>}
            {description && <p className="card-description">{description}</p>}
          </div>
        )}

        <button
          type="button"
          aria-label="Close modal"
          onClick={onClose}
          className="btn-icon focus-ring"
          style={{
            position: 'absolute',
            top: 'var(--space-4)',
            right: 'var(--space-4)',
            width: 32,
            height: 32,
            border: 'none',
          }}
        >
          <X size={18} />
        </button>

        <div className="card-content" style={{ overflowY: 'auto' }}>
          {children}
        </div>

        {footer && (
          <div
            className="card-footer"
            style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
