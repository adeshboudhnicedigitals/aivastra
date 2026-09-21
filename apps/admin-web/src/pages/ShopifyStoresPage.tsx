import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';

interface ShopifyStore {
  id: string;
  shopDomain: string;
  shopEmail: string | null;
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
  const navigate = useNavigate();
  const { role: myRole } = useAuth();
  const isSuperAdmin = myRole === 'SUPER_ADMIN';
  const [stores, setStores] = useState<ShopifyStore[]>([]);
  const [loading, setLoading] = useState(true);
  // No GET-by-id endpoint exists for a single store, so the detail view is
  // resolved against the already-loaded `stores` list (same approach as the
  // GarmentTypesTab pilot), not a fresh fetch like Jobs/Users' `job=`/`user=`.
  const [storeIdParam, setStoreIdParam] = useUrlState('store');
  const closeDetail = useCloseOverlay(['store']);
  const selectedStore = useMemo(
    () => stores.find((s) => s.id === storeIdParam) ?? null,
    [stores, storeIdParam],
  );
  const [expandedStoreId, setExpandedStoreIdParam] = useUrlState('expanded');
  const closeAccordion = useCloseOverlay(['expanded']);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Delete is only ever reachable from the open store's own detail view, so
  // no confirmId is needed — the target is always `selectedStore`.
  const [confirmParam, setConfirmParam] = useUrlState('confirm');
  const closeConfirm = useCloseOverlay(['confirm']);
  const confirmDelete = confirmParam === 'delete-store' ? selectedStore : null;
  const [deleting, setDeleting] = useState(false);

