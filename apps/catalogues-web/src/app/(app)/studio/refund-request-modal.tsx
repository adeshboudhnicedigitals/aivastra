'use client';

import { REFUND_REASON_CODES, REFUND_REASON_LABELS, type RefundReasonCode } from '@aivastra/types';
import { useState } from 'react';
import { SpinnerIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { api } from '@/lib/api';

interface Props {
  jobId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export function RefundRequestModal({ jobId, onClose, onSubmitted }: Props) {
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reasonCode || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/v1/jobs/${jobId}/refund-request`, {
        reasonCode,
        note: note.trim() || undefined,
      });
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your request. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !reasonCode;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request a refund"
      onClick={() => !submitting && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 100%)',
          background: C.card,
          borderRadius: 14,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>
          Request a refund
        </h3>
        <p style={{ margin: 0, fontSize: 12.5, color: C.mid, lineHeight: 1.5 }}>
          Tell us what went wrong. Our team will review it and, if approved, the credits go back to
          your account. Until we decide, this image can't be downloaded or regenerated.
        </p>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.lighter }}>
          <PremiumSelect
            ariaLabel="Reason for refund"
            value={reasonCode}
            onChange={(v) => setReasonCode(String(v))}
            options={REFUND_REASON_CODES.map((code) => ({
              value: code,
              label: REFUND_REASON_LABELS[code as RefundReasonCode],
            }))}
            disabled={submitting}
            placeholder="Select a reason…"
            fullWidth
            height={42}
            fontSize={13}
          />
        </div>
        <textarea
          aria-label="Additional details (optional)"
          placeholder="Anything else we should know? (optional)"
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          disabled={submitting}
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: 10,
            fontSize: 13,
            color: C.text,
            background: C.lighter,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            resize: 'vertical',
          }}
        />
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: C.danger }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              background: 'transparent',
              color: C.mid,
              border: `1px solid ${C.border}`,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void submit()}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              background: `linear-gradient(135deg, ${C.pink}, ${C.amber})`,
              color: 'white',
              border: 'none',
              fontWeight: 600,
              fontSize: 13,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {submitting ? <SpinnerIcon size={16} /> : null}
            Send request
          </button>
        </div>
      </div>
    </div>
  );
}
