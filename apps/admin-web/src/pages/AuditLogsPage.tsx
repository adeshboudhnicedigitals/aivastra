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
  resourceLabel: string | null;
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

type ActionRiskTier = 'destructive' | 'sensitive' | 'default';

// Destructive: undoes or removes something. Sensitive: changes who can do what,
// or moves credits/money. Everything else (create/patch/reassign/...) is routine.
function actionRiskTier(action: string): ActionRiskTier {
  if (/\.(delete|revoke|erase|ban)$/.test(action)) return 'destructive';
  if (/\.(update_role|drain|deduct)$/.test(action)) return 'sensitive';
  return 'default';
}

const RISK_TIER_STYLE: Record<ActionRiskTier, { bg: string; ink: string }> = {
  destructive: { bg: 'var(--danger-soft)', ink: 'var(--danger-ink)' },
  sensitive: { bg: 'var(--warn-soft)', ink: 'var(--warn-ink)' },
  default: { bg: 'var(--bg-subtle)', ink: 'inherit' },
};

type DiffStatus = 'added' | 'removed' | 'changed';
interface DiffRow {
  key: string;
  before: string | undefined;
  after: string | undefined;
  status: DiffStatus;
}

const DIFF_ROW_STYLE: Record<DiffStatus, { bg: string; ink: string }> = {
  added: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  removed: { bg: 'var(--danger-soft)', ink: 'var(--danger-ink)' },
  changed: { bg: 'var(--warn-soft)', ink: 'var(--warn-ink)' },
};

// Field-level diff between the before/after JSONB snapshots. Unchanged keys are
// dropped — the point of the view is to surface what actually moved, not to
// re-render the whole payload as two side-by-side dumps.
function computeDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): DiffRow[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const rows: DiffRow[] = [];
  for (const key of keys) {
    const hasBefore = key in b;
    const hasAfter = key in a;
    const beforeStr = hasBefore ? JSON.stringify(b[key]) : undefined;
    const afterStr = hasAfter ? JSON.stringify(a[key]) : undefined;
    if (beforeStr === afterStr) continue;
    rows.push({
      key,
      before: beforeStr,
      after: afterStr,
      status: !hasBefore ? 'added' : !hasAfter ? 'removed' : 'changed',
    });
  }
  return rows.sort((x, y) => x.key.localeCompare(y.key));
}

// Turns "admin_users.update_role" into "Changed admin role" as a last-resort
// fallback for any action this page doesn't have a specific sentence for yet —
// so a new action type never regresses to raw dotted.notation on screen.
function humanizeActionFallback(action: string): string {
  const verb = action.split('.').pop() ?? action;
  const words = verb.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// One plain-English sentence per action, written for a non-technical reader
// (a manager checking "what happened," not an engineer reading a log line).
// `who` is the resolved resource label (an email, a worker name, ...) —
// falls back to the resourceType so the sentence still reads if a label
// couldn't be resolved (e.g. the record was later deleted).
function describeAction(log: AuditLogItem): string {
  const who = log.resourceLabel ?? log.resourceType.replace(/_/g, ' ');
  const after = log.after ?? {};
  const amount = typeof after.amount === 'number' ? after.amount : undefined;
  const role = typeof after.role === 'string' ? after.role : undefined;

  switch (log.action) {
    case 'credits.grant':
      return amount !== undefined ? `Added ${amount} credits to ${who}` : `Added credits to ${who}`;
    case 'credits.deduct':
      return amount !== undefined
        ? `Removed ${amount} credits from ${who}`
        : `Removed credits from ${who}`;
    case 'users.ban':
      return `Banned user ${who}`;
    case 'users.update':
      return `Updated account details for ${who}`;
    case 'users.create':
      return `Created a new user account for ${who}`;
    case 'users.delete':
      return `Deleted user account ${who} (data erasure)`;
    case 'admin_users.approve':
      return `Approved admin access for ${who}`;
    case 'admin_users.reject':
      return `Rejected the admin access request from ${who}`;
    case 'admin_users.update_role':
      return role ? `Changed ${who}'s admin role to ${role}` : `Changed admin role for ${who}`;
    case 'admin_users.revoke':
      return `Removed admin access from ${who}`;
    case 'worker.create':
      return `Added GPU worker "${who}"`;
    case 'worker.update':
      return `Updated GPU worker "${who}"`;
    case 'worker.delete':
      return `Removed GPU worker "${who}"`;
    case 'workflow.create':
      return `Created workflow "${who}"`;
    case 'workflow.update':
      return `Updated workflow "${who}"`;
    case 'workflow.reassign':
      return `Reassigned workflow "${who}"`;
    case 'workflow.delete':
      return `Deleted workflow "${who}"`;
    default:
      return `${humanizeActionFallback(log.action)} — ${who}`;
  }
}

// "role" -> "Role", "workflowType" -> "Workflow Type", falling back to a
// camelCase/snake_case splitter for any field this page doesn't know by name.
const FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  role: 'Role',
  status: 'Status',
  label: 'Name',
  slug: 'Slug',
  url: 'URL',
  isActive: 'Active',
  allowedJobTypes: 'Allowed Job Types',
  workflowType: 'Workflow Type',
  amount: 'Amount',
  reason: 'Reason',
  tier: 'Tier',
  username: 'Username',
  email: 'Email',
  displayName: 'Display Name',
  banReason: 'Ban Reason',
};

