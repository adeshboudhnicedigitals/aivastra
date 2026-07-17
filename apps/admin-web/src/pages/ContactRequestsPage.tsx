import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { ContactRequest } from '../types';

const STATUS_LABEL: Record<string, string> = { new: 'New', read: 'Read', done: 'Done' };
const STATUS_BADGE: Record<string, string> = {
  new: 'badge danger dot',
  read: 'badge info dot',
  done: 'badge success dot',
};
const SOURCE_LABELS: Record<string, string> = {
  'app-support': 'App Support',
  'Integrate with Website': 'Integration',
  'Retail Store Kiosk': 'Retail / Kiosk',
  __null__: 'General',
};
const SOURCE_BADGE: Record<string, string> = {
  'app-support': 'badge info',
  'Integrate with Website': 'badge warn',
  'Retail Store Kiosk': 'badge accent',
  __null__: 'badge',
};

function sourceKey(src: string | null) {
  return src === null ? '__null__' : src;
}
function sourceBadgeClass(src: string | null) {
  return SOURCE_BADGE[sourceKey(src)] ?? 'badge';
}

interface SourcesSummary {
  sources: Array<string | null>;
  newBySource: Record<string, number>;
  totalBySource: Record<string, number>;
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNav: (_page: string) => void;
}

