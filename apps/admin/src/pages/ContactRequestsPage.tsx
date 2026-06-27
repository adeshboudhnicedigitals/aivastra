import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/data';
import type { ContactRequest } from '../types';

const STATUS_LABEL: Record<string, string> = { new: 'New', read: 'Read', done: 'Done' };
const STATUS_COLOR: Record<string, string> = {
  new: 'var(--danger, #e53935)',
  read: 'var(--accent, #6366f1)',
  done: 'var(--success, #4caf50)',
};

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNav: (_page: string) => void;
}

export default function ContactRequestsPage({ toast }: Props) {
  const { storagePublicUrl } = useAuth();
  const [rows, setRows] = useState<ContactRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'read' | 'done'>('all');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const notifPermRef = useRef(false);
  const prevNewCountRef = useRef<number | null>(null);

  const load = useCallback(
    async (filter: string, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await apiFetch<{ rows: ContactRequest[]; total: number }>(
          `/admin/contact-requests?status=${filter}&limit=100`,
        );
        setRows(data.rows);
        setTotal(data.total);
        return data.rows;
      } catch {
        if (!silent) toast({ kind: 'error', title: 'Failed to load contact requests' });
        return null;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [toast],
  );

  // Browser notification on new requests
  useEffect(() => {
    if (
      !notifPermRef.current &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      void Notification.requestPermission();
    }
    notifPermRef.current = true;
  }, []);

  // Initial load + poll every 5s
  useEffect(() => {
    void load(statusFilter);

    // Seed initial unread count
    apiFetch<{ count: number }>('/admin/contact-requests/unread-count')
      .then(({ count }) => {
        prevNewCountRef.current = count;
      })
      .catch(() => {});

    const poll = setInterval(async () => {
      const { count } = await apiFetch<{ count: number }>(
        '/admin/contact-requests/unread-count',
      ).catch(() => ({ count: 0 }));

      const prev = prevNewCountRef.current;
      const isNew = prev !== null && count > prev;

      if (isNew && 'Notification' in window && Notification.permission === 'granted') {
        const delta = count - (prev ?? 0);
        new Notification('New contact request', {
          body: `${delta} new enquir${delta === 1 ? 'y' : 'ies'} received`,
          icon: '/favicon.ico',
        });
      }

      // Always reload list silently so page stays fresh
      void load(statusFilter, true);
      prevNewCountRef.current = count;
    }, 5_000);

    return () => clearInterval(poll);
  }, [load, statusFilter]);

  const setStatus = async (id: string, status: ContactRequest['status']) => {
    try {
      const updated = await apiFetch<ContactRequest>(`/admin/contact-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      toast({ title: `Marked as ${STATUS_LABEL[status]}` });
    } catch {
      toast({ kind: 'error', title: 'Failed to update status' });
    }
  };

  const filters: Array<'all' | 'new' | 'read' | 'done'> = ['all', 'new', 'read', 'done'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Contact Requests</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            {total} request{total !== 1 ? 's' : ''} total
          </p>
        </div>
        <button className="btn ghost" onClick={() => void load(statusFilter)}>
          <Icon.Refresh /> Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        {filters.map((f) => (
          <button
            key={f}
            className={`btn sm ${statusFilter === f ? 'primary' : 'ghost'}`}
            onClick={() => {
              setStatusFilter(f);
              void load(f);
            }}
            style={{ textTransform: 'capitalize' }}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div
          style={{ color: 'var(--muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}
        >
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: '48px 24px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: 13,
          }}
        >
          No contact requests{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.map((r) => {
            const isExpanded = expanded === r.id;
            return (
              <div
                key={r.id}
                className="card"
                style={{
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  borderRadius: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Status badge */}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: `${STATUS_COLOR[r.status]}18`,
                      color: STATUS_COLOR[r.status],
                      flexShrink: 0,
                    }}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>

                  {/* Name + email */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>
                      {r.email}
                    </span>
                  </div>

                  {/* Source */}
                  {r.source && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 7px',
                        borderRadius: 8,
                        background: 'var(--accent, #6366f1)18',
                        color: 'var(--accent, #6366f1)',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.source}
                    </span>
                  )}

                  {/* Phone */}
                  <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
                    {r.phone}
                  </span>

                  {/* Date */}
                  <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                    {new Date(r.createdAt).toLocaleString()}
                  </span>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {r.status === 'new' && (
                      <button
                        className="btn sm ghost"
                        onClick={() => void setStatus(r.id, 'read')}
                        title="Mark read"
                      >
                        <Icon.Eye />
                      </button>
                    )}
                    {r.status !== 'done' && (
                      <button
                        className="btn sm ghost"
                        onClick={() => void setStatus(r.id, 'done')}
                        title="Mark done"
                      >
                        <Icon.Check />
                      </button>
                    )}
                    {r.status === 'done' && (
                      <button
                        className="btn sm ghost"
                        onClick={() => void setStatus(r.id, 'new')}
                        title="Reopen"
                      >
                        <Icon.Refresh />
                      </button>
                    )}
                    {(r.message || r.attachmentKey) && (
                      <button
                        className="btn sm ghost"
                        onClick={() => setExpanded(isExpanded ? null : r.id)}
                        title={isExpanded ? 'Hide details' : 'Show details'}
                      >
                        <Icon.MessageSquare />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded message */}
                {isExpanded && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {r.message && (
                      <div
                        style={{
                          background: 'var(--bg-2, var(--surface-2))',
                          borderRadius: 6,
                          padding: '10px 12px',
                          fontSize: 13,
                          color: 'var(--text)',
                          lineHeight: 1.6,
                          whiteSpace: 'pre-wrap',
                          borderLeft: '3px solid var(--accent, #6366f1)',
                        }}
                      >
                        {r.message}
                      </div>
                    )}
                    {r.attachmentKey && storagePublicUrl && (
                      <a
                        href={`${storagePublicUrl}/${r.attachmentKey}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          color: 'var(--accent, #6366f1)',
                          textDecoration: 'none',
                          fontWeight: 500,
                        }}
                      >
                        <Icon.Eye />
                        View attachment
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
