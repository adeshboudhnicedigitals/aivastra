import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { ImageLightbox } from '../components/ImageLightbox';
import { KV } from '../components/KV';
import { SearchableSelect } from '../components/SearchableSelect';
import { StatusBadge } from '../components/StatusBadge';
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

function messageForSource(source: string | null): string {
  return source ? (SOURCE_LABELS[source] ?? source) : 'Unknown source';
}

function formatUnsupportedReason(reason: string | null): string {
  return reason ? reason.replaceAll('_', ' ') : '—';
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function statusPlaceholder(status: string, reason: string | null): string {
  if (status === 'UNSUPPORTED') return formatUnsupportedReason(reason);
  const readable = status.charAt(0) + status.slice(1).toLowerCase();
  return `${readable}, no result yet`;
}

function ComparisonCard({
  row,
  detail,
  onVisible,
  onOpen,
  onPreview,
}: {
  row: Comparison;
  detail?: ComparisonDetail;
  onVisible: (id: string) => void;
  onOpen: (id: string) => void;
  onPreview: (urls: { url: string; label: string }[], index: number) => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = cardRef.current;
    if (!node || detail) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisible(row.id);
          observer.disconnect();
        }
      },
      { rootMargin: '500px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [detail, onVisible, row.id]);

  const completed = row.status === 'COMPLETED';
  const original = detail?.originalResultUrl;
  const general = detail?.generalResultUrl;
  const originalDuration = formatDuration(detail?.source.durationMs);
  const generalDuration = formatDuration(detail?.general?.durationMs);
  const delta =
    detail?.source.durationMs != null && detail.general?.durationMs != null
      ? detail.source.durationMs - detail.general.durationMs
      : null;
  const deltaLabel =
    delta == null
      ? null
      : delta > 0
        ? `General ${formatDuration(delta)} faster`
        : delta < 0
          ? `General ${formatDuration(Math.abs(delta))} slower`
          : 'Same duration';

  const image = (url: string | null | undefined, label: string, compact = false) =>
    url ? (
      <button
        type="button"
        aria-label={`View ${label}`}
        onClick={() =>
          (() => {
            const images = [
              ...(original ? [{ url: original, label: 'Original result' }] : []),
              ...(general ? [{ url: general, label: 'General result' }] : []),
            ];
            onPreview(
              images,
              Math.max(
                0,
                images.findIndex((item) => item.url === url),
              ),
            );
          })()
        }
        style={{
          width: compact ? '100%' : '80%',
          marginInline: 'auto',
          aspectRatio: '3 / 4',
          padding: 0,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface-2)',
          cursor: 'zoom-in',
        }}
      >
        {/* biome-ignore lint/performance/noImgElement: signed asset URL displayed in admin SPA */}
        <img
          src={url}
          alt={label}
          loading="lazy"
          decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </button>
    ) : (
      <div
        style={{
          width: compact ? '100%' : '80%',
          marginInline: 'auto',
          aspectRatio: '3 / 4',
          display: 'grid',
          placeContent: 'center',
          gap: 8,
          color: 'var(--muted)',
          background: 'var(--surface-2)',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--r-md)',
          textAlign: 'center',
          padding: 16,
          fontSize: 13,
        }}
      >
        <Icon.Image />
        <span>
          {completed
            ? `${label} unavailable`
            : statusPlaceholder(row.status, row.unsupportedReason)}
        </span>
      </div>
    );

  return (
    <article ref={cardRef} className="card" style={{ overflow: 'hidden' }}>
      <div
        className="card-head"
        style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}
      >
        <button
          type="button"
          className="btn ghost"
          onClick={() => onOpen(row.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 0, minHeight: 0 }}
        >
          <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>
            {row.id.slice(0, 8)}
          </span>
          <StatusBadge status={row.status} />
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>
            {detail?.source.workflowLabel ?? messageForSource(row.sourceSource)}
          </span>
        </button>
        <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 'auto' }}>
          {new Date(row.createdAt).toLocaleString()}
        </span>
      </div>

      <div className="card-body" style={{ paddingTop: 14 }}>
        {completed ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            {(['personUrl', 'garmentUrl'] as const).map((key) => (
              <div key={key} style={{ minWidth: 0 }}>
                <div
                  style={{
                    width: '80%',
                    aspectRatio: '3 / 4',
                    marginInline: 'auto',
                    overflow: 'hidden',
                    display: 'grid',
                    placeContent: 'center',
                    color: 'var(--muted)',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-md)',
                  }}
                >
                  {detail?.inputs[key] ? (
                    /* biome-ignore lint/performance/noImgElement: signed asset URL displayed in admin SPA */
                    <img
                      src={detail.inputs[key] ?? undefined}
                      alt={key === 'personUrl' ? 'Person input' : 'Garment input'}
                      loading="lazy"
                      decoding="async"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <Icon.Image />
                  )}
                </div>
                <div style={{ paddingTop: 7, textAlign: 'center', fontSize: 12 }}>
                  {key === 'personUrl' ? 'Person input' : 'Garment input'}
                </div>
              </div>
            ))}
            <div style={{ minWidth: 0 }}>
              {image(original, 'Original result')}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  paddingTop: 7,
                  fontSize: 12,
                }}
              >
                <span>
                  Original · {detail?.source.workflowLabel ?? messageForSource(row.sourceSource)}
                </span>
                <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {originalDuration ?? '—'}
                </span>
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              {image(general, 'General result')}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  paddingTop: 7,
                  fontSize: 12,
                }}
              >
                <span>General · {detail?.template.label ?? 'General workflow'}</span>
                <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {generalDuration ?? '—'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 180px) minmax(0, 1fr)',
              gap: 12,
              alignItems: 'center',
            }}
          >
            {detail?.originalResultUrl ? (
              <div style={{ minWidth: 0 }}>
                {image(detail.originalResultUrl, 'Original result', true)}
                <div style={{ paddingTop: 6, color: 'var(--muted)', fontSize: 12 }}>
                  Original result
                </div>
              </div>
            ) : (
              <span />
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--muted)',
                fontSize: 13,
              }}
            >
              <Icon.Image />
              <span>{statusPlaceholder(row.status, row.unsupportedReason)}</span>
            </div>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginTop: 12,
          }}
        >
          {deltaLabel ? <span className="badge">{deltaLabel}</span> : <span />}
          <button type="button" className="btn sm" onClick={() => onOpen(row.id)}>
            View details
          </button>
        </div>
      </div>
    </article>
  );
}

