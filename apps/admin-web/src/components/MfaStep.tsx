import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../lib/data';

type Step = 'verify' | 'enroll';

const input: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r)',
  background: 'var(--surface-2)',
  color: 'var(--ink)',
  fontSize: '1rem',
  letterSpacing: '0.1em',
  width: '100%',
  boxSizing: 'border-box',
};
const primary: React.CSSProperties = {
  padding: '0.5625rem',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--r)',
  fontSize: '0.875rem',
  fontWeight: 600,
  cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--muted)',
  fontSize: '0.8125rem',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
};

function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.status === 429)
    return 'Too many attempts. Try again in 15 minutes.';
  if (err instanceof ApiError && err.status === 401) return 'That code did not work. Try again.';
  return 'Something went wrong. Try again.';
}

// Second step of an admin sign-in: a 6-digit code or a recovery code for an enrolled admin; first-time
// setup (with one-time recovery codes) for a role that must use two-factor.
export function MfaStep({
  step,
  mfaToken,
  onDone,
  onCancel,
}: {
  step: Step;
  mfaToken: string;
  onDone: (accessToken: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [saved, setSaved] = useState<{ token: string; codes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (step !== 'enroll' || started.current) return;
    started.current = true;
    apiFetch<{ secret: string; otpauthUri: string }>('/admin/auth/mfa/enroll/start', {
      method: 'POST',
      body: JSON.stringify({ mfaToken }),
    })
      .then(setSetup)
      .catch(() => setError('Could not start setup. Sign in again.'));
  }, [step, mfaToken]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (step === 'enroll') {
        const r = await apiFetch<{ accessToken: string; recoveryCodes: string[] }>(
          '/admin/auth/mfa/enroll/confirm',
          { method: 'POST', body: JSON.stringify({ mfaToken, code }) },
        );
        setSaved({ token: r.accessToken, codes: r.recoveryCodes });
      } else {
        const r = await apiFetch<{ accessToken: string }>('/admin/auth/mfa/verify', {
          method: 'POST',
          body: JSON.stringify({ mfaToken, ...(useRecovery ? { recoveryCode: code } : { code }) }),
        });
        await onDone(r.accessToken);
      }
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          padding: '2rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.875rem',
        }}
      >
        {children}
      </div>
    </div>
  );

  if (saved) {
    return shell(
      <>
        <div style={{ fontWeight: 700, color: 'var(--ink)' }}>Save your recovery codes</div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
          Each works once if you lose your phone. They are shown only now. Keep them in a password
          manager.
        </div>
        <pre
          style={{
            margin: 0,
            padding: '0.75rem',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r)',
            color: 'var(--ink)',
            userSelect: 'all',
          }}
        >
          {saved.codes.join('\n')}
        </pre>
        <button type="button" style={primary} onClick={() => void onDone(saved.token)}>
          I have saved them
        </button>
      </>,
    );
  }

  return shell(
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
        {step === 'enroll' ? 'Set up two-factor sign-in' : 'Two-factor code'}
      </div>
      {step === 'enroll' ? (
        <>
          <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
            Your role needs a second factor. Add an account with this key in an authenticator app,
            then enter the 6-digit code it shows.
          </div>
          <code
            style={{
              padding: '0.75rem',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r)',
              wordBreak: 'break-all',
              color: 'var(--ink)',
              userSelect: 'all',
            }}
          >
            {setup?.secret ?? 'Preparing…'}
          </code>
        </>
      ) : (
        <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
          {useRecovery
            ? 'Enter one of your recovery codes.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </div>
      )}
      <input
        aria-label={useRecovery ? 'Recovery code' : '6-digit code'}
        inputMode={useRecovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        // biome-ignore lint/a11y/noAutofocus: the code field is the only thing on this step
        autoFocus
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
        style={input}
      />
      {error && (
        <div
          role="alert"
          style={{
            padding: '0.5rem 0.75rem',
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger-border)',
            borderRadius: 'var(--r)',
            color: 'var(--danger-ink)',
            fontSize: '0.8125rem',
          }}
        >
          {error}
        </div>
      )}
      <button type="submit" style={primary} disabled={busy || (step === 'enroll' && !setup)}>
        {busy ? 'Checking…' : step === 'enroll' ? 'Turn on and sign in' : 'Verify'}
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {step === 'verify' ? (
          <button
            type="button"
            style={linkBtn}
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
        <button type="button" style={linkBtn} onClick={onCancel}>
          Back to sign in
        </button>
      </div>
    </form>,
  );
}