  useCrumb(
    0,
    selectedStore
      ? {
          label: selectedStore.shopDomain,
          href: `/shopify-stores?store=${encodeURIComponent(selectedStore.id)}`,
        }
      : null,
  );
  useCrumb(
    1,
    confirmDelete
      ? {
          label: 'Delete store',
          href: `/shopify-stores?store=${encodeURIComponent(confirmDelete.id)}&confirm=delete-store`,
        }
      : null,
  );

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
    setStoreIdParam(store.id);
  }

  function goToJob(jobId: string) {
    if (!selectedStore) return;
    navigate(
      `/jobs?job=${encodeURIComponent(jobId)}&fromStore=${encodeURIComponent(selectedStore.id)}`,
    );
  }

  // Reconstructs the ledger from the URL alone — covers a hard refresh, a
  // deep link, and the physical Back button restoring a previous `store=`
  // value, in addition to a plain row click. Resets pagination whenever the
  // resolved store id changes.
  useEffect(() => {
    if (!selectedStore) return;
    setLedger([]);
    setNextCursor(null);
    void loadLedger(selectedStore.id);
  }, [selectedStore?.id, loadLedger]);

  async function handleDeleteConfirm() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/admin/shopify-stores/${confirmDelete.id}`, { method: 'DELETE' });
      toast({ title: `${confirmDelete.shopDomain} deleted` });
      await load();
      // Clear `store` together with `confirm` in one navigation — the
      // deleted store's id must not survive in the URL, or the ledger
      // reconstruction effect above re-fetches it and 404s right after this
      // success toast (and again on refresh).
      navigate('/shopify-stores', { replace: true });
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
            <button className="btn ghost" onClick={closeDetail}>
              <Icon.Back /> Back to Shopify Stores
            </button>
            <h1 style={{ marginTop: 8 }}>{selectedStore.shopDomain}</h1>
          </div>
          {isSuperAdmin && (
            <button className="btn danger" onClick={() => setConfirmParam('delete-store')}>
              <Icon.Trash /> Delete store data
            </button>
          )}
        </div>

        {/* Desktop Detail View */}
        <div className="desktop-only">
          <div
            className="kv-grid"
            style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}
          >
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
                            {entry.jobId ? (
                              <button
                                type="button"
                                onClick={() => goToJob(entry.jobId as string)}
                                style={{
                                  font: 'inherit',
                                  fontFamily: 'var(--mono)',
                                  fontSize: 12,
                                  color: 'var(--accent)',
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                }}
                                title={`View job ${entry.jobId}`}
                              >
                                {entry.jobId}
                              </button>
                            ) : (
                              '—'
                            )}
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
        </div>

        {/* Mobile & Tablet Detail View */}
        <div className="mobile-only" style={{ gap: 14 }}>
          {/* Summary Card */}
          <div
            className="card"
            style={{
              padding: '14px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r)',
              background: 'var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Credit balance:</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                {selectedStore.balance.toLocaleString()}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Installed:</span>
              <span style={{ fontSize: 12, color: 'var(--ink)' }}>
                {formatDate(selectedStore.installedAt)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Uninstalled:</span>
              <span style={{ fontSize: 12, color: 'var(--ink)' }}>
                {formatDate(selectedStore.uninstalledAt)}
              </span>
            </div>
          </div>

          <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: '8px 0 0', color: 'var(--ink)' }}>
            Recent Activity
          </h3>

          {ledgerLoading ? (
            <div
              className="card"
              style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
            >
              Loading activity…
            </div>
          ) : ledger.length === 0 ? (
            <div
              className="card"
              style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}
            >
              No ledger entries yet.
            </div>
          ) : (
            ledger.map((entry) => (
              <div
                key={entry.id}
                className="card"
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r)',
                  background: 'var(--surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {/* 1. Reason & 2. Delta */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>
                    {entry.reason}
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 13.5,
                      color: entry.delta < 0 ? 'var(--danger)' : 'var(--success)',
                    }}
                  >
                    {signedDelta(entry.delta)}
                  </span>
                </div>

                {/* 3. Timestamp */}
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {formatDate(entry.createdAt)}
                </div>

                {/* 4. Job ID */}
                <div style={{ fontSize: 11, wordBreak: 'break-all' }}>
                  {entry.jobId ? (
                    <span style={{ color: 'var(--muted)' }}>
                      Job ID:{' '}
                      <button
                        type="button"
                        onClick={() => goToJob(entry.jobId as string)}
                        style={{
                          font: 'inherit',
                          fontFamily: 'var(--mono)',
                          color: 'var(--accent)',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        {entry.jobId}
                      </button>
                    </span>
                  ) : (
                    <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                      Job ID: —
                    </span>
                  )}
                </div>
              </div>
            ))
          )}

          {nextCursor && (
            <button
              type="button"
              className="btn ghost"
              style={{ width: '100%', marginTop: 8 }}
              disabled={loadingMore}
              onClick={() => void loadLedger(selectedStore.id, nextCursor)}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>

        {confirmDelete && (
          <div className="modal-overlay" onClick={closeConfirm}>
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
                <button className="btn ghost" onClick={closeConfirm} disabled={deleting}>
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
        <>
          {/* Desktop Table View */}
          <div className="desktop-only table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Shop domain</th>
                  <th>Email</th>
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
                    <td style={{ color: store.shopEmail ? undefined : 'var(--muted)' }}>
                      {store.shopEmail ?? '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{store.balance.toLocaleString()}</td>
                    <td>{formatDate(store.installedAt)}</td>
                    <td>{formatDate(store.uninstalledAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile & Tablet Card View */}
          <div className="mobile-only" style={{ gap: 10 }}>
            {stores.map((store) => {
              const isExpanded = expandedStoreId === store.id;
              return (
                <div
                  key={store.id}
                  className="card"
                  style={{
                    padding: '12px 14px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r)',
                    background: 'var(--surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/* Shop domain header */}
                  <div
                    onClick={() =>
                      isExpanded ? closeAccordion() : setExpandedStoreIdParam(store.id)
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 13.5,
                          color: 'var(--ink)',
                          wordBreak: 'break-word',
                        }}
                      >
                        {store.shopDomain}
                      </span>
                      {store.uninstalledAt ? (
                        <span className="badge danger" style={{ fontSize: 10 }}>
                          Uninstalled
                        </span>
                      ) : (
                        <span className="badge success" style={{ fontSize: 10 }}>
                          Active
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        color: 'var(--muted)',
                        transform: isExpanded ? 'rotate(90deg)' : 'none',
                        transition: 'transform 0.15s ease',
                      }}
                    >
                      <Icon.Chevron />
                    </div>
                  </div>

                  {/* Expanded Section: Balance, Installed, Uninstalled, Credit Activity button */}
                  {isExpanded && (
                    <div
                      style={{
                        paddingTop: 10,
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Balance:</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                          {store.balance.toLocaleString()} credits
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Email:</span>
                        <span
                          style={{
                            fontSize: 12,
                            color: store.shopEmail ? 'var(--ink)' : 'var(--muted)',
                            wordBreak: 'break-all',
                            textAlign: 'right',
                          }}
                        >
                          {store.shopEmail ?? '—'}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Installed:</span>
                        <span style={{ fontSize: 12, color: 'var(--ink)' }}>
                          {formatDate(store.installedAt)}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Uninstalled:</span>
                        <span style={{ fontSize: 12, color: 'var(--ink)' }}>
                          {formatDate(store.uninstalledAt)}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="btn sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openStore(store);
                        }}
                        style={{
                          width: '100%',
                          marginTop: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                        }}
                      >
                        Credit activity &rarr;
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
