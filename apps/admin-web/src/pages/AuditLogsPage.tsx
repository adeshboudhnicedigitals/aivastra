import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../lib/data';

interface AuditLogItem {
  id: string;
  actorUserId: string;
  actorRole: string;
  actorEmail: string | null;
  actorDisplayName: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

interface AuditLogsResponse {
  page: number;
  pageSize: number;
  total: number;
  items: AuditLogItem[];
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function AuditLogsPage({ toast }: Props) {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(true);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [resourceIdFilter, setResourceIdFilter] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      if (resourceTypeFilter.trim()) params.set('resourceType', resourceTypeFilter.trim());
      if (resourceIdFilter.trim()) params.set('resourceId', resourceIdFilter.trim());

      const data = await apiFetch<AuditLogsResponse>(`/admin/audit-logs?${params.toString()}`);
      setLogs(data.items);
      setTotal(data.total);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load audit logs',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, actionFilter, resourceTypeFilter, resourceIdFilter, toast]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / pageSize) || 1;

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            Activity & Audit Trail
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Immutable, append-only operational history of administrative actions.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          placeholder="Filter by action (e.g. worker.create)..."
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="input"
          style={{ minWidth: '220px' }}
        />
        <input
          type="text"
          placeholder="Resource type (e.g. worker)..."
          value={resourceTypeFilter}
          onChange={(e) => {
            setResourceTypeFilter(e.target.value);
            setPage(1);
          }}
          className="input"
          style={{ minWidth: '180px' }}
        />
        <input
          type="text"
          placeholder="Resource ID..."
          value={resourceIdFilter}
          onChange={(e) => {
            setResourceIdFilter(e.target.value);
            setPage(1);
          }}
          className="input"
          style={{ minWidth: '180px' }}
        />
        <button
          type="button"
          onClick={() => {
            setActionFilter('');
            setResourceTypeFilter('');
            setResourceIdFilter('');
            setPage(1);
          }}
          className="btn btn--secondary"
          style={{ height: '36px' }}
        >
          Reset
        </button>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem' }}>
                TIME
              </th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem' }}>
                ACTOR
              </th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem' }}>
                ACTION
              </th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem' }}>
                RESOURCE
              </th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem' }}>
                RESOURCE ID
              </th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontSize: '0.75rem' }}>
                DIFF
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
                >
                  Loading activity logs…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
                >
                  No audit logs found matching criteria.
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const isExpanded = expandedLogId === log.id;
                return (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td
                      style={{
                        padding: '0.75rem 1rem',
                        fontSize: '0.8125rem',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatDate(log.createdAt)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem' }}>
                      <div style={{ fontWeight: 500 }}>
                        {log.actorEmail ?? log.actorDisplayName ?? log.actorUserId}
                      </div>
                      <span className="badge" style={{ fontSize: '0.6875rem', marginTop: '2px' }}>
                        {log.actorRole}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem' }}>
                      <code
                        style={{
                          fontSize: '0.75rem',
                          background: 'var(--bg-subtle)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        {log.action}
                      </code>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem' }}>
                      {log.resourceType}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem' }}>
                      <code style={{ fontSize: '0.75rem' }}>{log.resourceId ?? '—'}</code>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      {log.before || log.after ? (
                        <button
                          type="button"
                          className="btn btn--sm btn--secondary"
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        >
                          {isExpanded ? 'Hide Payload' : 'View Payload'}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Expanded Modal / Details for selected log */}
      {expandedLogId && (
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            background: 'var(--bg-subtle)',
            borderRadius: '6px',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0 }}>
              Payload Diff / Details
            </h3>
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={() => setExpandedLogId(null)}
            >
              Close
            </button>
          </div>
          {(() => {
            const item = logs.find((l) => l.id === expandedLogId);
            if (!item) return null;
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--muted)',
                      marginBottom: '0.25rem',
                    }}
                  >
                    BEFORE STATE
                  </div>
                  <pre
                    style={{
                      background: 'var(--bg)',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      overflowX: 'auto',
                      border: '1px solid var(--border)',
                      maxHeight: '300px',
                    }}
                  >
                    {item.before ? JSON.stringify(item.before, null, 2) : 'null'}
                  </pre>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--muted)',
                      marginBottom: '0.25rem',
                    }}
                  >
                    AFTER STATE
                  </div>
                  <pre
                    style={{
                      background: 'var(--bg)',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      overflowX: 'auto',
                      border: '1px solid var(--border)',
                      maxHeight: '300px',
                    }}
                  >
                    {item.after ? JSON.stringify(item.after, null, 2) : 'null'}
                  </pre>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1rem',
          }}
        >
          <span style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
            Showing {logs.length} of {total} events
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span style={{ padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
