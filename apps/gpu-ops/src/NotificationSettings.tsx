import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthRecovery } from './auth';
import {
  FleetAgentApiError,
  loadNotificationSettings,
  type NotificationSettings,
  saveNotificationSettings,
} from './live-agent';

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** One address per line, or separated by commas or spaces. Blank entries are dropped. */
export function splitEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function errorText(cause: unknown): string {
  if (cause instanceof FleetAgentApiError) {
    if (cause.status === 403) return 'Only a super admin can change who is emailed.';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : 'Fleet API request failed.';
}

const SOURCE_NOTE: Record<NotificationSettings['source'], string> = {
  none: 'No one is emailed yet. Add addresses to turn alert emails on.',
  env: "Using the server's FLEET_ALERT_EMAILS list. Saving here replaces it.",
  dashboard: 'Saved here. Saving an empty list turns alert emails off.',
};

export function NotificationSettingsCard({
  baseUrl,
  token,
  authRecovery,
}: {
  baseUrl: string;
  token: string;
  authRecovery: AuthRecovery;
}) {
  const [saved, setSaved] = useState<NotificationSettings | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  // StrictMode runs effect -> cleanup -> effect on mount, so the flag must be re-armed here.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await loadNotificationSettings(baseUrl, token, authRecovery);
      if (!mounted.current) return;
      setSaved(next);
      setText(next.emails.join('\n'));
      setError(null);
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    }
  }, [baseUrl, token, authRecovery]);
  useEffect(() => {
    void load();
  }, [load]);

  const entries = splitEmails(text);
  const invalid = entries.filter((e) => !EMAIL.test(e));
  const dirty = saved !== null && entries.join(',').toLowerCase() !== saved.emails.join(',');

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const next = await saveNotificationSettings(baseUrl, token, entries, authRecovery);
      if (!mounted.current) return;
      setSaved(next);
      setText(next.emails.join('\n'));
      setError(null);
      setStatus(
        next.emails.length
          ? `Saved. ${next.emails.length} recipient(s) will be emailed about warning and critical incidents.`
          : 'Saved. Alert emails are off.',
      );
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section className="panel notification-settings">
      <span className="eyebrow">ALERT EMAILS</span>
      <h3>Who is emailed about incidents</h3>
      <p className="muted">
        Sent when a warning or critical incident opens, escalates or recovers. Info incidents stay
        on the dashboard.
      </p>
      {saved && <p>{SOURCE_NOTE[saved.source]}</p>}
      {error && (
        <div className="permission-panel" role="alert">
          {error}
        </div>
      )}
      <label className="login-field">
        Recipients (one address per line)
        <textarea
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setStatus(null);
          }}
          disabled={saved === null}
        />
      </label>
      {invalid.length > 0 && (
        <p className="text-danger" role="alert">
          Not a valid address: {invalid.slice(0, 3).join(', ')}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="button-secondary"
          disabled={busy || saved === null || invalid.length > 0 || !dirty}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save recipients'}
        </button>
        {status && <span role="status">{status}</span>}
      </div>
    </section>
  );
}
