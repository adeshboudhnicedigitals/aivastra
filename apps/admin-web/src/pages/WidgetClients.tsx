import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/data';

interface WidgetClient {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  widgetKey: string;
  creditBalance: number;
  isActive: boolean;
  createdAt: string;
}

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export function WidgetClients({ onNav: _onNav, toast }: Props) {
  const navigate = useNavigate();
  const [clients, setClients] = useState<WidgetClient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      const data = await apiFetch<{ clients: WidgetClient[]; total: number }>(
        `/v1/admin/widget-clients?${params}`,
      );
      setClients(data.clients);
      setTotal(data.total);
    } catch {
      toast({ kind: 'error', title: 'Failed to load widget clients' });
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));
  const formatDate = (d: string) => new Date(d).toLocaleDateString();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Widget Clients</h1>
          <p className="lede">Merchants using the Aivastra try-on widget.</p>
        </div>
      </div>

      <div className="filters">
        <div className="search">
          <svg viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M10.5 10.5l2.5 2.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          <input
            placeholder="Search company or email…"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <span className="pager-info">
          {total} client{total !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', padding: '24px 0' }}>Loading…</p>
      ) : clients.length === 0 ? (
        <div className="empty">
          <div className="ico">
            <svg viewBox="0 0 20 20" fill="none">
              <rect
                x="3"
                y="3"
                width="14"
                height="14"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M7 10h6M10 7v6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </div>
          No widget clients found.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'center' }}>Company</th>
                <th style={{ textAlign: 'center' }}>Contact</th>
                <th style={{ textAlign: 'center' }}>Email</th>
                <th style={{ textAlign: 'center' }}>Widget Key</th>
                <th style={{ textAlign: 'center' }}>Credits</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th style={{ textAlign: 'center' }}>Joined</th>
                <th style={{ textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr
                  key={c.id}
                  style={{ cursor: 'pointer', textAlign: 'center' }}
                  onClick={() => navigate(`/widget-clients/${c.id}`)}
                >
                  <td>
                    <strong>{c.companyName}</strong>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{c.contactName}</td>
                  <td className="mono">{c.email}</td>
                  <td>
                    <span className="mono">{c.widgetKey.slice(0, 8)}…</span>
                    <button
                      className="btn sm ghost"
                      style={{ marginLeft: 6 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        copy(c.widgetKey);
                      }}
                    >
                      Copy
                    </button>
                  </td>
                  <td className="num">{c.creditBalance ?? 0}</td>
                  <td>
                    <span className={`badge dot ${c.isActive ? 'success' : 'danger'}`}>
                      {c.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{formatDate(c.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/widget-clients/${c.id}`);
                        }}
                      >
                        View →
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pager">
          <span className="pager-info">
            {total} clients · page {page} of {totalPages}
          </span>
          <div className="pages">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ‹
            </button>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: index+1 is the page number itself, inherently stable
                key={i + 1}
                className={page === i + 1 ? 'active' : ''}
                onClick={() => setPage(i + 1)}
              >
                {i + 1}
              </button>
            ))}
            <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
              ›
            </button>
          </div>
          <span />
        </div>
      )}
    </>
  );
}
