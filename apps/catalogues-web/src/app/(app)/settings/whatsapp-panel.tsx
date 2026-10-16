'use client';

import type { MessagingAccount, WebConnectCodeResponse } from '@aivastra/types';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { C, grad } from '@/components/tokens';
import { api } from '@/lib/api';

type Toast = { message: string; type: 'success' | 'error' };

function formatNumber(e164: string): string {
  // '+919109516207' → '+91 91095 16207'; other lengths shown as stored.
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

const buttonBase: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontWeight: 600,
  fontSize: 13,
};

/**
 * Web-started connect (spec section 7): opens WhatsApp with "CONNECT <code>"
 * prefilled. The code is shown too, for when wa.me cannot prefill (desktop
 * without WhatsApp installed).
 */
export function WhatsappPanel({
  accounts,
  onToast,
}: {
  accounts: MessagingAccount[];
  onToast: (t: Toast) => void;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<WebConnectCodeResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function startConnect() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.post<WebConnectCodeResponse>('/v1/messaging/connect/web-code', {});
      setPending(res);
      window.open(res.waLink, '_blank', 'noopener,noreferrer');
    } catch (e) {
      onToast({ type: 'error', message: (e as Error).message || 'Could not start connecting' });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api.del(`/v1/messaging/accounts/${id}`);
      await qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
      onToast({ type: 'success', message: 'WhatsApp number disconnected' });
    } catch (e) {
      onToast({ type: 'error', message: (e as Error).message || 'Failed to disconnect' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: C.mid, margin: 0 }}>
        Create catalog images from WhatsApp. Images and credits are shared with this account.
      </p>

      {accounts.map((a) => (
        <div
          key={a.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>
            {formatNumber(a.externalId)}{' '}
            <span style={{ fontSize: 12, fontWeight: 500, color: a.optedOut ? C.amber : C.mint }}>
              {a.optedOut ? 'Messages stopped (reply START to resume)' : 'Connected'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void disconnect(a.id)}
            disabled={busy}
            style={{
              ...buttonBase,
              border: `1px solid ${C.border2}`,
              background: C.white,
              color: C.pink,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            Disconnect
          </button>
        </div>
      ))}

      <div>
        <button
          type="button"
          onClick={() => void startConnect()}
          disabled={busy}
          style={{
            ...buttonBase,
            border: 'none',
            background: grad,
            color: C.white,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {accounts.length > 0 ? 'Connect another number' : 'Connect WhatsApp'}
        </button>
      </div>

      {pending && (
        <p style={{ fontSize: 13, color: C.mid, margin: 0, lineHeight: 1.6 }}>
          WhatsApp should open with a message ready to send. If it didn&apos;t, send{' '}
          <strong style={{ color: C.text }}>CONNECT {pending.code}</strong> to +
          {pending.displayNumber} within {Math.round(pending.expiresInSeconds / 60)} minutes, then{' '}
          <button
            type="button"
            onClick={() => void qc.invalidateQueries({ queryKey: ['whatsapp-status'] })}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: C.pink,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
            }}
          >
            refresh
          </button>
          .
        </p>
      )}
    </div>
  );
}
