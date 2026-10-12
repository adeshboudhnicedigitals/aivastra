'use client';

import { REFUND_REASON_CODES, REFUND_REASON_LABELS, type RefundReasonCode } from '@aivastra/types';
import { useState } from 'react';
import { SpinnerIcon } from '@/components/icons';
import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/errors';

interface Props {
  /** The checked images. One refund request is sent per image, all with the same reason. */
  items: { jobId: string; label: string }[];
  onClose: () => void;
  /** Called once when the modal is finished with; `sentJobIds` are the images a request now exists for. */
  onDone: (sentJobIds: string[]) => void;
}

export function RefundRequestModal({ items, onClose, onDone }: Props) {
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{
    sent: string[];
    failures: { label: string; message: string }[];
  } | null>(null);

  async function submit() {
    if (!reasonCode || submitting) return;
    setSubmitting(true);
    setProgress(0);
    const sent: string[] = [];
    const failures: { label: string; message: string }[] = [];
    // One at a time: the API creates one request per image, and a burst would trip its
    // per-minute limit. An image that already has a request counts as sent, not failed.
    for (const item of items) {
      try {
        await api.post(`/v1/jobs/${item.jobId}/refund-request`, {
          reasonCode,
          note: note.trim() || undefined,
        });
        sent.push(item.jobId);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'REFUND_ALREADY_REQUESTED') {
          sent.push(item.jobId);
        } else {
          failures.push({
            label: item.label,
            message: e instanceof Error ? e.message : 'Could not send this request.',
          });
        }
      }
      setProgress((p) => p + 1);
    }
    setSubmitting(false);
    if (failures.length === 0) {
      onDone(sent);
      return;
    }
    // Keep the modal open so the customer can see exactly which images did not go through.
    setResult({ sent, failures });
  }

  const disabled = submitting || !reasonCode;
  const many = items.length > 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request a refund"
      onClick={() => {
        if (submitting) return;
        if (result) onDone(result.sent);
        else onClose();
      }}
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
          {many ? `Request a refund for ${items.length} images` : 'Request a refund'}
        </h3>
        {result ? (
          <>
            <p style={{ margin: 0, fontSize: 12.5, color: C.mid, lineHeight: 1.5 }}>
              {result.sent.length} of {items.length} requests were sent. These could not be sent:
            </p>
            <ul
              role="alert"
              style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.danger }}
            >
              {result.failures.map((f) => (
                <li key={f.label}>
                  {f.label}: {f.message}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => onDone(result.sent)}
                style={{
                  padding: '10px 18px',
                  borderRadius: 8,
                  background: `linear-gradient(135deg, ${C.pink}, ${C.amber})`,
                  color: 'white',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 12.5, color: C.mid, lineHeight: 1.5 }}>
              Tell us what went wrong. Our team will review {many ? 'each request' : 'it'} and, if
              approved, the credits go back to your account. Until we decide,{' '}
              {many ? 'these images' : 'this image'} can't be downloaded or regenerated. Once an
              image has been regenerated it can no longer be refunded.
            </p>
            <p
              style={{
                margin: 0,
                padding: '8px 10px',
                fontSize: 12.5,
                fontWeight: 600,
                color: C.text,
                background: C.lighter,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                lineHeight: 1.5,
              }}
            >
              Note: a refund can take 2-3 business hours to be reviewed and credited.
            </p>
            <div
              style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.lighter }}
            >
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
                {submitting && many ? `Sending ${progress} of ${items.length}…` : 'Send request'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
