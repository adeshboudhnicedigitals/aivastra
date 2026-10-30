import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { StatusBadge } from '../../components/StatusBadge';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import type { User } from '../../types';

function fmtTs(ts?: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNav: (_page: string) => void;
}

export default function SupportUsersPanel({ toast, onNav }: Props) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<User | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '25' });
        if (q) params.set('search', q);
        const data = await apiFetch<{ items: User[]; total: number }>(
          `/admin/users?${params.toString()}`,
        );
        setRows(data.items);
        setTotal(data.total);
      } catch (e) {
        toast({
          kind: 'error',
          title: 'Failed to load users',
          body: apiErrorMessage(e, 'Please try again.'),
        });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    apiFetch<User>(`/admin/users/${selectedId}`)
      .then(setDetail)
      .catch((e) =>
        toast({
          kind: 'error',
          title: 'Failed to load user',
          body: apiErrorMessage(e, 'Please try again.'),
        }),
      )
      .finally(() => setDetailLoading(false));
  }, [selectedId, toast]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="lede">
            {loading ? 'Loading…' : `${total.toLocaleString()} accounts`} — search and review user
            accounts, credits and recent activity.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: '2 1 560px', minWidth: 320 }}>
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              padding: '4px 12px',
              gap: 10,
              minHeight: 52,
            }}
          >
            <div className="search" style={{ flex: 1 }}>
              <Icon.Search />
              <input
                placeholder="Search name, email, username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void load(search);
                }}
              />
            </div>
            <button className="btn primary" onClick={() => void load(search)}>
              Search
            </button>
          </div>

          {loading ? (
            <div
              style={{
                color: 'var(--muted)',
                fontSize: 13,
                padding: '32px 0',
                textAlign: 'center',
              }}
            >
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <div className="ico">
                <Icon.Users />
              </div>
              {search ? 'No users match your search.' : 'Search for a user to see their details.'}
            </div>
          ) : (
            <div className="table-wrap">
              <div style={{ fontSize: 12, color: 'var(--muted)', padding: '0 4px 6px' }}>
                {total} total
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Tier</th>
                    <th>Jobs</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => setSelectedId(u.id)}
                      style={{
                        cursor: 'pointer',
                        background: selectedId === u.id ? 'var(--accent-soft)' : undefined,
                      }}
                    >
                      <td>
                        <span style={{ fontWeight: 500 }}>
                          {u.displayName || u.username || '—'}
                        </span>
                        {u.isBanned && (
                          <span className="badge danger" style={{ marginLeft: 6 }}>
                            Banned
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="sub">{u.email}</span>
                      </td>
                      <td>
                        <span className="badge">{u.tier}</span>
                      </td>
                      <td>{u.totalJobs}</td>
                      <td>{u.balance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 320px', minWidth: 280 }}>
          {!selectedId ? (
            <div className="empty" style={{ height: '100%' }}>
              <div className="ico">
                <Icon.Eye />
              </div>
              Select a user to view their profile.
            </div>
          ) : detailLoading || !detail ? (
            <div
              style={{
                color: 'var(--muted)',
                fontSize: 13,
                padding: '32px 0',
                textAlign: 'center',
              }}
            >
              Loading…
            </div>
          ) : (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                    {detail.displayName || detail.username || 'Unnamed user'}
                  </h3>
                  {detail.isBanned && (
                    <span className="badge danger" style={{ marginTop: 6 }}>
                      Banned{detail.banReason ? `: ${detail.banReason}` : ''}
                    </span>
                  )}
                </div>
                <button
                  className="btn ghost"
                  onClick={() => onNav(`users?user=${encodeURIComponent(detail.id)}`)}
                >
                  <Icon.ExternalLink /> Open full profile
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 10,
                }}
              >
                <KV k="Email" v={detail.email} />
                <KV k="Phone" v={detail.phone} />
                <KV k="Tier" v={detail.tier} />
                <KV k="Balance" v={String(detail.balance)} />
                <KV k="Total jobs" v={String(detail.totalJobs)} />
                <KV k="Last job" v={fmtTs(detail.lastJobAt)} />
                <KV k="Joined" v={fmtTs(detail.createdAt)} />
                {detail.isMerchant && <KV k="Merchant" v="Yes" />}
              </div>

              {detail.recentJobs && detail.recentJobs.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--muted)',
                      marginBottom: 8,
                    }}
                  >
                    Recent jobs
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {detail.recentJobs.slice(0, 8).map((j) => (
                      <div
                        key={j.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 12,
                        }}
                      >
                        <StatusBadge status={j.status} />
                        <span style={{ color: 'var(--muted)' }}>{fmtTs(j.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v?: string | null }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 2,
        }}
      >
        {k}
      </div>
      <div style={{ fontSize: 13 }}>{v || '—'}</div>
    </div>
  );
}
