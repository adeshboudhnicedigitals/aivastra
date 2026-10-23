import { useCallback, useEffect, useState } from 'react';
import { SearchableSelect } from '../components/SearchableSelect';
import { Switch } from '../components/Switch';
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';

type Settings = {
  enabled: boolean;
  backlogCap: number;
  retentionDays: number;
  enabledSince: string | null;
};
type Comparison = {
  id: string;
  status: string;
  unsupportedReason: string | null;
  sourceSource: string | null;
  sourceJobId: string;
  generalJobId: string | null;
  createdAt: string;
};
type ComparisonDetail = {
  id: string;
  status: string;
  unsupportedReason: string | null;
  template: { id: string; version: number; label: string | null };
  source: {
    jobId: string;
    source: string | null;
    workflowLabel: string | null;
    workerId: string | null;
    durationMs: number | null;
    error: string | null;
  };
  general: {
    jobId: string;
    workerId: string | null;
    durationMs: number | null;
    error: string | null;
  } | null;
  inputs: { personUrl: string | null; garmentUrl: string | null };
  originalResultUrl: string | null;
  generalResultUrl: string | null;
};
type ComparisonList = {
  items: Comparison[];
  nextCursor: string | null;
  counts: Record<string, number>;
  backlog: { collected: number; queued: number; running: number };
};

const STATUSES = [
  '',
  'COLLECTED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'UNSUPPORTED',
  'EXPIRED',
  'CANCELLED',
];
const SOURCE_LABELS: Record<string, string> = {
  api_catalog: 'API catalog',
  api_saree_mannequin: 'API saree mannequin',
  api_tryon: 'API try-on',
  catalog: 'Studio catalog',
  comparison: 'Comparison replay',
  kiosk: 'Kiosk',
  merchant_catalog: 'Merchant catalog',
  merchant_tryon: 'Merchant try-on',
  saree: 'Saree',
  shopify: 'Shopify try-on',
  tryon: 'Studio try-on',
  wordpress_tryon: 'WordPress try-on',
};

interface Props {
  toast: (t: { kind?: 'error' | 'success'; title: string; body?: string }) => void;
}

function messageForSource(source: string | null) {
  return source ? (SOURCE_LABELS[source] ?? source) : 'Unknown source';
}

function ImagePanel({ title, url }: { title: string; url: string | null }) {
  return (
    <section className="card" style={{ minWidth: 0 }}>
      <div className="card-body">
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {/* Signed R2/MinIO URLs are rendered directly in this Vite SPA. */}
            {/* biome-ignore lint/performance/noImgElement: this is not a Next.js app and the URL is already a storage asset URL. */}
            <img
              src={url}
              alt={title}
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: 520,
                objectFit: 'contain',
                margin: '0 auto',
              }}
            />
          </a>
        ) : (
          <div style={{ color: 'var(--muted)', minHeight: 100 }}>Image unavailable</div>
        )}
      </div>
    </section>
  );
}

