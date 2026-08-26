import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage, apiFetch } from '../lib/data';

interface ShopifyStore {
  id: string;
  shopDomain: string;
  balance: number;
  installedAt: string;
  uninstalledAt: string | null;
}

interface LedgerEntry {
  id: string;
  reason: string;
  delta: number;
  createdAt: string;
  jobId: string | null;
}

interface Props {
  toast: (opts: { kind?: 'error'; title: string; body?: string }) => void;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function signedDelta(delta: number): string {
  return `${delta > 0 ? '+' : ''}${delta.toLocaleString()}`;
}

export default function ShopifyStoresPage({ toast }: Props) {
  const { role: myRole } = useAuth();
  const isSuperAdmin = myRole === 'SUPER_ADMIN';
  const [stores, setStores] = useState<ShopifyStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStore, setSelectedStore] = useState<ShopifyStore | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ShopifyStore | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ stores: ShopifyStore[] }>('/admin/shopify-stores');
      setStores(data.stores);
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to load Shopify stores',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const loadLedger = useCallback(
    async (storeId: string, cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLedgerLoading(true);
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (cursor) params.set('cursor', cursor);
        const data = await apiFetch<{ entries: LedgerEntry[]; nextCursor: string | null }>(
          `/admin/shopify-stores/${storeId}/ledger?${params}`,
        );
        setLedger((previous) => (cursor ? [...previous, ...data.entries] : data.entries));
        setNextCursor(data.nextCursor);
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Failed to load store ledger',
          body: apiErrorMessage(err, 'Please try again.'),
        });
      } finally {
        setLedgerLoading(false);
        setLoadingMore(false);
      }
    },
    [toast],
  );

  function openStore(store: ShopifyStore) {
    setSelectedStore(store);
    setLedger([]);
    setNextCursor(null);
    void loadLedger(store.id);
  }

  async function handleDeleteConfirm() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/admin/shopify-stores/${confirmDelete.id}`, { method: 'DELETE' });
      toast({ title: `${confirmDelete.shopDomain} deleted` });
      setConfirmDelete(null);
      setSelectedStore(null);
      await load();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to delete store',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setDeleting(false);
    }
  }

  if (selectedStore) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="page-head">
          <div>
            <button className="btn ghost" onClick={() => setSelectedStore(null)}>
              <Icon.Back /> Back to Shopify Stores
            </button>
            <h1 style={{ marginTop: 8 }}>{selectedStore.shopDomain}</h1>
          </div>
          {isSuperAdmin && (
            <button className="btn danger" onClick={() => setConfirmDelete(selectedStore)}>
              <Icon.Trash /> Delete store data
            </button>
          )}
        </div>

        <div className="kv-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="kv">
            <span className="k">Credit balance</span>
            <span className="v">{selectedStore.balance.toLocaleString()}</span>
          </div>
          <div className="kv">
            <span className="k">Installed</span>
            <span className="v">{formatDate(selectedStore.installedAt)}</span>
          </div>
          <div className="kv">
            <span className="k">Uninstalled</span>
            <span className="v">{formatDate(selectedStore.uninstalledAt)}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Credit activity</h3>
          </div>
          <div className="card-body">
            {ledgerLoading ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
            ) : ledger.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>No ledger entries yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reason</th>
                      <th style={{ textAlign: 'right' }}>Delta</th>
                      <th>Timestamp</th>
                      <th>Job ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.reason}</td>
                        <td
                          style={{
                            textAlign: 'right',
                            color: entry.delta < 0 ? 'var(--danger)' : 'var(--success)',
                            fontWeight: 500,
                          }}
                        >
                          {signedDelta(entry.delta)}
                        </td>
                        <td>{formatDate(entry.createdAt)}</td>
                        <td>
                          {entry.jobId ? <code style={{ fontSize: 12 }}>{entry.jobId}</code> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {nextCursor && (
              <button
                type="button"
                className="btn ghost"
                style={{ marginTop: 16 }}
                disabled={loadingMore}
                onClick={() => void loadLedger(selectedStore.id, nextCursor)}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>

        {confirmDelete && (
          <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
            <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Delete Shopify store</h3>
              </div>
              <div className="modal-body">
                <p>
                  Permanently delete <strong>{confirmDelete.shopDomain}</strong> and all its data —
                  credit balance, ledger, synced products, shoppers, and settings? This cannot be
                  undone. Use this only to reset a test store for a clean reinstall.
                </p>
              </div>
              <div className="modal-foot">
                <button
                  className="btn ghost"
                  onClick={() => setConfirmDelete(null)}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button className="btn danger" onClick={handleDeleteConfirm} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Shopify Stores</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          Store credit balances and credit activity. Open a store for the option to delete it.
        </p>
      </div>

      {loading ? (
        <div
          style={{ color: 'var(--muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}
        >
          Loading…
        </div>
      ) : stores.length === 0 ? (
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
          No Shopify stores yet.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Shop domain</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
                <th>Installed</th>
                <th>Uninstalled</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr
                  key={store.id}
                  onClick={() => openStore(store)}
                  style={{ cursor: 'pointer' }}
                  title={`View ${store.shopDomain} credit activity`}
                >
                  <td style={{ fontWeight: 500 }}>{store.shopDomain}</td>
                  <td style={{ textAlign: 'right' }}>{store.balance.toLocaleString()}</td>
                  <td>{formatDate(store.installedAt)}</td>
                  <td>{formatDate(store.uninstalledAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
