'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { listApiKeys } from '@/app/(app)/developers/api';
import { C } from '@/components/tokens';
import { GradBtn } from '@/components/ui/grad-btn';
import { api, isMerchantGateError, isMerchantMissingError } from '@/lib/api';
import { connectWordpress } from './api';

interface MeResponse {
  email: string | null;
  displayName: string | null;
}

// Label-above-input, matching the "Enter your contact details" styling used
// elsewhere for collecting this kind of info — plain placeholder-only inputs
// read as a bare, unfinished form for a step that's asking for real account
// details.
function Field({
  label,
  required,
  readOnly,
  ...inputProps
}: {
  label: string;
  required?: boolean;
  readOnly?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ marginBottom: 16, textAlign: 'left' }}>
      <label
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 600,
          color: C.text,
          marginBottom: 6,
        }}
      >
        {label}
        {required && <span style={{ color: C.pink }}> *</span>}
      </label>
      <input
        {...inputProps}
        readOnly={readOnly}
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${C.border}`,
          background: readOnly ? C.border : C.bg,
          color: readOnly ? C.mid : C.text,
          fontSize: 14,
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

// Strips anything non-numeric and caps at 10 digits as the admin types —
// the merchant backend stores this as a plain 10-digit mobile number, so
// enforcing the shape client-side avoids a round trip just to reject letters
// or a too-long paste.
function onlyDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10);
}

// A WordPress site's callback is only ever admin-post.php on the site's own
// origin — this is the open-redirect guard for the final hop back to
// wp-admin: we display the raw site identity below so the merchant can see
// what they're approving, but we also refuse to navigate anywhere that
// doesn't match this shape, regardless of what the query string claims.
function isTrustedCallback(redirectUri: string, siteUrl: string): boolean {
  try {
    const cb = new URL(redirectUri);
    const site = new URL(siteUrl);
    if (cb.protocol !== 'http:' && cb.protocol !== 'https:') return false;
    if (cb.origin !== site.origin) return false;
    return cb.pathname.endsWith('/wp-admin/admin-post.php');
  } catch {
    return false;
  }
}

// Flows straight on the page's own background — no separate white boxed
// panel — matching the plain, single-background treatment the wp-admin
// onboarding screens use (no `.aivastra-card` wrapper around the connect
// form there either). A centered column, not a bordered dialog box.
function Card({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
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
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        {children}
        {footer && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 12,
              marginTop: 32,
              width: '100%',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectWordpressInner() {
  const searchParams = useSearchParams();
  const state = searchParams.get('state') ?? '';
  const siteUrl = searchParams.get('site_url') ?? '';
  const siteName = searchParams.get('site_name') ?? '';
  const redirectUri = searchParams.get('redirect_uri') ?? '';
  const [cancelled, setCancelled] = useState(false);
  const [phone, setPhone] = useState('');

  const trusted = useMemo(
    () => Boolean(state && siteUrl && redirectUri && isTrustedCallback(redirectUri, siteUrl)),
    [state, siteUrl, redirectUri],
  );

  const keysQuery = useQuery({
    queryKey: ['dev-api-keys'],
    queryFn: listApiKeys,
    enabled: trusted,
  });
  const merchantGated = isMerchantGateError(keysQuery.error);
  const merchantMissing = isMerchantMissingError(keysQuery.error);

  // Enabled whenever we might render an authenticated screen at all (trusted
  // callback), not just merchantMissing — the main consent screen shows the
  // logged-in account's name/email too, same as the contact-details step.
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/v1/me'),
    enabled: trusted,
  });

  const connectMutation = useMutation({
    mutationFn: () => connectWordpress(siteUrl, siteName || undefined, phone || undefined),
    onSuccess: ({ code }) => {
      const url = new URL(redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('code', code);
      window.location.href = url.toString();
    },
  });

  function cancel() {
    setCancelled(true);
    const url = new URL(redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('error', 'access_denied');
    window.location.href = url.toString();
  }

  if (!trusted) {
    return (
      <Card>
        <h1 style={{ fontWeight: 700, fontSize: 20, color: C.text, marginBottom: 8 }}>
          Invalid connection request
        </h1>
        <p style={{ fontSize: 14, color: C.mid, lineHeight: 1.6 }}>
          This link is missing information or doesn't point back to a valid WordPress site. Go back
          to your WordPress admin and click &quot;Log in with Ai Vastra&quot; again.
        </p>
      </Card>
    );
  }

  if (merchantGated && !merchantMissing) {
    return (
      <Card>
        <h1 style={{ fontWeight: 700, fontSize: 20, color: C.text, marginBottom: 8 }}>
          Merchant account inactive
        </h1>
        <p style={{ fontSize: 14, color: C.mid, lineHeight: 1.6 }}>
          This account's merchant access has been deactivated. Contact support to get it
          reactivated, then come back to your WordPress admin and try connecting again.
        </p>
      </Card>
    );
  }

  if (merchantMissing) {
    return (
      <Card
        footer={
          <>
            <GradBtn outline onClick={cancel} disabled={connectMutation.isPending}>
              Cancel
            </GradBtn>
            <GradBtn
              final
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
            >
              {connectMutation.isPending ? 'Connecting…' : 'Continue'}
            </GradBtn>
          </>
        }
      >
        <h1 style={{ fontWeight: 700, fontSize: 28, color: C.text, marginBottom: 8 }}>
          Enter your contact details
        </h1>
        <p style={{ fontSize: 14, color: C.mid, lineHeight: 1.6, marginBottom: 24 }}>
          Confirm your details to connect{' '}
          <strong style={{ color: C.text }}>{siteName || siteUrl}</strong>. A phone number is
          optional, but helps us reach you about your Ai Vastra business account.
        </p>

        {connectMutation.isError && (
          <div
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 8,
              border: `1px solid ${C.pink}`,
              background: 'rgba(245,92,122,0.06)',
              fontSize: 13,
              color: C.pink,
              marginBottom: 16,
              textAlign: 'left',
              boxSizing: 'border-box',
            }}
          >
            {connectMutation.error instanceof Error
              ? connectMutation.error.message
              : 'Something went wrong. Try again.'}
          </div>
        )}

        <div style={{ width: '100%' }}>
          <Field
            label="Your Name"
            required
            readOnly
            value={meQuery.data?.displayName ?? (meQuery.isLoading ? 'Loading…' : '')}
          />
          <Field
            label="Your email address"
            required
            readOnly
            value={meQuery.data?.email ?? (meQuery.isLoading ? 'Loading…' : '')}
          />
          <Field
            label="Phone Number"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]{10}"
            maxLength={10}
            value={phone}
            onChange={(e) => setPhone(onlyDigits(e.target.value))}
            autoFocus
          />
        </div>
      </Card>
    );
  }

  if (cancelled) {
    return (
      <Card>
        <p style={{ fontSize: 14, color: C.mid }}>Returning to your WordPress site…</p>
      </Card>
    );
  }

  return (
    <Card
      footer={
        <>
          <GradBtn outline onClick={cancel} disabled={connectMutation.isPending}>
            Cancel
          </GradBtn>
          <GradBtn
            final
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
          >
            {connectMutation.isPending ? 'Connecting…' : 'Connect'}
          </GradBtn>
        </>
      }
    >
      <h1 style={{ fontWeight: 700, fontSize: 28, color: C.text, marginBottom: 24 }}>
        Enter your contact details
      </h1>

      <div style={{ width: '100%' }}>
        <Field
          label="Your Name"
          readOnly
          value={meQuery.data?.displayName ?? (meQuery.isLoading ? 'Loading…' : '')}
        />
        <Field
          label="Your email address"
          readOnly
          value={meQuery.data?.email ?? (meQuery.isLoading ? 'Loading…' : '')}
        />
        <Field
          label="Phone Number"
          type="tel"
          inputMode="numeric"
          pattern="[0-9]{10}"
          maxLength={10}
          value={phone}
          onChange={(e) => setPhone(onlyDigits(e.target.value))}
        />
      </div>

      {connectMutation.isError && (
        <div
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 8,
            border: `1px solid ${C.pink}`,
            background: 'rgba(245,92,122,0.06)',
            fontSize: 13,
            color: C.pink,
            marginBottom: 16,
            textAlign: 'left',
            boxSizing: 'border-box',
          }}
        >
          {connectMutation.error instanceof Error
            ? connectMutation.error.message
            : 'Something went wrong. Try again.'}
        </div>
      )}
    </Card>
  );
}

export default function ConnectWordpressPage(): React.ReactElement {
  return (
    <Suspense fallback={<Card>{null}</Card>}>
      <ConnectWordpressInner />
    </Suspense>
  );
}