function humanizeFieldKey(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Diff values are JSON.stringify'd strings (e.g. `"ADMIN"`, `true`, `null`) so
// they can be diffed as text — render them back as plain values, not raw JSON,
// for a reader who doesn't know what a quoted string or `null` means.
function humanizeFieldValue(jsonStr: string | undefined): string {
  if (jsonStr === undefined) return '(not set)';
  try {
    const value = JSON.parse(jsonStr);
    if (value === null) return '(not set)';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)';
    if (typeof value === 'object') return JSON.stringify(value);
    // Status/role-style bare words (e.g. "active") read better title-cased;
    // leave anything with an @, ., or digit (emails, URLs, IDs) exactly as-is.
    const str = String(value);
    return /^[a-z]+$/.test(str) ? str.charAt(0).toUpperCase() + str.slice(1) : str;
  } catch {
    return jsonStr;
  }
}

// One full sentence per changed field, instead of a FIELD/BEFORE/AFTER grid —
// "Set the Role to ADMIN" reads on its own; a table cell with an em-dash
// doesn't, to someone who isn't reading this as a database diff.
function describeFieldChange(row: DiffRow): string {
  const field = humanizeFieldKey(row.key);
  const after = humanizeFieldValue(row.after);
  const before = humanizeFieldValue(row.before);
  if (row.status === 'added') return `Set the ${field} to ${after}`;
  if (row.status === 'removed') return `Removed the ${field} (was ${before})`;
  return `Changed the ${field} from ${before} to ${after}`;
}

// Plain-English options for the "what kind of activity" dropdown — the value
// sent to the API is still the real action string, exact-matched (the backend
// does a substring `ilike`, which an exact string satisfies too).
const ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'credits.grant', label: 'Credits added' },
  { value: 'credits.deduct', label: 'Credits removed' },
  { value: 'users.ban', label: 'User banned' },
  { value: 'users.update', label: 'User details updated' },
  { value: 'users.create', label: 'User account created' },
  { value: 'users.delete', label: 'User account deleted' },
  { value: 'admin_users.approve', label: 'Admin access approved' },
  { value: 'admin_users.reject', label: 'Admin access request rejected' },
  { value: 'admin_users.update_role', label: 'Admin role changed' },
  { value: 'admin_users.revoke', label: 'Admin access removed' },
  { value: 'worker.create', label: 'Worker added' },
  { value: 'worker.update', label: 'Worker updated' },
  { value: 'worker.delete', label: 'Worker removed' },
  { value: 'workflow.create', label: 'Workflow created' },
  { value: 'workflow.update', label: 'Workflow updated' },
  { value: 'workflow.reassign', label: 'Workflow reassigned' },
  { value: 'workflow.delete', label: 'Workflow deleted' },
];

