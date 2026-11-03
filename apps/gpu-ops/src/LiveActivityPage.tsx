import { useCallback, useEffect, useState } from 'react';
import type { AuthRecovery } from './auth';
import {
  type ActivityList,
  type ActivitySource,
  activityErrorMessage,
  loadActivity,
} from './live-activity';

const PAGE_SIZE = 50;
const SOURCE_LABEL: Record<ActivitySource, string> = {
  AUDIT: 'Operator actions',
  INCIDENT: 'Incident timeline',
  COMMAND: 'Command outcomes',
};

export function LiveActivityPage({
  baseUrl,
  token,
  authRecovery,
}: {
  baseUrl: string;
  token: string;
  authRecovery: AuthRecovery;
}) {
  const [source, setSource] = useState<ActivitySource | ''>('');
  const [workerDraft, setWorkerDraft] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ActivityList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await loadActivity(
          baseUrl,
          token,
          {
            ...(source ? { source: [source] } : {}),
            ...(workerId ? { workerId } : {}),
            limit: PAGE_SIZE,
            offset,
          },
          { recovery: authRecovery },
        ),
      );
      setError(null);
    } catch (cause) {
      setData(null);
      setError(activityErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, token, source, workerId, offset, authRecovery]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const items = data?.items ?? [];
  return (
    <section className="incidents-page">
      <div className="live-intro incidents-intro">
        <div>
          <span className="eyebrow">AUDIT TRAIL</span>
          <h2>Activity log</h2>
          <p>
            What operators and the system did: audited actions, incident timelines and finished
            commands, newest first. Read-only; each source stays the record of truth.
          </p>
        </div>
      </div>
      <form
        className="incident-filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setWorkerId(workerDraft.trim());
        }}
      >
        <label className="incident-worker-filter">
          Source
          <select
            value={source}
            onChange={(event) => {
              setSource(event.target.value as ActivitySource | '');
              setOffset(0);
            }}
          >
            <option value="">All sources</option>
            {(Object.keys(SOURCE_LABEL) as ActivitySource[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="incident-worker-filter">
          Worker ID
          <input
            value={workerDraft}
            onChange={(event) => setWorkerDraft(event.target.value)}
            maxLength={100}
            placeholder="Any worker"
          />
        </label>
        <button className="button-secondary" type="submit">
          Apply filters
        </button>
      </form>
      {error && (
        <div className="permission-panel" role="alert">
          {error}
        </div>
      )}
      <div className="incident-list-heading">
        <span>
          {loading
            ? 'Loading activity…'
            : data
              ? `${items.length === 0 ? 0 : offset + 1}–${offset + items.length}${data.hasMore ? '+' : ''} shown`
              : 'Activity unavailable'}
        </span>
        <button
          className="link-button"
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>
      {data && items.length === 0 && (
        <div className="panel incident-empty">
          <span className="eyebrow">NOTHING RECORDED</span>
          <h3>No activity recorded</h3>
          <p>No operator actions, incident events or command outcomes match these filters.</p>
        </div>
      )}
      {items.length > 0 && (
        <div className="table-wrap incident-table-wrap">
          <table className="incident-table">
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>Source</th>
                <th>Worker</th>
                <th>What happened</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.at.replace('T', ' ').replace(/\.\d+Z$/, 'Z')}</td>
                  <td>{SOURCE_LABEL[item.source]}</td>
                  <td>{item.workerId ?? '—'}</td>
                  <td>{item.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="incident-pager">
        <button
          className="button-secondary"
          type="button"
          disabled={loading || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Newer
        </button>
        <button
          className="button-secondary"
          type="button"
          disabled={loading || !data?.hasMore || offset + PAGE_SIZE > 1000}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Older
        </button>
      </div>
    </section>
  );
}
