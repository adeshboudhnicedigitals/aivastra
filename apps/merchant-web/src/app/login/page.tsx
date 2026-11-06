'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { C } from '@/components/tokens';
import { initToken } from '@/lib/api';
import { errorBodyMessage } from '@/lib/errors';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json().catch(() => null)) as { accessToken?: string } | null;
      if (!res.ok || !body?.accessToken) {
        setError(errorBodyMessage(body) ?? 'Unable to sign in. Try again.');
        return;
      }
      initToken(body.accessToken);
      router.push('/');
    } catch {
      setError('Unable to reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'h-11 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2';
  const inputStyle = { background: C.field, borderColor: C.border, color: C.text };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border p-6"
        style={{ background: C.card, borderColor: C.border }}
      >
        <h1 className="text-xl font-semibold" style={{ color: C.text }}>
          Sign in to AiVastra Merchant
        </h1>
        <label className="block text-sm" style={{ color: C.mid }}>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} mt-1`}
            style={inputStyle}
          />
        </label>
        <label className="block text-sm" style={{ color: C.mid }}>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} mt-1`}
            style={inputStyle}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm" style={{ color: C.danger }}>
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="h-11 w-full rounded-lg text-sm font-semibold disabled:opacity-60"
          style={{ background: C.btnPrimary, color: C.onDark }}
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