const RESOURCE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'worker', label: 'Workers' },
  { value: 'workflow', label: 'Workflows' },
  { value: 'user', label: 'Users' },
  { value: 'admin_user', label: 'Team members' },
  { value: 'user_credits', label: 'Credits' },
];

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
  const [actorFilter, setActorFilter] = useState('');
  const [actorFilterLabel, setActorFilterLabel] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      if (actorFilter.trim()) params.set('actorUserId', actorFilter.trim());
      if (startDateFilter) params.set('startDate', new Date(startDateFilter).toISOString());
      if (endDateFilter) {
        // End-of-day so the picked date is inclusive.
        const end = new Date(endDateFilter);
        end.setHours(23, 59, 59, 999);
        params.set('endDate', end.toISOString());
      }

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
  }, [
    page,
    pageSize,
    actionFilter,
    resourceTypeFilter,
    resourceIdFilter,
    actorFilter,
    startDateFilter,
    endDateFilter,
    toast,
  ]);

  const filterByActor = (userId: string, label: string) => {
    setActorFilter(userId);
    setActorFilterLabel(label);
    setPage(1);
  };

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
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Team Activity</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            A permanent record of what your team has done in this admin panel — it can't be edited
            or deleted, even by an admin.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginBottom: '0.75rem',
          alignItems: 'center',
        }}
      >
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="input"
          style={{ flex: '0 1 200px', width: 'auto' }}
        >
          <option value="">All activity</option>
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={resourceTypeFilter}
          onChange={(e) => {
            setResourceTypeFilter(e.target.value);
            setPage(1);
          }}
          className="input"
          style={{ flex: '0 1 170px', width: 'auto' }}
        >
          <option value="">All categories</option>
          {RESOURCE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            fontSize: '0.75rem',
            flex: '0 0 auto',
          }}
        >
          From
          <input
            type="date"
            value={startDateFilter}
            onChange={(e) => {
              setStartDateFilter(e.target.value);
              setPage(1);
            }}
            className="input"
            style={{ width: 'auto' }}
          />
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            fontSize: '0.75rem',
            flex: '0 0 auto',
          }}
        >
          To
          <input
            type="date"
            value={endDateFilter}
            onChange={(e) => {
              setEndDateFilter(e.target.value);
              setPage(1);
            }}
            className="input"
            style={{ width: 'auto' }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setActionFilter('');
            setResourceTypeFilter('');
            setResourceIdFilter('');
            setActorFilter('');
            setActorFilterLabel('');
            setStartDateFilter('');
            setEndDateFilter('');
            setPage(1);
          }}
          className="btn btn--secondary"
          style={{ height: '36px', flex: '0 0 auto' }}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="btn btn--secondary"
          style={{ height: '36px', flex: '0 0 auto', marginLeft: 'auto' }}
        >
          {showAdvanced ? 'Hide ID lookup' : 'Look up by ID'}
        </button>
      </div>

      {showAdvanced && (
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            flexWrap: 'wrap',
            marginBottom: '0.75rem',
            padding: '0.75rem',
            background: 'var(--bg-subtle)',
            borderRadius: '6px',
          }}
        >
          <input
            type="text"
            placeholder="Record ID..."
            value={resourceIdFilter}
            onChange={(e) => {
              setResourceIdFilter(e.target.value);
              setPage(1);
            }}
            className="input"
            style={{ flex: '0 1 220px', width: 'auto' }}
          />
          <input
            type="text"
            placeholder="Team member ID..."
            value={actorFilter}
            onChange={(e) => {
              setActorFilter(e.target.value);
              setActorFilterLabel('');
              setPage(1);
            }}
            className="input"
            style={{ flex: '0 1 220px', width: 'auto' }}
          />
        </div>
      )}

      {actorFilter && (
        <div
          style={{
            marginBottom: '1rem',
            fontSize: '0.8125rem',
            color: 'var(--muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          Showing only: <strong>{actorFilterLabel || actorFilter}</strong>
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            onClick={() => {
              setActorFilter('');
              setActorFilterLabel('');
              setPage(1);
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem' }}>
                WHEN
              </th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem' }}>
                TEAM MEMBER
              </th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem' }}>
                WHAT HAPPENED
              </th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontSize: '0.75rem' }}>
                DETAILS
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={4}
                  style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
                >
                  Loading activity…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
                >
                  Nothing found for these filters.
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
                      <button
                        type="button"
                        onClick={() =>
                          filterByActor(
                            log.actorUserId,
                            log.actorEmail ?? log.actorDisplayName ?? log.actorUserId,
                          )
                        }
                        title="Filter to this actor"
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontWeight: 500,
                          color: 'inherit',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          textDecorationStyle: 'dotted',
                        }}
                      >
                        {log.actorEmail ?? log.actorDisplayName ?? log.actorUserId}
                      </button>
                      <div>
                        <span className="badge" style={{ fontSize: '0.6875rem', marginTop: '2px' }}>
                          {log.actorRole}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                      {(() => {
                        const tier = actionRiskTier(log.action);
                        const style = RISK_TIER_STYLE[tier];
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {tier !== 'default' && (
                              <span
                                title={
                                  tier === 'destructive'
                                    ? 'This removed access, data, or a resource'
                                    : 'This changed permissions or credits'
                                }
                                style={{
                                  display: 'inline-block',
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  background: style.ink,
                                  flexShrink: 0,
                                }}
                              />
                            )}
                            <span>{describeAction(log)}</span>
                          </div>
                        );
                      })()}
                      {log.resourceId && (
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(log.resourceId ?? '')}
                          title="Click to copy the internal record ID"
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            marginTop: '2px',
                            cursor: 'pointer',
                            color: 'var(--muted)',
                            fontSize: '0.6875rem',
                          }}
                        >
                          Record ID: {log.resourceId.slice(0, 8)}…
                        </button>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      {log.before || log.after ? (
                        <button
                          type="button"
                          className="btn btn--sm btn--secondary"
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        >
                          {isExpanded ? 'Hide Details' : 'View Details'}
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
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0 }}>What Changed</h3>
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
            const diff = computeDiff(item.before, item.after);
            if (diff.length === 0) {
              return (
                <p style={{ fontSize: '0.8125rem', color: 'var(--muted)', margin: 0 }}>
                  Nothing else to show for this event.
                </p>
              );
            }
            return (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {diff.map((row) => {
                  const style = DIFF_ROW_STYLE[row.status];
                  return (
                    <li
                      key={row.key}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.5rem',
                        padding: '0.5rem 0.625rem',
                        marginBottom: '0.375rem',
                        background: style.bg,
                        borderRadius: '4px',
                        fontSize: '0.8125rem',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: style.ink,
                          marginTop: '5px',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ color: style.ink }}>{describeFieldChange(row)}</span>
                    </li>
                  );
                })}
              </ul>
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
