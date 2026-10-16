import { useState } from 'react';

// Interim sign-in: an admin access token pasted by the operator and kept for this tab only
// (sessionStorage, never localStorage). A real login flow belongs with the dashboard's own
// domain; until then this keeps the API's `requirePermission` check as the only gate.
export function ConnectForm({
  apiUrl,
  message,
  onToken,
}: {
  apiUrl: string;
  message: string | null;
  onToken: (token: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <main className="load-state">
      <h1>Connect to the fleet API</h1>
      <p>
        Read-only. Paste an admin access token for <code>{apiUrl}</code> that has the{' '}
        <code>fleet.view</code> permission. It is kept in this tab only.
      </p>
      {message && (
        <p role="alert" className="text-danger">
          {message}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const token = value.trim();
          if (token) onToken(token);
        }}
      >
        <label>
          Access token
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!value.trim()}>
          Connect
        </button>
      </form>
    </main>
  );
}