export default function WorkflowComparisonsPage({ toast }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draftBacklogCap, setDraftBacklogCap] = useState('200');
  const [draftRetentionDays, setDraftRetentionDays] = useState('30');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [list, setList] = useState<ComparisonList | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState('COMPLETED');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, ComparisonDetail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const detailRequests = useRef(new Set<string>());
  const [preview, setPreview] = useState<{
    images: { url: string; label: string }[];
    index: number;
  } | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [selectedId, setSelectedId] = useUrlState('comparison');
  const [viewParam, setViewParam] = useUrlState('view');
  const view = viewParam === 'list' ? 'list' : 'gallery';
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
      if (details[id] || detailRequests.current.has(id)) return;
      detailRequests.current.add(id);
      try {
        const result = await apiFetch<ComparisonDetail>(`/admin/comparison/${id}`);
        setDetails((current) => ({ ...current, [id]: result }));
        setDetailErrors((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      } catch (err) {
        setDetailErrors((current) => ({
          ...current,
          [id]: apiErrorMessage(err, 'Please try again.'),
        }));
      } finally {
        detailRequests.current.delete(id);
      }
    },
    [details],
  );

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !previewRef.current) closeDetail();
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [selectedId, closeDetail]);

  useCrumb(
    0,
    selectedId
      ? {
          label: `Comparison ${selectedId.slice(0, 8)}`,
          href: `/workflow-comparisons?comparison=${encodeURIComponent(selectedId)}`,
        }
      : null,
  );

  const detail = selectedId ? details[selectedId] : undefined;

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
  const rows = list?.items ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Workflow Comparisons</h1>
          <p className="lede">
            General workflow replayed against real jobs, original vs general output.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span className="badge">
            Collected <strong className="mono">{list?.backlog.collected ?? '—'}</strong>
          </span>
          <span className="badge info">
            Queued <strong className="mono">{list?.backlog.queued ?? '—'}</strong>
          </span>
          <span className="badge accent">
            Running <strong className="mono">{list?.backlog.running ?? '—'}</strong>
          </span>
          <button
            type="button"
            className="btn sm"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
          >
            Settings
          </button>
          <button
            type="button"
            className="btn sm danger"
            disabled={saving || (list?.backlog.queued ?? 0) === 0}
            onClick={() => void cancelQueued()}
          >
            Cancel queued ({list?.backlog.queued ?? 0})
          </button>
        </div>
      </div>

      {settingsOpen && (
        <section className="card">
          <div
            className="card-body"
            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}
          >
            <div>
              <div className="setting-lbl" style={{ marginBottom: 6 }}>
                Automatic comparisons
              </div>
              {settingsLoading || !settings ? (
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</span>
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
                style={{ width: 110 }}
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
                style={{ width: 110 }}
                value={draftRetentionDays}
                disabled={saving || settingsLoading}
                onChange={(e) => setDraftRetentionDays(e.target.value)}
              />
            </label>
            <button
              type="button"
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
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-body">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'end',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <label style={{ display: 'grid', gap: 5, minWidth: 170 }}>
                <span className="setting-lbl">Status</span>
                <SearchableSelect
                  options={STATUSES.map((id) => ({ id, label: id.replaceAll('_', ' ') }))}
                  value={statusFilter}
                  emptyLabel="All statuses"
                  onChange={setStatusFilter}
                />
              </label>
              <label style={{ display: 'grid', gap: 5, minWidth: 210 }}>
                <span className="setting-lbl">Source workflow</span>
                <SearchableSelect
                  options={sourceOptions}
                  value={sourceFilter}
                  emptyLabel="All sources"
                  onChange={setSourceFilter}
                />
              </label>
            </div>
            <div className="btn-group">
              <button
                type="button"
                className={`btn sm${view === 'gallery' ? ' primary' : ''}`}
                aria-pressed={view === 'gallery'}
                onClick={() => setViewParam(null)}
              >
                Gallery
              </button>
              <button
                type="button"
                className={`btn sm${view === 'list' ? ' primary' : ''}`}
                aria-pressed={view === 'list'}
                onClick={() => setViewParam('list')}
              >
                List
              </button>
            </div>
          </div>

          {listLoading ? (
            <div style={{ color: 'var(--muted)', padding: '24px 0' }}>Loading comparisons…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: 'var(--muted)', padding: '24px 0' }}>
              No workflow comparisons found.
            </div>
          ) : view === 'list' ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Source workflow</th>
                    <th>Status</th>
                    <th>Unsupported reason</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className={selectedId === row.id ? 'selected' : undefined}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                        {row.id.slice(0, 8)}
                      </td>
                      <td>{messageForSource(row.sourceSource)}</td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                      <td>
                        {row.unsupportedReason ? (
                          <span className="badge">
                            {formatUnsupportedReason(row.unsupportedReason)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {rows.map((row) => (
                <ComparisonCard
                  key={row.id}
                  row={row}
                  detail={details[row.id]}
                  onVisible={(id) => void loadDetail(id)}
                  onOpen={setSelectedId}
                  onPreview={(images, index) =>
                    setPreview({ images, index: Math.min(index, images.length - 1) })
                  }
                />
              ))}
            </div>
          )}
          {nextCursor && (
            <button
              type="button"
              className="btn"
              disabled={loadingMore}
              onClick={() => void loadPage(nextCursor, true)}
              style={{ marginTop: 14 }}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </section>

      {selectedId && (
        <div className="modal-overlay" onClick={closeDetail}>
          <aside
            className="drawer"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 'min(620px, 100vw)' }}
          >
            <div className="drawer-head">
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
                  Comparison <span className="mono sub">{selectedId.slice(0, 8)}</span>
                </h2>
                {detail && (
                  <div style={{ marginTop: 6 }}>
                    <StatusBadge status={detail.status} />
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn sm ghost"
                onClick={closeDetail}
                style={{ marginLeft: 'auto' }}
                title="Close (Esc)"
              >
                <Icon.Close />
              </button>
            </div>
            <div
              className="drawer-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {!detail && !detailErrors[selectedId] ? (
                <p style={{ color: 'var(--muted)' }}>Loading comparison details…</p>
              ) : detailErrors[selectedId] ? (
                <p style={{ color: 'var(--danger)' }}>{detailErrors[selectedId]}</p>
              ) : (
                detail && (
                  <>
                    {detail.unsupportedReason && (
                      <div className="badge warn">
                        Unsupported · {formatUnsupportedReason(detail.unsupportedReason)}
                      </div>
                    )}
                    <section className="card">
                      <div className="card-head">
                        <h3>Inputs</h3>
                      </div>
                      <div className="card-body">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          {(['personUrl', 'garmentUrl'] as const).map((key) => (
                            <div key={key}>
                              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                                {key === 'personUrl' ? 'Person' : 'Garment'}
                              </div>
                              {detail.inputs[key] ? (
                                /* biome-ignore lint/performance/noImgElement: signed asset URL displayed in admin SPA */
                                <img
                                  src={detail.inputs[key] ?? undefined}
                                  alt={`${key === 'personUrl' ? 'Person' : 'Garment'} input`}
                                  loading="lazy"
                                  decoding="async"
                                  style={{
                                    width: '100%',
                                    maxHeight: 280,
                                    aspectRatio: '3 / 4',
                                    objectFit: 'contain',
                                    background: 'var(--surface-2)',
                                    borderRadius: 'var(--r-md)',
                                  }}
                                />
                              ) : (
                                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                                  Input unavailable
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                    <section className="card">
                      <div className="card-head">
                        <h3>Original job</h3>
                      </div>
                      <div className="card-body">
                        <dl className="kv" style={{ margin: 0, gridTemplateColumns: '100px 1fr' }}>
                          <KV k="Job ID" v={detail.source.jobId} mono />
                          <KV k="Source" v={messageForSource(detail.source.source)} />
                          <KV k="Workflow" v={detail.source.workflowLabel ?? '—'} />
                          <KV k="Worker" v={detail.source.workerId ?? '—'} />
                          <KV k="Duration" v={formatDuration(detail.source.durationMs) ?? '—'} />
                          <KV k="Error" v={detail.source.error ?? 'None'} />
                        </dl>
                      </div>
                    </section>
                    <section className="card">
                      <div className="card-head">
                        <h3>General job</h3>
                      </div>
                      <div className="card-body">
                        {detail.general ? (
                          <dl
                            className="kv"
                            style={{ margin: 0, gridTemplateColumns: '100px 1fr' }}
                          >
                            <KV k="Job ID" v={detail.general.jobId} mono />
                            <KV
                              k="Template"
                              v={`${detail.template.label ?? detail.template.id} · v${detail.template.version}`}
                            />
                            <KV k="Worker" v={detail.general.workerId ?? '—'} />
                            <KV k="Duration" v={formatDuration(detail.general.durationMs) ?? '—'} />
                            <KV k="Error" v={detail.general.error ?? 'None'} />
                          </dl>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>
                            General job not dispatched yet
                          </span>
                        )}
                      </div>
                    </section>
                  </>
                )
              )}
            </div>
          </aside>
        </div>
      )}

      {preview && preview.images.length > 0 && (
        <ImageLightbox
          images={preview.images}
          index={preview.index}
          onIndexChange={(index) =>
            setPreview((current) => (current ? { ...current, index } : current))
          }
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
