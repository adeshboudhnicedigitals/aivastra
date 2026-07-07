'use client';

import { Headphones, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type Stage = 'idle' | 'submitting' | 'done' | 'error';

export function SupportButton() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleClose() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title="Customer Support"
        onClick={() => setOpen(true)}
        className="btn-icon focus-ring"
        style={{ width: 40, height: 40, background: 'hsl(var(--bg-base))' }}
      >
        <Headphones size={18} />
      </button>
      {open && <SupportModal onClose={handleClose} />}
    </>
  );
}

export function SupportModal({
  onClose,
  initialMessage = '',
}: {
  onClose: () => void;
  initialMessage?: string;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [errMsg, setErrMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const FOCUSABLE =
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [onClose]);

  async function handleSubmit() {
    if (!message.trim()) return;
    setStage('submitting');
    setErrMsg('');
    try {
      let attachmentKey: string | undefined;

      if (file) {
        const { uploadUrl, attachmentKey: key } = await api.post<{
          uploadUrl: string;
          attachmentKey: string;
        }>('/v1/support/presign', { contentType: file.type });
        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        });
        attachmentKey = key;
      }

      await api.post('/v1/support', { message: message.trim(), attachmentKey });
      setStage('done');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Something went wrong');
      setStage('error');
    }
  }

  const canSubmit = message.trim().length > 0 && stage === 'idle';

  return (
    <>
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes modal */}
      <div
        role="presentation"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        className="animate-fade-in"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
        }}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-modal-title"
        className="animate-slide-up"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1001,
          width: 480,
          maxWidth: 'calc(100vw - 32px)',
          background: 'hsl(var(--bg-base))',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid hsl(var(--border-default))',
          boxShadow: 'var(--shadow-float)',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-2)',
          }}
        >
          <div>
            <div
              id="support-modal-title"
              style={{
                fontSize: '1.125rem',
                fontWeight: 600,
                color: 'hsl(var(--text-primary))',
                letterSpacing: '-0.01em',
              }}
            >
              Have a question? We're here to help
            </div>
            <div
              style={{
                fontSize: '0.875rem',
                color: 'hsl(var(--text-secondary))',
                marginTop: 'var(--space-1)',
              }}
            >
              Share your concern and our team will get back to you shortly.
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="btn-icon focus-ring"
            style={{ width: 28, height: 28, border: 'none', marginLeft: 'var(--space-3)' }}
          >
            <X size={20} />
          </button>
        </div>

        {stage === 'done' ? (
          <div
            style={{
              marginTop: 'var(--space-6)',
              padding: 'var(--space-6) var(--space-5)',
              borderRadius: 'var(--radius-lg)',
              background: 'hsl(var(--success-subtle))',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: 32,
                marginBottom: 'var(--space-2)',
                color: 'hsl(var(--success-base))',
              }}
            >
              ✓
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--success-base))' }}>
              Message sent!
            </div>
            <div
              style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', marginTop: 4 }}
            >
              We'll get back to you as soon as possible.
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{
                marginTop: 'var(--space-4)',
              }}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Message */}
            <div style={{ marginTop: 'var(--space-5)' }}>
              <label
                htmlFor="support-message"
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: 'hsl(var(--text-primary))',
                  display: 'block',
                  marginBottom: 'var(--space-2)',
                }}
              >
                Your Message
              </label>
              <textarea
                id="support-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Please provide a clear description of your query"
                rows={5}
                className="input focus-ring"
                style={{
                  height: 'auto',
                  padding: '10px 12px',
                  resize: 'vertical',
                  lineHeight: 1.55,
                }}
              />
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'hsl(var(--text-tertiary))',
                  marginTop: 'var(--space-1)',
                }}
              >
                The more details you share, the faster we can help.
              </div>
            </div>

            {/* Attachment */}
            <div style={{ marginTop: 'var(--space-4)' }}>
              <div
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: 'hsl(var(--text-primary))',
                  marginBottom: 'var(--space-2)',
                }}
              >
                Attachment
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  border: '1px solid hsl(var(--border-strong))',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  background: 'hsl(var(--bg-base))',
                }}
              >
                <span
                  style={{
                    flex: 1,
                    padding: '9px 12px',
                    fontSize: '0.875rem',
                    color: file ? 'hsl(var(--text-primary))' : 'hsl(var(--text-tertiary))',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file ? file.name : 'No file chosen'}
                </span>
                {file && (
                  <button
                    type="button"
                    aria-label="Remove file"
                    onClick={() => {
                      setFile(null);
                      if (fileRef.current) fileRef.current.value = '';
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'hsl(var(--text-tertiary))',
                      padding: '0 8px',
                      display: 'flex',
                    }}
                  >
                    <X size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm focus-ring"
                  onClick={() => fileRef.current?.click()}
                  style={{
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    borderLeft: '1px solid hsl(var(--border-strong))',
                    gap: 6,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Paperclip size={16} />
                  Browse
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>

            {/* Error */}
            {stage === 'error' && (
              <div
                style={{
                  marginTop: 'var(--space-3)',
                  fontSize: '0.875rem',
                  color: 'hsl(var(--danger-base))',
                }}
              >
                {errMsg}
              </div>
            )}

            {/* Actions */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 'var(--space-3)',
                marginTop: 'var(--space-6)',
              }}
            >
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
              >
                {stage === 'submitting' ? 'Sending...' : 'Submit'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
