'use client';

import type { ChatConnectConfirmResponse, ChatConnectPreviewResponse } from '@aivastra/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { CONSENT_POINTS } from './consent';

// Codes from apps/api/src/modules/messaging/identity.ts. Anything else falls
// back to the server's own message rather than a generic one.
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'CONNECT_TOKEN_EXPIRED') {
      return 'This link has expired or was already used. Send any message to the Aivastra WhatsApp number to get a new one.';
    }
    if (err.code === 'NUMBER_IN_USE') {
      return 'This WhatsApp number is already connected to another Aivastra account. Disconnect it from that account in Settings first.';
    }
  }
  return (err as Error)?.message || 'Something went wrong. Try again.';
}

// Same plain centred column as /connect/wordpress — no boxed card.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{ width: '100%', maxWidth: 520, color: C.text }}>{children}</div>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <h1 style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>{title}</h1>
      <p style={{ fontSize: 14, color: C.mid, lineHeight: 1.6 }}>{body}</p>
    </Shell>
  );
}

function ConnectWhatsappInner() {
  const token = useSearchParams().get('t') ?? '';

  const preview = useQuery({
    queryKey: ['whatsapp-connect-preview', token],
    queryFn: () =>
      api.post<ChatConnectPreviewResponse>('/v1/messaging/connect/chat/preview', { token }),
    enabled: token.length > 0,
    retry: false,
  });

  const confirm = useMutation({
    mutationFn: () =>
      api.post<ChatConnectConfirmResponse>('/v1/messaging/connect/chat/confirm', { token }),
  });

  if (!token) {
    return (
      <Notice
        title="Invalid link"
        body="This link is missing information. Send any message to the Aivastra WhatsApp number to get a new one."
      />
    );
  }
  if (preview.isLoading) return <Notice title="Checking your link…" body="" />;
  if (preview.error)
    return <Notice title="Can't connect this number" body={messageFor(preview.error)} />;
  if (confirm.isSuccess || preview.data?.alreadyConnected) {
    return (
      <Notice
        title="WhatsApp connected"
        body="You can go back to WhatsApp and start creating catalog images. You can disconnect this number at any time in Settings."
      />
    );
  }

  const data = preview.data;
  if (!data) return null;
  return (
    <Shell>
      <h1 style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>
        Connect WhatsApp {data.phoneMasked} to your Aivastra account?
      </h1>
      {/* D29: a hint only. The seller can confirm either way. */}
      <p style={{ fontSize: 13, color: data.matchesProfile ? C.mint : C.amber, marginBottom: 20 }}>
        {data.matchesProfile
          ? 'This is the mobile number on your account.'
          : data.profilePhoneLast4
            ? `This is different from the mobile number on your account (ending ${data.profilePhoneLast4}).`
            : 'Your account has no mobile number saved.'}
      </p>

      <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
        By connecting, you agree that:
      </p>
      <ul style={{ fontSize: 14, color: C.mid, lineHeight: 1.6, paddingLeft: 20, margin: 0 }}>
        {CONSENT_POINTS.map((point) => (
          <li key={point} style={{ marginBottom: 6 }}>
            {point}
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 13, color: C.mid, lineHeight: 1.6, marginTop: 12 }}>
        Your data is handled under our{' '}
        <Link href="/privacy" style={{ color: C.pink }}>
          Privacy Policy
        </Link>{' '}
        and{' '}
        <Link href="/terms" style={{ color: C.pink }}>
          Terms
        </Link>
        . You can stop messages at any time by replying STOP in the chat, or disconnect this number
        in Settings.
      </p>

      {confirm.error && (
        <p style={{ fontSize: 13, color: C.pink, marginTop: 16 }}>{messageFor(confirm.error)}</p>
      )}
      <div style={{ marginTop: 24 }}>
        <GradBtn onClick={() => confirm.mutate()} disabled={confirm.isPending}>
          {confirm.isPending ? 'Connecting…' : 'Connect WhatsApp'}
        </GradBtn>
      </div>
    </Shell>
  );
}

export default function ConnectWhatsappPage() {
  return (
    <Suspense fallback={null}>
      <ConnectWhatsappInner />
    </Suspense>
  );
}