export default function WorkflowComparisonsPage({ toast }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draftBacklogCap, setDraftBacklogCap] = useState('200');
  const [draftRetentionDays, setDraftRetentionDays] = useState('30');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState<ComparisonList | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [detail, setDetail] = useState<ComparisonDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useUrlState('comparison');
  const closeDetail = useCloseOverlay(['comparison']);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const result = await apiFetch<Settings>('/admin/comparison/settings');
      setSettings(result);
      setDraftBacklogCap(String(result.backlogCap));
      setDraftRetentionDays(String(result.retentionDays));
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to load comparison settings',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setSettingsLoading(false);
    }
  }, [toast]);

  const loadPage = useCallback(
    async (cursor?: string, append = false) => {
      if (append) setLoadingMore(true);
      else setListLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (sourceFilter) params.set('sourceSource', sourceFilter);
      if (cursor) params.set('cursor', cursor);
      try {
        const result = await apiFetch<ComparisonList>(`/admin/comparison?${params}`);
        setList((current) =>
          append && current ? { ...result, items: [...current.items, ...result.items] } : result,
        );
      } catch (err) {
        toast({
          kind: 'error',
          title: 'Failed to load workflow comparisons',
          body: apiErrorMessage(err, 'Please try again.'),
        });
      } finally {
        if (append) setLoadingMore(false);
        else setListLoading(false);
      }
    },
    [statusFilter, sourceFilter, toast],
  );

  useEffect(() => {
    void loadSettings();
    apiFetch<string[]>('/admin/jobs/sources')
      .then(setSources)
      .catch((err) =>
        toast({
          kind: 'error',
          title: 'Failed to load job sources',
          body: apiErrorMessage(err, 'Please try again.'),
        }),
      );
  }, [loadSettings, toast]);

  useEffect(() => {
    setList(null);
    void loadPage();
  }, [loadPage]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        setDetail(await apiFetch<ComparisonDetail>(`/admin/comparison/${id}`));
      } catch (err) {
        const message = apiErrorMessage(err, 'Please try again.');
        setDetailError(message);
        toast({ kind: 'error', title: 'Failed to load comparison', body: message });
      } finally {
        setDetailLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    if (detail?.id === selectedId) return;
    void loadDetail(selectedId);
  }, [selectedId, detail?.id, loadDetail]);

  useCrumb(
    0,
    selectedId && detail
      ? {
          label: `Comparison ${detail.id.slice(0, 8)}`,
          href: `/workflow-comparisons?comparison=${encodeURIComponent(detail.id)}`,
        }
      : null,
  );

  async function patchSettings(
    patch: Partial<Pick<Settings, 'enabled' | 'backlogCap' | 'retentionDays'>>,
  ) {
    setSaving(true);
    try {
      const next = await apiFetch<Settings>('/admin/comparison/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setSettings(next);
      setDraftBacklogCap(String(next.backlogCap));
      setDraftRetentionDays(String(next.retentionDays));
      toast({ kind: 'success', title: 'Comparison settings saved' });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to save comparison settings',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  async function cancelQueued() {
    const queued = list?.backlog.queued ?? 0;
    if (
      !window.confirm(
        `Cancel ${queued} queued comparison${queued === 1 ? '' : 's'}? Running comparisons will finish.`,
      )
    )
      return;
    setSaving(true);
    try {
      const result = await apiFetch<{ cancelled: number }>('/admin/comparison/cancel-queued', {
        method: 'POST',
      });
      toast({
        kind: 'success',
        title: `Cancelled ${result.cancelled} queued comparison${result.cancelled === 1 ? '' : 's'}`,
      });
      await loadPage();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to cancel queued comparisons',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  const sourceOptions = sources.map((source) => ({ id: source, label: messageForSource(source) }));
  const nextCursor = list?.nextCursor ?? null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="card">
        <div
          className="card-body"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 16 }}
        >
          <div style={{ minWidth: 150 }}>
            <div className="setting-lbl">Automatic comparisons</div>
            {settingsLoading || !settings ? (
              <span>Loading…</span>
            ) : (
              <Switch
                checked={settings.enabled}
                disabled={saving}
                onChange={(enabled) => void patchSettings({ enabled })}
              />
            )}
          </div>
          <label style={{ display: 'grid', gap: 5 }}>
            <span className="setting-lbl">Backlog cap</span>
            <input
              className="input"
              type="number"
              min={1}
              max={5000}
              value={draftBacklogCap}
              disabled={saving || settingsLoading}
              onChange={(e) => setDraftBacklogCap(e.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span className="setting-lbl">Retention days</span>
            <input
              className="input"
              type="number"
              min={1}
              max={365}
              value={draftRetentionDays}
              disabled={saving || settingsLoading}
              onChange={(e) => setDraftRetentionDays(e.target.value)}
            />
          </label>
          <button
            className="btn primary"
            disabled={saving || settingsLoading || !settings}
            onClick={() =>
              void patchSettings({
                backlogCap: Number(draftBacklogCap),
                retentionDays: Number(draftRetentionDays),
              })
            }
          >
            {saving ? 'Saving…' : 'Save limits'}
          </button>
          <button
            className="btn"
            disabled={saving || (list?.backlog.queued ?? 0) === 0}
            onClick={() => void cancelQueued()}
          >
            Cancel queued ({list?.backlog.queued ?? 0})
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, color: 'var(--muted)' }}>
            <span>
              Collected <strong>{list?.backlog.collected ?? '—'}</strong>
            </span>
            <span>
              Queued <strong>{list?.backlog.queued ?? '—'}</strong>
            </span>
            <span>
              Running <strong>{list?.backlog.running ?? '—'}</strong>
            </span>
          </div>
        </div>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selectedId ? 'minmax(300px, 0.8fr) minmax(0, 1.5fr)' : '1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <section className="card">
          <div className="card-body">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <label style={{ display: 'grid', gap: 5, minWidth: 180 }}>
                <span className="setting-lbl">Status</span>
                <SearchableSelect
                  options={STATUSES.slice(1).map((id) => ({ id, label: id.replaceAll('_', ' ') }))}
                  value={statusFilter}
                  emptyLabel="All statuses"
                  onChange={setStatusFilter}
                />
              </label>
              <label style={{ display: 'grid', gap: 5, minWidth: 220 }}>
                <span className="setting-lbl">Source workflow</span>
                <SearchableSelect
                  options={sourceOptions}
                  value={sourceFilter}
                  emptyLabel="All sources"
                  onChange={setSourceFilter}
                />
              </label>
            </div>
            {listLoading ? (
              <div>Loading comparisons…</div>
            ) : list?.items.length ? (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Source workflow</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.items.map((row) => (
                        <tr
                          key={row.id}
                          style={{
                            cursor: 'pointer',
                            background: selectedId === row.id ? 'var(--surface-2)' : undefined,
                          }}
                          onClick={() => setSelectedId(row.id)}
                        >
                          <td>
                            <div>{messageForSource(row.sourceSource)}</div>
                            {row.unsupportedReason && (
                              <small style={{ color: 'var(--muted)' }}>
                                {row.unsupportedReason}
                              </small>
                            )}
                          </td>
                          <td>{row.status}</td>
                          <td>{new Date(row.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {nextCursor && (
                  <button
                    className="btn"
                    disabled={loadingMore}
                    onClick={() => void loadPage(nextCursor, true)}
                    style={{ marginTop: 12 }}
                  >
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </>
            ) : (
              <div style={{ color: 'var(--muted)' }}>No workflow comparisons found.</div>
            )}
          </div>
        </section>

        {selectedId && (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <button className="btn" onClick={closeDetail}>
                Back to list
              </button>
              {detail && (
                <strong>
                  {detail.template.label ?? 'General workflow'} v{detail.template.version}
                </strong>
              )}
            </div>
            {detailLoading ? (
              <div className="card">
                <div className="card-body">Loading comparison…</div>
              </div>
            ) : detailError ? (
              <div className="card">
                <div className="card-body">Comparison details could not be loaded.</div>
              </div>
            ) : (
              detail && (
                <>
                  {detail.unsupportedReason && (
                    <div className="card">
                      <div className="card-body">
                        <strong>Unsupported:</strong> {detail.unsupportedReason}
                      </div>
                    </div>
                  )}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <ImagePanel title="Person input" url={detail.inputs.personUrl} />
                    <ImagePanel title="Garment input" url={detail.inputs.garmentUrl} />
                    <ImagePanel
                      title={`Original result — ${detail.source.workflowLabel ?? messageForSource(detail.source.source)}`}
                      url={detail.originalResultUrl}
                    />
                    <ImagePanel
                      title={`General result — ${detail.template.label ?? 'General workflow'}`}
                      url={detail.generalResultUrl}
                    />
                  </div>
                  <section className="card">
                    <div className="card-body">
                      <div>
                        <strong>Source:</strong>{' '}
                        {detail.source.workflowLabel ?? messageForSource(detail.source.source)} ·
                        worker {detail.source.workerId ?? '—'} · {detail.source.durationMs ?? '—'}{' '}
                        ms · {detail.source.error ?? 'No error'}
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <strong>General:</strong>{' '}
                        {detail.general
                          ? `worker ${detail.general.workerId ?? '—'} · ${detail.general.durationMs ?? '—'} ms · ${detail.general.error ?? 'No error'}`
                          : 'Not dispatched yet'}
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <strong>Status:</strong> {detail.status}
                      </div>
                    </div>
                  </section>
                </>
              )
            )}
          </section>
        )}
      </div>
    </div>
  );
}
