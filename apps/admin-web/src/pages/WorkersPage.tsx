import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditDrawer } from '../components/EditDrawer';
import { Icon } from '../components/Icons';
import { Switch } from '../components/Switch';
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState, useUrlStateMulti } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';

type JobType = string;

function jobTypeLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

interface Worker {
  id: string;
  label: string;
  url: string;
  apiKeyHint: string;
  isActive: boolean;
  allowedJobTypes: JobType[];
  status: 'IDLE' | 'BUSY' | 'DRAINING';
  healthy: boolean;
  lastSeen: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

const EMPTY_FORM = {
  id: '',
  label: '',
  url: '',
  apiKey: '',
  allowedJobTypes: [] as JobType[],
  jobTypeMode: 'all' as 'all' | 'selected',
};

const WORKER_ID_PATTERN = /^[\w-]+$/;

// ─── Derived state helpers ────────────────────────────────────────────────────

/** One unified state label + colour from status + health.
 *  label/color → primary signal (coloured dot + text)
 *  detail       → secondary workload note, always rendered muted */
function workerState(w: Worker): {
  label: string;
  detail: string;
  color: string;
} {
  if (!w.healthy) {
    return { label: 'Offline', detail: '—', color: 'var(--danger)' };
  }
  if (w.status === 'DRAINING') {
    return { label: 'Draining', detail: 'Finishing jobs', color: 'var(--warn)' };
  }
  if (w.status === 'BUSY') {
    return { label: 'Healthy', detail: 'Processing', color: 'var(--success)' };
  }
  return { label: 'Healthy', detail: 'Idle', color: 'var(--success)' };
}

function formatLastSeen(ts: number | null): string {
  if (!ts) return '—';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/** Compact job-type summary for the table cell. */
function jobTypeSummary(types: JobType[]): string {
  if (!types || types.length === 0) return 'All';
  if (types.length === 1) return jobTypeLabel(types[0]);
  if (types.length === 2) return types.map(jobTypeLabel).join(', ');
  return `${jobTypeLabel(types[0])} +${types.length - 1}`;
}

// ─── Status dot ──────────────────────────────────────────────────────────────

function StatusDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

// ─── ⋯ row-actions menu ──────────────────────────────────────────────────────

interface RowMenuProps {
  worker: Worker;
  onEdit: () => void;
  onToggle: () => void;
  onDrain: () => void;
  onUndrain: () => void;
  onDelete: () => void;
  deleting: boolean;
}

function RowMenu({
  worker: w,
  onEdit,
  onToggle,
  onDrain,
  onUndrain,
  onDelete,
  deleting,
}: RowMenuProps) {
  const [open, setOpen] = useState(false);
  // Position of the floating menu in viewport coords
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Compute fixed position from trigger button's bounding rect
  function openMenu() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setMenuPos({
        top: r.bottom + 4,
        right: window.innerWidth - r.right,
      });
    }
    setOpen(true);
  }

