'use client';
import { useEffect, useRef, useState } from 'react';
import { C } from '@/components/tokens';
import { useToast } from '@/components/ui/toast';
import { errorBodyMessage } from '@/lib/errors';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const field: React.CSSProperties = {
  height: 44,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  background: C.field,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 16,
  width: '100%',
  boxSizing: 'border-box',
  letterSpacing: 2,
};
const primary: React.CSSProperties = {
  height: 44,
  borderRadius: 8,
  border: 'none',
  background: C.btnPrimary,
  color: C.white,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
const link: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: C.mid,
  fontFamily: 'inherit',
  fontSize: 13,
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
};

type Step = 'verify' | 'enroll';

async function call(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/auth/mfa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

// Second step of a team sign-in, shown on the same /login page. An enrolled admin types a
// 6-digit code (or a recovery code); a gated admin who has not enrolled yet sets up their
// authenticator first and is shown their one-time recovery codes.
export function MfaStep({
  step,
  mfaToken,
  onDone,
  onCancel,
}: {
  step: Step;
  mfaToken: string;
  onDone: (accessToken: string) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [saved, setSaved] = useState<{ token: string; codes: string[] } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (step !== 'enroll' || started.current) return;
    started.current = true;
    void (async () => {
      const { res, json } = await call({ action: 'enroll-start', mfaToken });
      if (res.ok && json?.secret) setSetup(json as { secret: string; otpauthUri: string });
      else toast.show(errorBodyMessage(json) ?? 'Could not start setup. Sign in again.');
    })();
  }, [step, mfaToken, toast]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { res, json } = await call(
        step === 'enroll'
          ? { action: 'enroll-confirm', mfaToken, code }
          : { action: 'verify', mfaToken, ...(useRecovery ? { recoveryCode: code } : { code }) },
      );
      const token = json?.accessToken as string | undefined;
      if (!res.ok || !token) {
        toast.show(errorBodyMessage(json) ?? 'That code did not work. Try again.');
        return;
      }
      const codes = json?.recoveryCodes as string[] | undefined;
      if (codes?.length) setSaved({ token, codes });
      else onDone(token);
    } catch {
      toast.show('Unable to reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: C.bg,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: 24,
          display: 'grid',
          gap: 12,
        }}
      >
        {children}
      </div>
    </main>
  );

  if (saved) {
    return shell(
      <>
        <h1 style={{ fontSize: 20, margin: 0, color: C.text }}>Save your recovery codes</h1>
        <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
          Each code works once if you lose your phone. They are shown only now. Store them in a
          password manager.
        </p>
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: C.field,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: 14,
            color: C.text,
            userSelect: 'all',
          }}
        >
          {saved.codes.join('\n')}
        </pre>
        <button type="button" style={primary} onClick={() => onDone(saved.token)}>
          I have saved them
        </button>
      </>,
    );
  }

  return shell(
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <h1 style={{ fontSize: 20, margin: 0, color: C.text }}>
        {step === 'enroll' ? 'Set up two-factor sign-in' : 'Two-factor code'}
      </h1>
      {step === 'enroll' ? (
        <>
          <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
            Your role needs a second factor. In an authenticator app (Google Authenticator,
            1Password, Authy), add an account with this key, then enter the 6-digit code it shows.
          </p>
          <code
            style={{
              padding: 12,
              background: C.field,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              wordBreak: 'break-all',
              color: C.text,
              userSelect: 'all',
            }}
          >
            {setup?.secret ?? 'Preparing...'}
          </code>
          {setup && (
            <a href={setup.otpauthUri} style={{ fontSize: 13, color: C.mid }}>
              Open in an authenticator app on this device
            </a>
          )}
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
          {useRecovery
            ? 'Enter one of your recovery codes.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </p>
      )}
      <input
        aria-label={useRecovery ? 'Recovery code' : '6-digit code'}
        inputMode={useRecovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoFocus
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
        style={field}
      />
      <button type="submit" style={primary} disabled={busy || (step === 'enroll' && !setup)}>
        {busy ? 'Checking...' : step === 'enroll' ? 'Turn on and sign in' : 'Verify'}
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {step === 'verify' ? (
          <button
            type="button"
            style={link}
            onClick={() => {
              setUseRecovery(!useRecovery);
              setCode('');
            }}
          >
            {useRecovery ? 'Use my authenticator app' : 'Use a recovery code'}
          </button>
        ) : (
          <span />
        )}
        <button type="button" style={link} onClick={onCancel}>
          Back to sign in
        </button>
      </div>
    </form>,
  );
}