export default function ContactRequestsPage({ toast }: Props) {
  const { storagePublicUrl } = useAuth();
  const [rows, setRows] = useState<ContactRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'read' | 'done'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [summary, setSummary] = useState<SourcesSummary>({
    sources: [],
    newBySource: {},
    totalBySource: {},
  });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ContactRequest | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const notifPermRef = useRef(false);
  const prevNewCountRef = useRef<number | null>(null);

  const load = useCallback(
    async (status: string, source: string, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ status, limit: '100' });
        if (source !== 'all') params.set('source', source);
        const data = await apiFetch<{ rows: ContactRequest[]; total: number }>(
          `/admin/contact-requests?${params.toString()}`,
        );
        setRows(data.rows);
        setTotal(data.total);
        return data.rows;
      } catch (e) {
        if (!silent)
          toast({
            kind: 'error',
            title: 'Failed to load contact requests',
            body: apiErrorMessage(e, 'Please try again.'),
          });
        return null;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [toast],
  );

  const refreshSummary = useCallback(async () => {
    const data = await apiFetch<SourcesSummary>('/admin/contact-requests/sources').catch(
      () => null,
    );
    if (data) setSummary(data);
  }, []);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

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

  useEffect(() => {
    void load(statusFilter, sourceFilter);

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

      void load(statusFilter, sourceFilter, true);
      void refreshSummary();
      prevNewCountRef.current = count;
    }, 5_000);

    return () => clearInterval(poll);
  }, [load, refreshSummary, statusFilter, sourceFilter]);

  // Escape closes drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const setStatus = async (id: string, status: ContactRequest['status']) => {
    try {
      const updated = await apiFetch<ContactRequest>(`/admin/contact-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      if (selected?.id === id) setSelected(updated);
      toast({ title: `Marked as ${STATUS_LABEL[status]}` });
      void refreshSummary();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update status',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const statusFilters: Array<'all' | 'new' | 'read' | 'done'> = ['all', 'new', 'read', 'done'];
  const totalNew = summary.newBySource.__total__ ?? 0;

  // Client-side search
  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.message?.toLowerCase().includes(q),
      )
    : rows;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="page-head" style={{ padding: '0 0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Contact Requests</h2>
            <p className="lede" style={{ margin: '3px 0 0' }}>
              {total} total
            </p>
          </div>
          {totalNew > 0 && (
            <span
              style={{
                background: 'var(--danger)',
                color: '#fff',
                fontWeight: 700,
                fontSize: 13,
                padding: '3px 10px',
                borderRadius: 99,
              }}
            >
              {totalNew} new
            </span>
          )}
        </div>
        <button className="btn ghost" onClick={() => void load(statusFilter, sourceFilter)}>
          <Icon.Refresh /> Refresh
        </button>
      </div>

      {/* ── Channel summary cards ─────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        {/* All */}
        <button
          className="stat"
          style={{
            borderColor: sourceFilter === 'all' ? 'var(--accent)' : undefined,
            boxShadow: sourceFilter === 'all' ? '0 0 0 2px var(--accent-soft)' : undefined,
          }}
          onClick={() => {
            setSourceFilter('all');
            setStatusFilter('all');
            void load('all', 'all');
          }}
        >
          <span className="lbl">All channels</span>
          <span className="val" style={{ fontSize: 22 }}>
            {summary.newBySource.__total__ ?? 0}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>new of {total} total</span>
        </button>

        {/* Per-source cards */}
        {summary.sources.map((src) => {
          const key = sourceKey(src);
          const label = SOURCE_LABELS[key] ?? src ?? 'General';
          const nNew = summary.newBySource[key] ?? 0;
          const nTotal = summary.totalBySource[key] ?? 0;
          const isActive = sourceFilter === key;
          return (
            <button
              key={key}
              className="stat"
              style={{
                borderColor: isActive ? 'var(--accent)' : undefined,
                boxShadow: isActive ? '0 0 0 2px var(--accent-soft)' : undefined,
              }}
              onClick={() => {
                setSourceFilter(key);
                setStatusFilter('all');
                void load('all', key);
              }}
            >
              <span className="lbl">{label}</span>
              <span
                className="val"
                style={{ fontSize: 22, color: nNew > 0 ? 'var(--danger)' : undefined }}
              >
                {nNew}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>new of {nTotal}</span>
            </button>
          );
        })}
      </div>

      {/* ── Filter strip ─────────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          marginBottom: 16,
        }}
      >
        {/* Status tabs + Search */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 16px',
            gap: 12,
            minHeight: 52,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              marginRight: 2,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Status
          </span>
          <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0, flex: 1 }}>
            {statusFilters.map((f) => (
              <button
                key={f}
                className={`tab${statusFilter === f ? ' active' : ''}`}
                onClick={() => {
                  setStatusFilter(f);
                  void load(f, sourceFilter);
                }}
                style={{ textTransform: 'capitalize' }}
              >
                {f === 'all' ? 'All' : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
          <div className="search" style={{ width: 220, flexShrink: 0 }}>
            <Icon.Search />
            <input
              placeholder="Search name, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      {loading ? (
        <div
          style={{ color: 'var(--muted)', fontSize: 13, padding: '48px 0', textAlign: 'center' }}
        >
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="ico">
            <Icon.MessageSquare />
          </div>
          {search
            ? `No results for "${search}"`
            : 'No contact requests matching the selected filters.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 72 }}>Status</th>
                <th style={{ width: 160 }}>Name</th>
                <th>Message</th>
                <th style={{ width: 120 }}>Source</th>
                <th style={{ width: 130 }}>Received</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    cursor: 'pointer',
                    background:
                      selected?.id === r.id
                        ? 'var(--accent-soft)'
                        : r.status === 'new'
                          ? 'var(--danger-soft)'
                          : undefined,
                  }}
                  onClick={() => setSelected(r)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <span className={STATUS_BADGE[r.status] ?? 'badge'}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: r.status === 'new' ? 600 : 400, fontSize: 13 }}>
                      {r.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                      {r.phone || '—'}
                    </div>
                  </td>
                  <td>
                    {r.message ? (
                      <span
                        style={{
                          fontSize: 12.5,
                          color: 'var(--ink-2)',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          lineHeight: 1.5,
                        }}
                      >
                        {r.message}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--muted-2)', fontStyle: 'italic' }}>
                        No message
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={sourceBadgeClass(r.source)}>
                      {SOURCE_LABELS[sourceKey(r.source)] ?? r.source ?? 'General'}
                    </span>
                  </td>
                  <td style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {new Date(r.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
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
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail drawer ─────────────────────────────────────────── */}
      {selected && (
        <>
          <div className="scrim" onClick={() => setSelected(null)} />
          <div className="drawer">
            {/* Head */}
            <div className="drawer-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {new Date(selected.createdAt).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              <span className={STATUS_BADGE[selected.status] ?? 'badge'}>
                {STATUS_LABEL[selected.status]}
              </span>
              <button className="iconbtn" onClick={() => setSelected(null)} title="Close (Esc)">
                <Icon.Close />
              </button>
            </div>

            {/* Body */}
            <div
              className="drawer-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
            >
              {/* Contact info */}
              <div
                style={{
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--r-lg)',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* Email row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', width: 50, flexShrink: 0 }}>
                    Email
                  </span>
                  <a
                    href={`mailto:${selected.email}?subject=Re: Your enquiry via Aivastra`}
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 12.5,
                      color: 'var(--accent)',
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {selected.email}
                  </a>
                  <button
                    className="iconbtn"
                    onClick={() => copy(selected.email, 'email')}
                    title="Copy email"
                  >
                    {copied === 'email' ? <Icon.Check /> : <Icon.Copy />}
                  </button>
                </div>

                {/* Phone row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', width: 50, flexShrink: 0 }}>
                    Phone
                  </span>
                  <a
                    href={`tel:${selected.phone}`}
                    style={{ fontFamily: 'var(--mono)', fontSize: 12.5, flex: 1 }}
                  >
                    {selected.phone}
                  </a>
                  <button
                    className="iconbtn"
                    onClick={() => copy(selected.phone, 'phone')}
                    title="Copy phone"
                  >
                    {copied === 'phone' ? <Icon.Check /> : <Icon.Copy />}
                  </button>
                </div>

                {/* Source row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', width: 50, flexShrink: 0 }}>
                    Source
                  </span>
                  <span className={sourceBadgeClass(selected.source)}>
                    {SOURCE_LABELS[sourceKey(selected.source)] ?? selected.source ?? 'General'}
                  </span>
                </div>
              </div>

              {/* Message */}
              {selected.message ? (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--muted)',
                      marginBottom: 8,
                    }}
                  >
                    Message
                  </div>
                  <div
                    style={{
                      fontSize: 13.5,
                      lineHeight: 1.7,
                      color: 'var(--ink)',
                      whiteSpace: 'pre-wrap',
                      background: 'var(--surface-2)',
                      borderRadius: 'var(--r)',
                      padding: '12px 14px',
                      borderLeft: '3px solid var(--accent)',
                    }}
                  >
                    {selected.message}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--muted)',
                    fontStyle: 'italic',
                    textAlign: 'center',
                    padding: '16px 0',
                  }}
                >
                  No message included
                </div>
              )}

              {/* Attachment */}
              {selected.attachmentKey && storagePublicUrl && (
                <a
                  href={`${storagePublicUrl}/${selected.attachmentKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn ghost"
                  style={{ alignSelf: 'flex-start' }}
                >
                  <Icon.Eye /> View attachment
                </a>
              )}
            </div>

            {/* Footer — actions */}
            <div className="drawer-foot" style={{ gap: 8, flexWrap: 'wrap' }}>
              <a
                href={`mailto:${selected.email}?subject=Re: Your enquiry via Aivastra`}
                className="btn accent"
                style={{ marginRight: 'auto' }}
              >
                <Icon.ExternalLink /> Reply by email
              </a>
              {selected.status === 'new' && (
                <button className="btn" onClick={() => void setStatus(selected.id, 'read')}>
                  <Icon.Eye /> Mark read
                </button>
              )}
              {selected.status !== 'done' && (
                <button className="btn primary" onClick={() => void setStatus(selected.id, 'done')}>
                  <Icon.Check /> Mark done
                </button>
              )}
              {selected.status === 'done' && (
                <button className="btn" onClick={() => void setStatus(selected.id, 'new')}>
                  <Icon.Refresh /> Reopen
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
