import { type CSSProperties, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { StoreManageProduct, StoreManageSummary } from '../types';
import { Icon } from './Icons';
import { Pager } from './Pager';
import { SearchableSelect } from './SearchableSelect';

interface Props {
  storeId: string;
  toast: (opts: { kind?: 'error'; title: string; body?: string }) => void;
}

const PAGE_SIZE = 20;

// Each view maps to the same filter fields the merchant's Manage page sends to
// /v1/shopify/products, so a row here is a row they see in the matching tab.
const VIEWS: Record<string, { label: string; params: Record<string, string> }> = {
  all: { label: 'All products', params: {} },
  enabled: { label: 'Individually enabled', params: { enabled: 'true' } },
  excluded: { label: 'Excluded', params: { excluded: 'true' } },
  failed: { label: 'Failed to sync', params: { status: 'failed' } },
  processing: { label: 'Processing', params: { status: 'processing' } },
  deleted: { label: 'Deleted', params: { status: 'deleted' } },
};
const VIEW_OPTIONS = Object.entries(VIEWS).map(([id, v]) => ({ id, label: v.label }));

// One bordered tile per figure. Not `.kv`/`.kv-grid`: those are label|value row
// grids (130px 1fr), which run a label and its value together when used as tiles.
const TILE: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface-2)',
  padding: '10px 12px',
  minWidth: 0,
};

const STATUS_BADGE: Record<string, string> = {
  active: 'success',
  processing: 'info',
  failed: 'danger',
  deleted: '',
};

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function CollectionList({
  title,
  items,
}: {
  title: string;
  items: StoreManageSummary['enabledCollections'];
}) {
  return (
    <div style={{ ...TILE, flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>None</span>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {items.map((c) => (
            <span key={c.shopifyCollectionId} className="badge">
              {c.title || c.shopifyCollectionId} · {c.productCount}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Read-only mirror of one store's Shopify Manage page: activation mode, the
 * enabled/excluded collections, and the synced product list with the same
 * filters. Owns its own fetches — the store detail view renders it once, outside
 * the desktop/mobile layout split, so there is no duplicate-mount to guard against.
 */
export function StoreManageCard({ storeId, toast }: Props) {
  const [summary, setSummary] = useState<StoreManageSummary | null>(null);
  const [view, setView] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<StoreManageProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Bumped by the Refresh button; both fetch effects re-run on it.
  const [refreshToken, setRefreshToken] = useState(0);
  const { hasPermission } = useAuth();
  const canSync = hasPermission('shopify_stores.sync');
  const [syncing, setSyncing] = useState(false);

  // A full sync of a big catalog runs for many minutes in the background, so
  // pick up one already in flight on mount and poll until it finishes.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const s = await apiFetch<{ state: string }>(`/admin/shopify-stores/${storeId}/sync/status`);
        if (cancelled) return;
        const running = s.state === 'running';
        setSyncing((was) => {
          if (was && !running) setRefreshToken((n) => n + 1);
          return running;
        });
      } catch {
        // status is advisory; the next tick retries
      }
    };
    check();
    const t = setInterval(check, syncing ? 3000 : 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [storeId, syncing]);

  const startSync = async () => {
    try {
      const r = await apiFetch<{ queued: boolean; alreadyRunning?: boolean }>(
        `/admin/shopify-stores/${storeId}/sync`,
        { method: 'POST' },
      );
      setSyncing(true);
      toast({
        title: r.alreadyRunning ? 'A sync is already running' : 'Product sync started',
      });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to start sync',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is a deliberate refetch trigger, not referenced in the body
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    apiFetch<StoreManageSummary>(`/admin/shopify-stores/${storeId}/manage`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            kind: 'error',
            title: 'Failed to load Manage summary',
            body: apiErrorMessage(err, 'Please try again.'),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, toast, refreshToken]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new store, view or search always restarts at page 1
  useEffect(() => {
    setPage(1);
  }, [storeId, view, debouncedSearch]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is a deliberate refetch trigger, not referenced in the body
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...VIEWS[view].params,
    });
    if (debouncedSearch) params.set('q', debouncedSearch);
    apiFetch<{ items: StoreManageProduct[]; total: number }>(
      `/admin/shopify-stores/${storeId}/products?${params}`,
    )
      .then((data) => {
        if (cancelled) return;
        setProducts(data.items);
        setTotal(data.total);
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            kind: 'error',
            title: 'Failed to load products',
            body: apiErrorMessage(err, 'Please try again.'),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, view, debouncedSearch, page, toast, refreshToken]);

  const counts = summary?.counts;
  const stat = (label: string, value: string) => (
    <div style={TILE}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );

  return (
    <div className="card">
      <div className="card-head">
        <h3>Manage page (merchant view, read-only)</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {canSync && (
            <button
              type="button"
              className="btn ghost"
              disabled={syncing}
              onClick={startSync}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon.Refresh /> {syncing ? 'Syncing…' : 'Sync products'}
            </button>
          )}
          <button
            type="button"
            className="btn ghost"
            disabled={loading || !summary}
            onClick={() => setRefreshToken((n) => n + 1)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon.Refresh /> Refresh
          </button>
        </div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!summary || !counts ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 10,
              }}
            >
              {stat('Activation mode', summary.mode === 'global' ? 'All products' : 'Selective')}
              {stat('Try-on effectively on', counts.tryonEnabledProducts.toLocaleString())}
              {stat('Synced (active)', counts.syncedProductCount.toLocaleString())}
              {stat('Failed to sync', counts.failedToSync.toLocaleString())}
              {stat('Processing', (summary.statusCounts.processing ?? 0).toLocaleString())}
              {stat('Deleted', (summary.statusCounts.deleted ?? 0).toLocaleString())}
              {stat('Last synced', formatDateTime(summary.lastSyncedAt))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <CollectionList title="Enabled collections" items={summary.enabledCollections} />
              <CollectionList title="Excluded collections" items={summary.excludedCollections} />
            </div>
          </>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ minWidth: 200 }}>
            <SearchableSelect
              options={VIEW_OPTIONS}
              value={view}
              onChange={(id) => setView(id || 'all')}
              ariaLabel="Product view"
            />
          </div>
          <input
            className="input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Search product title"
            aria-label="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
        ) : products.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>No products match.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Sync status</th>
                  <th>Flags</th>
                  <th>Collections</th>
                  <th>Synced</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.shopifyProductId}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <img
                          src={p.thumbnailUrl}
                          alt=""
                          width={36}
                          height={36}
                          loading="lazy"
                          style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                        />
                        <div>
                          <div>{p.title ?? '(untitled)'}</div>
                          <div className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                            {p.shopifyProductId}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge dot ${STATUS_BADGE[p.status] ?? ''}`}>
                        {p.status}
                      </span>
                      {p.failedReason && (
                        <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>
                          {p.failedReason}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {p.enabled && <span className="badge success">Enabled</span>}
                        {p.excluded && <span className="badge warn">Excluded</span>}
                        {!p.enabled && !p.excluded && (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {p.collections?.length ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {p.collections.map((c) => (
                            <span key={c} className="badge">
                              {c}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{formatDateTime(p.syncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pager
          page={page}
          totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPage={setPage}
        />
      </div>
    </div>
  );
}
