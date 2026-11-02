import { useState } from 'react';
import { AuthError } from './auth';

// Admin sign-in for live mode. Authorization stays with the API: this only obtains an access
// token, and `requirePermission('fleet.view')` decides what that token may read.
export function LoginForm({
  apiUrl,
  message,
  onLogin,
}: {
  apiUrl: string;
  message: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = error ?? message;
  return (
    <main className="login-page">
      <section className="login-story" aria-label="Fleet operations overview">
        <div className="login-brand">
          <span className="login-brand-mark" aria-hidden="true">
            A
          </span>
          <span>
            AIVASTRA<small>FLEET OPERATIONS</small>
          </span>
        </div>
        <div className="login-story-copy">
          <span className="login-kicker">
            <span className="login-live-dot" /> PRIVATE OPERATIONS CONSOLE
          </span>
          <h1>
            Every GPU.
            <br />
            <span>In its element.</span>
          </h1>
          <p>
            A clear view of your worker fleet, queue health, and live capacity — all in one place.
          </p>
        </div>
        <div className="login-visual" aria-hidden="true">
          <div className="login-orbit login-orbit-one" />
          <div className="login-orbit login-orbit-two" />
          <div className="login-core">
            <span> A </span>
            <i />
          </div>
          <span className="login-node login-node-one" />
          <span className="login-node login-node-two" />
          <span className="login-node login-node-three" />
          <div className="login-visual-label">
            <span>WORKER FLEET</span>
            <b>Observed, not assumed</b>
          </div>
        </div>
        <div className="login-story-foot">
          <span>OBSERVE</span>
          <i /> <span>UNDERSTAND</span>
          <i /> <span>RECONCILE</span>
        </div>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <div className="login-card-heading">
            <span className="login-card-icon" aria-hidden="true">
              ↗
            </span>
            <span className="login-kicker">SECURE ACCESS</span>
          </div>
          <h2 id="login-title">Welcome back</h2>
          <p className="login-intro">Sign in with your admin account to continue.</p>
          <div className="login-permission">
            <span className="login-permission-icon" aria-hidden="true">
              ◈
            </span>
            <span>
              Read-only fleet access <b>·</b> <code>fleet.view</code>
            </span>
          </div>
          <p className="login-endpoint">
            API endpoint <code>{apiUrl}</code>
          </p>
          {shown && (
            <p role="alert" className="login-error">
              <span aria-hidden="true">!</span>
              {shown}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              onLogin(email.trim(), password)
                .catch((err: unknown) => {
                  setPassword('');
                  setError(err instanceof AuthError ? err.message : 'Sign-in failed.');
                })
                .finally(() => setBusy(false));
            }}
          >
            <label className="login-field">
              <span>Email address</span>
              <input
                type="email"
                name="email"
                aria-label="Email address"
                placeholder="you@company.com"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="login-field">
              <span>Password</span>
              <input
                type="password"
                name="password"
                aria-label="Password"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button
              className="login-submit"
              type="submit"
              disabled={busy || !email.trim() || !password}
            >
              <span>{busy ? 'Signing in…' : 'Sign in to fleet'}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="login-security">
            <span aria-hidden="true">▣</span> Read-only access. Signing out ends your session.
          </p>
        </div>
        <footer className="login-footer">
          <span>© 2026 AIVASTRA</span>
          <span>GPU FLEET CONTROL PLANE</span>
        </footer>
      </section>
    </main>
  );
}