  // Reposition if window resizes or page scrolls while open
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    function recompute() {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      const outsideBtn = !btnRef.current?.contains(target);
      const outsideMenu = !menuRef.current?.contains(target);
      if (outsideBtn && outsideMenu) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function item(label: string, action: () => void, danger = false, disabled = false) {
    return (
      <button
        key={label}
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(false);
          action();
        }}
        style={{
          display: 'block',
          width: '100%',
          padding: '8px 14px',
          background: 'none',
          border: 'none',
          textAlign: 'left',
          fontSize: '0.85rem',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: disabled ? 'var(--muted)' : danger ? 'var(--danger)' : 'var(--ink)',
          borderRadius: 4,
        }}
        onMouseEnter={(e) => {
          if (!disabled)
            (e.currentTarget as HTMLButtonElement).style.background = danger
              ? 'color-mix(in srgb, var(--danger) 10%, transparent)'
              : 'var(--surface-hover, var(--surface-2))';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'none';
        }}
      >
        {label}
      </button>
    );
  }

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: menuPos.top,
              right: menuPos.right,
              zIndex: 9999,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-md)',
              minWidth: 180,
              padding: '4px',
            }}
          >
            {item('Edit worker', onEdit)}
            {w.status === 'DRAINING'
              ? item('Undrain (resume)', onUndrain)
              : item('Drain worker', onDrain, false, !w.isActive)}
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            {item(w.isActive ? 'Disable worker' : 'Enable worker', onToggle)}
            {item('Delete worker', onDelete, true, w.status === 'BUSY' || deleting)}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => (open ? setOpen(false) : openMenu())}
        title="Actions"
        style={{ padding: '4px 8px' }}
      >
        <Icon.MoreHorizontal />
      </button>
      {menu}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WorkersPage({ toast }: Props) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // ── URL-tracked drawer state ──────────────────────────────────────────────
  const [{ modal: modalParam, editId }, setModalParams] = useUrlStateMulti(['modal', 'editId']);
  const closeModalOverlay = useCloseOverlay(['modal', 'editId']);
  const showDrawer = modalParam === 'add' || modalParam === 'edit';
  const editTarget =
    modalParam === 'edit' && editId ? (workers.find((w) => w.id === editId) ?? null) : null;

  // ── URL-tracked delete confirm ────────────────────────────────────────────
  const [{ confirm: confirmParam, confirmId }, setConfirmParams] = useUrlStateMulti([
    'confirm',
    'confirmId',
  ]);
  const closeConfirm = useCloseOverlay(['confirm', 'confirmId']);
  const confirmDelete =
    confirmParam === 'delete-worker' && confirmId
      ? (workers.find((w) => w.id === confirmId) ?? null)
      : null;

  // ── Mobile expand ─────────────────────────────────────────────────────────
  const [expandedWorkerId, setExpandedWorkerId] = useUrlState('expanded');
  const closeExpanded = useCloseOverlay(['expanded']);

  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Revealed API key in the drawer
  const [apiKeyRevealed, setApiKeyRevealed] = useState(false);
  // Test-connection result for the current drawer form
  const [testConn, setTestConn] = useState<
    | { status: 'idle' }
    | { status: 'testing' }
    | { status: 'ok'; latencyMs: number }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  // ── Search + filter state ─────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterJobType, setFilterJobType] = useState('all');

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Breadcrumbs ───────────────────────────────────────────────────────────
  useCrumb(
    0,
    confirmDelete
      ? {
          label: 'Delete worker',
          href: `/workers?confirm=delete-worker&confirmId=${encodeURIComponent(confirmDelete.id)}`,
        }
      : null,
  );
  useCrumb(
    1,
    modalParam
      ? {
          label: modalParam === 'add' ? 'Add worker' : `Edit ${editId ?? ''}`,
          href: `/workers?modal=${modalParam}${editId ? `&editId=${encodeURIComponent(editId)}` : ''}`,
        }
      : null,
  );

  // ── Seed form when edit target resolves ──────────────────────────────────
  const editTargetId = editTarget?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on id only, see comment above
  useEffect(() => {
    if (!editTarget) return;
    const hasSelected = (editTarget.allowedJobTypes ?? []).length > 0;
    setForm({
      id: editTarget.id,
      label: editTarget.label,
      url: editTarget.url,
      apiKey: '',
      allowedJobTypes: editTarget.allowedJobTypes ?? [],
      jobTypeMode: hasSelected ? 'selected' : 'all',
    });
    setApiKeyRevealed(false);
  }, [editTargetId]);

  // ── Data loading ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Worker[]>('/admin/workers');
      setWorkers(data);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load workers',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => void load(), 15_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  useEffect(() => {
    apiFetch<string[]>('/admin/workers/job-types')
      .then(setJobTypes)
      .catch((e) => {
        toast({
          kind: 'error',
          title: 'Failed to load job types',
          body: apiErrorMessage(e, 'Please try again.'),
        });
      });
  }, [toast]);

  // ── Actions ───────────────────────────────────────────────────────────────
  function openAdd() {
    setForm({ ...EMPTY_FORM, jobTypeMode: 'all' });
    setApiKeyRevealed(false);
    setTestConn({ status: 'idle' });
    setModalParams({ modal: 'add', editId: null });
  }

  function openEdit(w: Worker) {
    setTestConn({ status: 'idle' });
    setModalParams({ modal: 'edit', editId: w.id });
  }

  function closeDrawer() {
    closeModalOverlay();
    setForm(EMPTY_FORM);
    setApiKeyRevealed(false);
    setTestConn({ status: 'idle' });
  }

  async function handleTestConnection() {
    // Need a URL and some key to test. For edit mode the admin may not have
    // re-typed the key, so we only allow test when they've entered one.
    if (!form.url.startsWith('http') || !form.apiKey) return;
    setTestConn({ status: 'testing' });
    try {
      const res = await apiFetch<{ ok: boolean; latencyMs?: number; error?: string }>(
        '/admin/workers/test-connection',
        {
          method: 'POST',
          body: JSON.stringify({ url: form.url, apiKey: form.apiKey }),
        },
      );
      if (res.ok) {
        setTestConn({ status: 'ok', latencyMs: res.latencyMs ?? 0 });
      } else {
        setTestConn({ status: 'error', message: res.error ?? 'Connection failed' });
      }
    } catch (e) {
      setTestConn({ status: 'error', message: apiErrorMessage(e, 'Connection failed') });
    }
  }

  async function handleSave() {
    setSaving(true);
    // Resolve allowed job types from mode
    const resolvedTypes = form.jobTypeMode === 'all' ? [] : form.allowedJobTypes;

    try {
      if (editTarget) {
        const body: Record<string, string | boolean | string[]> = {};
        if (form.id !== editTarget.id) body.id = form.id.trim();
        if (form.label !== editTarget.label) body.label = form.label;
        if (form.url !== editTarget.url) body.url = form.url;
        if (form.apiKey) body.apiKey = form.apiKey;
        const typesChanged =
          JSON.stringify([...resolvedTypes].sort()) !==
          JSON.stringify([...(editTarget.allowedJobTypes ?? [])].sort());
        if (typesChanged) body.allowedJobTypes = resolvedTypes;
        await apiFetch(`/admin/workers/${editTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        toast({ title: 'Worker updated' });
      } else {
        await apiFetch('/admin/workers', {
          method: 'POST',
          body: JSON.stringify({ ...form, id: form.id.trim(), allowedJobTypes: resolvedTypes }),
        });
        toast({ title: 'Worker added' });
      }
      closeDrawer();
      void load();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'body' in err
          ? ((err as { body?: { error?: { message?: string } } }).body?.error?.message ?? 'Failed')
          : 'Failed';
      toast({ kind: 'error', title: msg });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(w: Worker) {
    try {
      await apiFetch(`/admin/workers/${w.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !w.isActive }),
      });
      toast({ title: `Worker ${w.id} ${w.isActive ? 'disabled' : 'enabled'}` });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update worker',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }

  async function handleDrain(w: Worker) {
    try {
      await apiFetch(`/admin/workers/${w.id}/drain`, { method: 'POST' });
      toast({ title: `Worker ${w.id} draining` });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to drain worker',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }

  async function handleUndrain(w: Worker) {
    try {
      await apiFetch(`/admin/workers/${w.id}/undrain`, { method: 'POST' });
      toast({ title: `Worker ${w.id} back to Idle` });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to undrain worker',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  }

  function handleDelete(w: Worker) {
    setConfirmParams({ confirm: 'delete-worker', confirmId: w.id });
  }

  async function doDelete(id: string) {
    closeConfirm();
    setDeleting(id);
    try {
      await apiFetch(`/admin/workers/${id}`, { method: 'DELETE' });
      toast({ title: `Worker ${id} deleted` });
      void load();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'body' in err
          ? ((err as { body?: { error?: { message?: string } } }).body?.error?.message ?? 'Failed')
          : 'Failed';
      toast({ kind: 'error', title: msg });
    } finally {
      setDeleting(null);
    }
  }

  // ── Form validation ───────────────────────────────────────────────────────
  const normalizedId = form.id.trim();
  const hasValidId = normalizedId.length > 0 && WORKER_ID_PATTERN.test(normalizedId);
  const canSave = editTarget
    ? hasValidId && form.url.startsWith('http')
    : hasValidId && form.url.startsWith('http') && form.apiKey.length > 0;

  // ── Summary stats ─────────────────────────────────────────────────────────
  const totalWorkers = workers.length;
  const healthyCount = workers.filter((w) => w.healthy && w.status !== 'DRAINING').length;
  const offlineCount = workers.filter((w) => !w.healthy).length;
  const drainingCount = workers.filter((w) => w.healthy && w.status === 'DRAINING').length;

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredWorkers = workers.filter((w) => {
    if (search) {
      const q = search.toLowerCase();
      const matchesId = w.id.toLowerCase().includes(q);
      const matchesLabel = w.label?.toLowerCase().includes(q);
      const matchesUrl = w.url?.toLowerCase().includes(q);
      const matchesType = (w.allowedJobTypes ?? []).some((t) => t.toLowerCase().includes(q));
      if (!matchesId && !matchesLabel && !matchesUrl && !matchesType) return false;
    }
    if (filterStatus !== 'all') {
      const s = workerState(w);
      if (filterStatus === 'healthy' && s.label !== 'Healthy') return false;
      if (filterStatus === 'offline' && s.label !== 'Offline') return false;
      if (filterStatus === 'draining' && s.label !== 'Draining') return false;
    }
    if (filterJobType !== 'all') {
      const hasAll = !w.allowedJobTypes || w.allowedJobTypes.length === 0;
      if (filterJobType === '__all__' && !hasAll) return false;
      if (filterJobType !== '__all__' && !hasAll && !w.allowedJobTypes.includes(filterJobType))
        return false;
    }
    return true;
  });

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Page header */}
      <div className="page-head">
        <div>
          <h1>Workers</h1>
          <p className="lede">Manage your ComfyUI GPU workers</p>
        </div>
        <button className="btn btn--primary" onClick={openAdd}>
          <Icon.Add />
          Add worker
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', padding: '24px 0' }}>Loading…</p>
      ) : workers.length === 0 ? (
        /* ── Empty state ──────────────────────────────────────────────────── */
        <div
          style={{
            padding: '64px 24px',
            textAlign: 'center',
            color: 'var(--muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <span style={{ color: 'var(--border-strong)', opacity: 0.7 }}>
            <Icon.Server />
          </span>
          <div>
            <p style={{ margin: 0, fontWeight: 500, color: 'var(--ink)', fontSize: '1rem' }}>
              No workers yet
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '0.875rem' }}>
              Connect your first ComfyUI GPU worker to start processing jobs.
            </p>
          </div>
          <button className="btn btn--primary" onClick={openAdd}>
            <Icon.Add />
            Add worker
          </button>
        </div>
      ) : (
        <>
          {/* ── Summary strip ────────────────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              gap: 24,
              marginBottom: 20,
              flexWrap: 'wrap',
            }}
          >
            {[
              { label: 'Total', value: totalWorkers, color: 'var(--ink)' },
              { label: 'Healthy', value: healthyCount, color: 'var(--success)' },
              { label: 'Offline', value: offlineCount, color: 'var(--danger)' },
              { label: 'Draining', value: drainingCount, color: 'var(--warn)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{value}</span>
                <span style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 500 }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* ── Search + filters ─────────────────────────────────────────── */}
          <div className="filter-row" style={{ marginBottom: 16 }}>
            <div className="filter-search-box">
              <Icon.Search />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search workers…"
              />
              {search && (
                <button className="filter-clear-btn" onClick={() => setSearch('')}>
                  <Icon.Close />
                </button>
              )}
            </div>

            <select
              className="filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">Status · All</option>
              <option value="healthy">Status · Healthy</option>
              <option value="offline">Status · Offline</option>
              <option value="draining">Status · Draining</option>
            </select>

            <select
              className="filter-select"
              value={filterJobType}
              onChange={(e) => setFilterJobType(e.target.value)}
            >
              <option value="all">Job type · All</option>
              <option value="__all__">Job type · Accepts all</option>
              {jobTypes.map((t) => (
                <option key={t} value={t}>
                  {jobTypeLabel(t)}
                </option>
              ))}
            </select>
          </div>

          {/* ── Desktop table ─────────────────────────────────────────────── */}
          <div className="desktop-only table-wrap">
            <table className="table">
              <colgroup>
                {/* Worker, Job types, Status, Last seen, Enabled, Actions */}
                <col style={{ width: '30%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Job types</th>
                  <th>Status</th>
                  <th>Last seen</th>
                  <th>Enabled</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredWorkers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        textAlign: 'center',
                        color: 'var(--muted)',
                        padding: '32px 0',
                        fontSize: '0.875rem',
                      }}
                    >
                      No workers match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredWorkers.map((w) => {
                    const state = workerState(w);
                    return (
                      <tr key={w.id} style={{ opacity: w.isActive ? 1 : 0.6 }}>
                        {/* Worker column: ID (dominant) + display name */}
                        <td>
                          <div
                            style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--ink)' }}
                          >
                            {w.id}
                          </div>
                          {w.label && (
                            <div
                              style={{
                                color: 'var(--muted)',
                                fontSize: '0.75rem',
                                fontFamily: 'var(--mono, monospace)',
                                marginTop: 1,
                              }}
                            >
                              {w.label}
                            </div>
                          )}
                        </td>

                        {/* Job types: compact summary */}
                        <td>
                          <span
                            style={{
                              fontSize: '0.82rem',
                              color:
                                w.allowedJobTypes && w.allowedJobTypes.length > 0
                                  ? 'var(--ink)'
                                  : 'var(--muted)',
                              fontWeight:
                                w.allowedJobTypes && w.allowedJobTypes.length > 0 ? 500 : 400,
                            }}
                          >
                            {jobTypeSummary(w.allowedJobTypes)}
                          </span>
                        </td>

                        {/* Unified status: primary (coloured) + secondary detail (muted) */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <StatusDot color={state.color} />
                            <div>
                              <div
                                style={{
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  color: state.color,
                                  lineHeight: 1.2,
                                }}
                              >
                                {state.label}
                              </div>
                              {/* Detail is always muted — it's workload state, not health */}
                              <div
                                style={{
                                  fontSize: '0.72rem',
                                  color: 'var(--muted)',
                                  lineHeight: 1.2,
                                  marginTop: 1,
                                }}
                              >
                                {state.detail}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Last seen: quiet */}
                        <td style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                          {formatLastSeen(w.lastSeen)}
                        </td>

                        {/* Enabled toggle — header is the label, no need for per-row text */}
                        <td>
                          <Switch
                            checked={w.isActive}
                            onChange={() => void handleToggleActive(w)}
                          />
                        </td>

                        {/* ⋯ actions menu */}
                        <td style={{ textAlign: 'right' }}>
                          <RowMenu
                            worker={w}
                            onEdit={() => openEdit(w)}
                            onToggle={() => void handleToggleActive(w)}
                            onDrain={() => void handleDrain(w)}
                            onUndrain={() => void handleUndrain(w)}
                            onDelete={() => handleDelete(w)}
                            deleting={deleting === w.id}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ──────────────────────────────────────────────── */}
          <div className="mobile-only">
            {filteredWorkers.map((w) => {
              const isExpanded = expandedWorkerId === w.id;
              const state = workerState(w);
              return (
                <div
                  key={w.id}
                  className="card"
                  style={{
                    padding: 0,
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--surface)',
                    opacity: w.isActive ? 1 : 0.6,
                    marginBottom: 8,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => (isExpanded ? closeExpanded() : setExpandedWorkerId(w.id))}
                    style={{
                      padding: '14px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: 'none',
                      border: 'none',
                      width: '100%',
                      textAlign: 'left',
                      color: 'inherit',
                      fontFamily: 'inherit',
                      fontSize: 'inherit',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <StatusDot color={state.color} />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 15,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {w.id}
                        </div>
                        {w.label && (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--muted)',
                              fontFamily: 'var(--mono, monospace)',
                            }}
                          >
                            {w.label}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: state.color,
                        }}
                      >
                        {state.label}
                      </span>
                      <span
                        style={{
                          color: 'var(--muted-2)',
                          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s',
                          display: 'inline-flex',
                        }}
                      >
                        <Icon.Chevron />
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div
                      style={{
                        padding: '16px',
                        borderTop: '1px solid var(--border)',
                        background: 'var(--surface-2)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        fontSize: 13,
                      }}
                    >
                      {/* Detail rows */}
                      {[
                        { label: 'Job types', value: jobTypeSummary(w.allowedJobTypes) },
                        { label: 'Status', value: `${state.label} · ${state.detail}` },
                        { label: 'Last seen', value: formatLastSeen(w.lastSeen) },
                      ].map(({ label, value }) => (
                        <div
                          key={label}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--ink)' }}>{value}</span>
                        </div>
                      ))}

                      {/* Actions */}
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginTop: 4,
                          paddingTop: 10,
                          borderTop: '1px solid var(--border)',
                        }}
                      >
                        <Switch checked={w.isActive} onChange={() => void handleToggleActive(w)} />
                        <span
                          style={{
                            fontSize: '0.78rem',
                            color: w.isActive ? 'var(--ink)' : 'var(--muted)',
                            fontWeight: 500,
                            alignSelf: 'center',
                          }}
                        >
                          {w.isActive ? 'Enabled' : 'Disabled'}
                        </span>
                        <button className="btn btn--ghost btn--sm" onClick={() => openEdit(w)}>
                          <Icon.Edit /> Edit
                        </button>
                        {w.status === 'DRAINING' ? (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => void handleUndrain(w)}
                          >
                            Undrain
                          </button>
                        ) : (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => void handleDrain(w)}
                            disabled={!w.isActive}
                          >
                            Drain
                          </button>
                        )}
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => handleDelete(w)}
                          disabled={w.status === 'BUSY' || deleting === w.id}
                          style={{ color: 'var(--danger)' }}
                        >
                          <Icon.Trash /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Add / Edit drawer ──────────────────────────────────────────────── */}
      {showDrawer && (
        <EditDrawer
          title={editTarget ? 'Edit worker' : 'Add worker'}
          subtitle={
            editTarget
              ? editTarget.label
                ? `${editTarget.id} · ${editTarget.label}`
                : editTarget.id
              : undefined
          }
          onClose={closeDrawer}
          onSave={() => void handleSave()}
          saving={saving}
          saveLabel={editTarget ? 'Save changes' : 'Add worker'}
          saveDisabled={!canSave}
          width="420px"
        >
          {/* Worker ID */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 500 }}>
              Worker ID <span style={{ color: 'var(--danger)' }}>*</span>
            </span>
            <input
              className="input"
              placeholder="worker-c"
              value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              Alphanumeric + dashes, e.g. worker-a
            </span>
          </label>

          {/* Display name */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 500 }}>
              Display name
            </span>
            <input
              className="input"
              placeholder="GPU Server C"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </label>

          {/* URL — reset test result when changed */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 500 }}>
              URL <span style={{ color: 'var(--danger)' }}>*</span>
            </span>
            <input
              className="input"
              placeholder="https://1.2.3.4/"
              value={form.url}
              onChange={(e) => {
                setForm((f) => ({ ...f, url: e.target.value }));
                setTestConn({ status: 'idle' });
              }}
            />
          </label>

          {/* API key — reset test result when changed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 500 }}>
              API key{!editTarget && <span style={{ color: 'var(--danger)' }}> *</span>}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type={apiKeyRevealed ? 'text' : 'password'}
                placeholder={editTarget ? '••••••••' : 'API key'}
                value={form.apiKey}
                onChange={(e) => {
                  setForm((f) => ({ ...f, apiKey: e.target.value }));
                  setTestConn({ status: 'idle' });
                }}
                autoComplete="new-password"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setApiKeyRevealed((v) => !v)}
                title={apiKeyRevealed ? 'Hide' : 'Reveal'}
              >
                {apiKeyRevealed ? <Icon.EyeOff /> : <Icon.Eye />}
              </button>
            </div>
            {editTarget && (
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                Leave blank to keep the current key.
              </span>
            )}
          </div>

          {/* Test connection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ alignSelf: 'flex-start' }}
              disabled={
                testConn.status === 'testing' || !form.url.startsWith('http') || !form.apiKey
              }
              onClick={() => void handleTestConnection()}
              title={
                !form.apiKey
                  ? editTarget
                    ? 'Enter a new API key to test'
                    : 'Enter an API key to test'
                  : 'Test connection to this worker'
              }
            >
              {testConn.status === 'testing' ? 'Testing…' : 'Test connection'}
            </button>

            {testConn.status === 'ok' && (
              <span
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--success)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <Icon.Check />
                Connected · {testConn.latencyMs}ms
              </span>
            )}
            {testConn.status === 'error' && (
              <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>
                ✕ {testConn.message}
              </span>
            )}
            {editTarget && testConn.status === 'idle' && !form.apiKey && (
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                Enter a new API key above to test.
              </span>
            )}
          </div>

          {/* Job types: explicit All vs Selected */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 500 }}>
              Job types
            </span>

            {/* Mode selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(['all', 'selected'] as const).map((mode) => (
                <label
                  key={mode}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  <input
                    type="radio"
                    name="jobTypeMode"
                    checked={form.jobTypeMode === mode}
                    onChange={() => setForm((f) => ({ ...f, jobTypeMode: mode }))}
                  />
                  {mode === 'all' ? 'All job types' : 'Selected job types'}
                </label>
              ))}
            </div>

            {/* Checkboxes only when Selected is chosen — plain indent, no border */}
            {form.jobTypeMode === 'selected' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  paddingLeft: 20,
                }}
              >
                {jobTypes.map((t) => (
                  <label
                    key={t}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.allowedJobTypes.includes(t)}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          allowedJobTypes: e.target.checked
                            ? [...f.allowedJobTypes, t]
                            : f.allowedJobTypes.filter((x) => x !== t),
                        }))
                      }
                    />
                    {jobTypeLabel(t)}
                  </label>
                ))}
              </div>
            )}
          </div>
        </EditDrawer>
      )}

      {/* ── Delete confirmation modal ─────────────────────────────────────── */}
      {confirmDelete && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
          }}
          onClick={(e) => e.target === e.currentTarget && closeConfirm()}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 28,
              width: 380,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Delete worker</h3>
              <button className="btn btn--ghost btn--sm" onClick={closeConfirm}>
                <Icon.Close />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
              Delete{' '}
              <strong style={{ color: 'var(--text)' }}>
                {confirmDelete.label || confirmDelete.id}
              </strong>
              ? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={closeConfirm}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={() => void doDelete(confirmDelete.id)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
