import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';
import GarmentRecognitionsPage from './GarmentRecognitionsPage';

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

interface Status {
  configured: boolean;
  host: string | null;
  reachable: boolean;
  error: string | null;
  rttMs: number | null;
  health: { model: string; uptime_s: number; vram_allocated_mib: number } | null;
}

interface Stats {
  hours: number;
  total: number;
  counts: Record<string, number>;
  p50Ms: number | null;
  p95Ms: number | null;
  lastAnsweredAt: string | null;
}

interface LogItem {
  ts: number;
  level: string;
  msg: string;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'requests', label: 'Requests' },
  { id: 'logs', label: 'Logs' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const WINDOWS = [
  { hours: 1, label: '1 h' },
  { hours: 24, label: '24 h' },
  { hours: 168, label: '7 d' },
];

const ERROR_TEXT: Record<string, string> = {
  not_configured:
    'Not configured: CLASSIFY_SERVICE_URL / CLASSIFY_SERVICE_API_KEY are unset on the api.',
  unreachable: 'Unreachable: the api could not connect to the service.',
};

const LEVEL_COLOR: Record<string, string> = {
  INFO: 'var(--muted)',
  WARNING: 'var(--warn-ink, #f59e0b)',
  ERROR: 'var(--danger-ink, #ef4444)',
};

const label = {
  color: 'var(--muted)',
  fontSize: 10,
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontWeight: 600,
} as const;

const card = {
  padding: '14px 16px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
} as const;

function formatUptime(s: number): string {
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${Math.round(s / 86400)} d`;
}

function Stat({ name, value, hint }: { name: string; value: string; hint?: string }) {
  return (
    <div style={card}>
      <span style={label}>{name}</span>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

interface Config {
  source: 'db' | 'env' | 'none';
  url: string | null;
  apiKeyHint: string | null;
  updatedAt: string | null;
}

const SOURCE_TEXT: Record<Config['source'], string> = {
  db: 'Saved here. The dispatcher picks changes up within ~10 s, no restart.',
  env: 'Using the CLASSIFY_SERVICE_URL / _API_KEY environment variables. Save below to override them.',
  none: 'Not configured yet. Recognition falls back to a ComfyUI worker allowing "classify".',
};

function ConnectionCard({ toast, onChanged }: Props & { onChanged: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'clear' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await apiFetch<Config>('/admin/classify-service/config');
      setConfig(c);
      setUrl(c.url ?? '');
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load connection',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // A blank key means "keep the stored one" on the server; it is never sent back here.
  const body = () => JSON.stringify({ url: url.trim(), ...(apiKey ? { apiKey } : {}) });
  const needsKey = !apiKey && config?.source === 'none';

  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      const r = await apiFetch<{
        ok: boolean;
        error: string | null;
        latencyMs: number;
        model?: string | null;
      }>('/admin/classify-service/test-connection', { method: 'POST', body: body() });
      setResult({
        ok: r.ok,
        text: r.ok
          ? `Connected${r.model ? ` · ${r.model}` : ''} · ${r.latencyMs} ms, API key accepted.`
          : (r.error ?? 'Connection failed'),
      });
    } catch (e) {
      setResult({ ok: false, text: apiErrorMessage(e, 'Test failed.') });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      await apiFetch('/admin/classify-service/config', { method: 'PUT', body: body() });
      setApiKey('');
      setResult({ ok: true, text: 'Saved.' });
      await load();
      onChanged();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to save',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy('clear');
    try {
      await apiFetch('/admin/classify-service/config', { method: 'DELETE' });
      setApiKey('');
      setResult(null);
      await load();
      onChanged();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to clear',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBusy(null);
    }
  };

  const canSubmit = url.trim().length > 0 && !needsKey && busy === null;

  return (
    <div style={card}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Connection</div>
      <div style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 12 }}>
        {config ? SOURCE_TEXT[config.source] : 'Loading…'}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12,
        }}
      >
        <label>
          <span style={label}>Service URL</span>
          <input
            className="input"
            style={{ width: '100%' }}
            value={url}
            placeholder="https://gpu8-classify.aivastra.com"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label>
          <span style={label}>API key</span>
          <input
            className="input"
            style={{ width: '100%' }}
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={
              config?.apiKeyHint
                ? `Saved (${config.apiKeyHint}) — leave blank to keep`
                : 'Paste the key'
            }
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
      </div>
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}
      >
        <button
          type="button"
          className="btn sm secondary"
          disabled={!canSubmit}
          onClick={() => void test()}
        >
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        <button type="button" className="btn sm" disabled={!canSubmit} onClick={() => void save()}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        {config?.source === 'db' && (
          <button
            type="button"
            className="btn sm ghost"
            disabled={busy !== null}
            onClick={() => void clear()}
          >
            {busy === 'clear' ? 'Clearing…' : 'Clear saved'}
          </button>
        )}
        {result && (
          <span
            style={{
              fontSize: 12.5,
              color: result.ok ? 'var(--success-ink, #22c55e)' : 'var(--danger-ink, #ef4444)',
            }}
          >
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}

function Overview({ toast }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [hours, setHours] = useState(24);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await apiFetch<Status>('/admin/classify-service/status'));
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load service status',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }, [toast]);

  useEffect(() => {
    void loadStatus();
    const t = setInterval(() => void loadStatus(), 15_000);
    return () => clearInterval(t);
  }, [loadStatus]);

  useEffect(() => {
    apiFetch<Stats>(`/admin/classify-service/stats?hours=${hours}`)
      .then(setStats)
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load stats',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      );
  }, [hours, toast]);

  const up = status?.reachable === true;
  const answered = stats?.counts.answered ?? 0;
  const rate = stats && stats.total > 0 ? `${Math.round((answered / stats.total) * 100)}%` : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              display: 'inline-block',
              background: !status
                ? 'var(--muted)'
                : up
                  ? 'var(--success-ink, #22c55e)'
                  : 'var(--danger-ink, #ef4444)',
            }}
          />
          <strong>{!status ? 'Checking…' : up ? 'Online' : 'Offline'}</strong>
        </div>
        {status && !up && (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {ERROR_TEXT[status.error ?? ''] ?? `Service answered ${status.error}.`}
          </span>
        )}
        {status?.health && (
          <>
            <div>
              <span style={label}>Model</span>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{status.health.model}</div>
            </div>
            <div>
              <span style={label}>Uptime</span>
              <div>{formatUptime(status.health.uptime_s)}</div>
            </div>
            <div>
              <span style={label}>VRAM held</span>
              <div>{(status.health.vram_allocated_mib / 1024).toFixed(1)} GB</div>
            </div>
            <div>
              <span style={label}>Round trip</span>
              <div>{status.rttMs} ms</div>
            </div>
          </>
        )}
        {status?.host && (
          <div style={{ marginLeft: 'auto' }}>
            <span style={label}>Endpoint</span>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{status.host}</div>
          </div>
        )}
      </div>

      <ConnectionCard toast={toast} onChanged={() => void loadStatus()} />

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>Last</span>
        {WINDOWS.map((w) => (
          <button
            key={w.hours}
            type="button"
            className={`btn sm ${hours === w.hours ? '' : 'secondary'}`}
            onClick={() => setHours(w.hours)}
          >
            {w.label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 12,
        }}
      >
        <Stat name="Requests" value={stats ? String(stats.total) : '…'} />
        <Stat
          name="Answered"
          value={rate}
          hint={stats ? `${answered} of ${stats.total}` : undefined}
        />
        <Stat
          name="Median latency"
          value={stats?.p50Ms != null ? `${stats.p50Ms} ms` : '—'}
          hint="answered only"
        />
        <Stat
          name="p95 latency"
          value={stats?.p95Ms != null ? `${stats.p95Ms} ms` : '—'}
          hint="answered only"
        />
        <Stat
          name="Failed / expired"
          value={stats ? String((stats.counts.failed ?? 0) + (stats.counts.expired ?? 0)) : '…'}
          hint={stats ? `${stats.counts.no_worker ?? 0} no worker` : undefined}
        />
      </div>
    </div>
  );
}

function Logs({ toast }: Props) {
  const [items, setItems] = useState<LogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ items: LogItem[]; error: string | null }>(
        '/admin/classify-service/logs?limit=200',
      );
      setItems(data.items);
      setError(data.error);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load logs',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
          Newest first · refreshes every 10 s · the service keeps its last 500 events in memory (a
          restart clears them; <code>journalctl -u classify</code> on the box has the full record).
        </span>
        <button
          type="button"
          className="btn sm secondary"
          style={{ marginLeft: 'auto' }}
          onClick={() => void load()}
        >
          <Icon.Refresh /> Refresh
        </button>
      </div>
      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : error ? (
        <div style={{ ...card, color: 'var(--muted)' }}>
          {ERROR_TEXT[error] ?? `Service answered ${error}.`}
        </div>
      ) : items.length === 0 ? (
        <div style={{ ...card, color: 'var(--muted)' }}>No log events yet.</div>
      ) : (
        <div
          style={{
            ...card,
            padding: 0,
            fontFamily: 'var(--mono)',
            fontSize: 12,
            maxHeight: '60vh',
            overflowY: 'auto',
          }}
        >
          {items.map((l) => (
            <div
              key={`${l.ts}-${l.level}-${l.msg}`}
              style={{
                display: 'flex',
                gap: 12,
                padding: '5px 12px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {new Date(l.ts * 1000).toLocaleTimeString('en-GB')}
              </span>
              <span
                style={{ color: LEVEL_COLOR[l.level] ?? 'var(--muted)', width: 56, flexShrink: 0 }}
              >
                {l.level}
              </span>
              <span style={{ wordBreak: 'break-word' }}>{l.msg}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function ClassifyServicePage({ toast }: Props) {
  const [tabParam, setTab] = useUrlState('tab');
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'overview';

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>Classify Service</h1>
          <p className="lede" style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>
            The always-loaded vision model that recognises garment types for the WhatsApp bot.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 16,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${tab === t.id ? 'var(--accent, currentColor)' : 'transparent'}`,
              fontWeight: tab === t.id ? 600 : 400,
              cursor: 'pointer',
              color: 'inherit',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview toast={toast} />}
      {tab === 'requests' && <GarmentRecognitionsPage toast={toast} embedded />}
      {tab === 'logs' && <Logs toast={toast} />}
    </>
  );
}
