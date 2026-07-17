'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { type CreatedApiKey, createApiKey } from '../developers/api';

// "not a merchant account" / "merchant account inactive" — thrown by requireMerchant
// (apps/api/src/plugins/portal-auth.ts) when the logged-in user has no merchants row.
function isMerchantGateError(err: unknown): boolean {
  return err instanceof Error && /merchant account/i.test(err.message);
}

// Quick way to mint a throwaway dev-API key for manual testing without leaving
// Catalogue Manager. Full key management (list/revoke/usage) lives at /developers.
export function GenerateApiKeyButton() {
  const [revealed, setRevealed] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => createApiKey(`quick-test-${new Date().toISOString()}`),
    onSuccess: (created) => setRevealed(created),
  });

  async function copy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the key is still
      // visible for manual selection, so this is a soft failure.
    }
  }

  const merchantGated = isMerchantGateError(createMutation.error);

  return (
    <div style={{ position: 'relative' }}>
      <GradBtn outline onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
        <KeyRound size={16} />
        {createMutation.isPending ? 'Generating…' : 'Generate API Key'}
      </GradBtn>

      {revealed && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 20,
            width: 620,
            border: `1px solid ${C.pink}`,
            background: C.white,
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: C.pink }}>
            Copy this key now — you will not be able to see it again.
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: C.field,
              border: `1px solid ${C.border2}`,
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            <code
              style={{
                flex: 1,
                fontFamily: 'monospace',
                fontSize: 12,
                color: C.text,
                whiteSpace: 'nowrap',
                overflowX: 'auto',
              }}
            >
              {revealed.key}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                background: C.card,
                color: copied ? C.mint : C.text,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                background: C.dark,
                color: C.white,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {createMutation.isError && !merchantGated && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            fontSize: 12,
            color: C.pink,
            whiteSpace: 'nowrap',
          }}
        >
          {(createMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}
