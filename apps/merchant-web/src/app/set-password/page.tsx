'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
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
  fontSize: 14,
  width: '100%',
  boxSizing: 'border-box',
};

function Form() {
  const router = useRouter();
  const toast = useToast();
  // The link carries the token in the query string; it is single use and expires in 72 hours.
  const token = useSearchParams().get('token') ?? '';
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = token.length > 0 && pw.length >= 8 && pw === again;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/auth/accept-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.show(
          errorBodyMessage(body) ??
            'This link is invalid or has expired. Ask your AiVastra contact for a new one.',
        );
        return;
      }
      toast.show('Password set. Sign in to continue.', 'success');
      router.push('/login');
    } catch {
      toast.show('Unable to reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: C.bg,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: '100%',
          maxWidth: 380,
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: 24,
          display: 'grid',
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0, color: C.text }}>Set your password</h1>
        {!token && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: C.danger }}>
            This link is missing its token. Open the link from your invitation email.
          </p>
        )}
        <input
          aria-label="New password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          placeholder="New password (8+ characters)"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          style={field}
        />
        <input
          aria-label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="Confirm password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          style={field}
        />
        {again.length > 0 && pw !== again && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: C.danger }}>
            Passwords do not match.
          </p>
        )}
        <button
          type="submit"
          disabled={!valid || busy}
          style={{
            height: 44,
            borderRadius: 8,
            border: 'none',
            background: C.btnPrimary,
            color: C.white,
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 600,
            cursor: valid ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? 'Saving...' : 'Set password'}
        </button>
      </form>
    </main>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <Form />
    </Suspense>
  );
}
