'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { C } from '@/components/tokens';
import { useToast } from '@/components/ui/toast';
import { errorBodyMessage } from '@/lib/errors';
import { initHqToken } from '@/lib/hq-api';

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

// The team console sign-in. Deliberately its own page (spec §2 #7): an explicit mode, never
// guessed from the account, and no Google button.
export default function HqLogin() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/hq/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json().catch(() => null)) as { accessToken?: string } | null;
      if (!res.ok || !body?.accessToken) {
        toast.show(errorBodyMessage(body) ?? 'Unable to sign in. Try again.');
        return;
      }
      initHqToken(body.accessToken);
      router.push('/hq/accounts');
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
        <h1 style={{ fontSize: 20, margin: 0, color: C.text }}>AiVastra team sign-in</h1>
        <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
          For AiVastra staff only. Retailers sign in at the main page.
        </p>
        <input
          aria-label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={field}
        />
        <input
          aria-label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={field}
        />
        <button
          type="submit"
          disabled={busy}
          style={{
            height: 44,
            borderRadius: 8,
            border: 'none',
            background: C.btnPrimary,
            color: C.white,
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
