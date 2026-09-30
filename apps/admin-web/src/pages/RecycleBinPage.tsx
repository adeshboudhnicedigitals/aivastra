import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { Pager } from '../components/Pager';
import { useAuth } from '../context/AuthContext';
import { useCrumb } from '../context/BreadcrumbContext';
import { useCloseOverlay } from '../hooks/use-close-overlay';
import { useUrlState } from '../hooks/use-url-state';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { ModelBackground, ModelFace, ModelPoseAsset } from '../types';

const PAGE_SIZE = 50;

type RbTab = 'faces' | 'backgrounds' | 'poseAssets';

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear}y ago`;
}

function Thumb({
  thumbnailUrl,
  label,
  type = 'face',
  onClick,
}: {
  thumbnailUrl: string | null;
  label: string;
  type?: 'face' | 'background' | 'poseAsset';
  onClick?: () => void;
}) {
  const dims =
    type === 'face'
      ? { width: 64, height: 64, borderRadius: 8 }
      : type === 'background'
        ? { width: 88, height: 58, borderRadius: 8 }
        : { width: 52, height: 76, borderRadius: 8 };

  const content = thumbnailUrl ? (
    // biome-ignore lint/performance/noImgElement: thumbnail in recycle bin table
    <img
      src={thumbnailUrl}
      alt={label}
      loading="lazy"
      style={{
        width: dims.width,
        height: dims.height,
        borderRadius: dims.borderRadius,
        objectFit: 'cover',
        flexShrink: 0,
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
    />
  ) : (
    <div
      style={{
        width: dims.width,
        height: dims.height,
        borderRadius: dims.borderRadius,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--muted)',
      }}
    >
      {label.slice(0, 2).toUpperCase()}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Click to view full preview"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'zoom-in',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: dims.borderRadius,
          outline: 'none',
        }}
      >
        {content}
      </button>
    );
  }

  return content;
}

const TAB_LABELS: Record<RbTab, string> = {
  faces: 'Faces',
  backgrounds: 'Backgrounds',
  poseAssets: 'Pose assets',
};

const EMPTY_STATES: Record<RbTab, { title: string; desc: string }> = {
  faces: {
    title: 'No deleted faces',
    desc: 'Deleted faces will appear here when they are moved to the recycle bin.',
  },
  backgrounds: {
    title: 'No deleted backgrounds',
    desc: 'Deleted backgrounds will appear here when they are moved to the recycle bin.',
  },
  poseAssets: {
    title: 'No deleted pose assets',
    desc: 'Deleted pose assets will appear here when they are moved to the recycle bin.',
  },
};

const PERM_DELETE_TYPE: Record<string, 'face' | 'background' | 'poseAsset'> = {
  'perm-delete-face': 'face',
  'perm-delete-background': 'background',
  'perm-delete-poseAsset': 'poseAsset',
};
const PERM_DELETE_CONFIRM: Record<'face' | 'background' | 'poseAsset', string> = {
  face: 'perm-delete-face',
  background: 'perm-delete-background',
  poseAsset: 'perm-delete-poseAsset',
};

export default function RecycleBinPage({ toast }: Props) {
  const { hasPermission } = useAuth();
  const canHardDelete = hasPermission('assets.delete');
  const [loading, setLoading] = useState(false);
  const [faces, setFaces] = useState<ModelFace[]>([]);
  const [backgrounds, setBackgrounds] = useState<ModelBackground[]>([]);
  const [poseAssets, setPoseAssets] = useState<ModelPoseAsset[]>([]);
  const [tabParam, setTabParam] = useUrlState('tab');
  const tab: RbTab = tabParam === 'backgrounds' || tabParam === 'poseAssets' ? tabParam : 'faces';
  const [selectedFaceIds, setSelectedFaceIds] = useState<string[]>([]);
  const [selectedBgIds, setSelectedBgIds] = useState<string[]>([]);
  const [selectedPaIds, setSelectedPaIds] = useState<string[]>([]);
  const [deletedSort, setDeletedSort] = useState<'desc' | 'asc'>('desc');
  const [confirmParam, setConfirmParam] = useUrlState('confirm');
  const closeConfirm = useCloseOverlay(['confirm']);
  const permDelType = confirmParam ? PERM_DELETE_TYPE[confirmParam] : undefined;
  const [permDelIds, setPermDelIds] = useState<string[]>([]);
  const permDel = permDelType ? { type: permDelType, ids: permDelIds } : null;
  const [working, setWorking] = useState(false);
  const [facePage, setFacePage] = useState(0);
  const [bgPage, setBgPage] = useState(0);
  const [paPage, setPaPage] = useState(0);
  const [previewAsset, setPreviewAsset] = useState<{
    url: string;
    label: string;
    meta?: string;
  } | null>(null);

  useEffect(() => {
    if (!previewAsset) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPreviewAsset(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewAsset]);

  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  useCrumb(0, { label: TAB_LABELS[tab], href: `/recycle-bin?tab=${tab}` });
  useCrumb(
    1,
    permDel
      ? { label: 'Permanently delete', href: `/recycle-bin?tab=${tab}&confirm=${confirmParam}` }
      : null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        faces: ModelFace[];
        backgrounds: ModelBackground[];
        poseAssets: ModelPoseAsset[];
      }>('/admin/assets/recycle-bin');
      setFaces(res.faces);
      setBackgrounds(res.backgrounds);
      setPoseAssets(res.poseAssets);
      setSelectedFaceIds([]);
      setSelectedBgIds([]);
      setSelectedPaIds([]);
      setFacePage(0);
      setBgPage(0);
      setPaPage(0);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load recycle bin',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(type: 'face' | 'background' | 'poseAsset', ids: string[], label: string) {
    setWorking(true);
    try {
      await apiFetch('/admin/assets/recycle-bin/restore', {
        method: 'POST',
        body: JSON.stringify({ type, ids }),
      });
      toast({ title: `${label} restored` });
      void load();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Restore failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setWorking(false);
    }
  }

  const selectedIds =
    tab === 'faces' ? selectedFaceIds : tab === 'backgrounds' ? selectedBgIds : selectedPaIds;
  const setSelectedIds =
    tab === 'faces'
      ? setSelectedFaceIds
      : tab === 'backgrounds'
        ? setSelectedBgIds
        : setSelectedPaIds;

  const currentType = tab === 'faces' ? 'face' : tab === 'backgrounds' ? 'background' : 'poseAsset';
  const currentItems = tab === 'faces' ? faces : tab === 'backgrounds' ? backgrounds : poseAssets;

  const sortedFaces = useMemo(() => {
    return [...faces].sort((a, b) => {
      const da = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
      const db = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
      return deletedSort === 'desc' ? db - da : da - db;
    });
  }, [faces, deletedSort]);

  const sortedBgs = useMemo(() => {
    return [...backgrounds].sort((a, b) => {
      const da = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
      const db = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
      return deletedSort === 'desc' ? db - da : da - db;
    });
  }, [backgrounds, deletedSort]);

  const sortedPas = useMemo(() => {
    return [...poseAssets].sort((a, b) => {
      const da = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
      const db = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
      return deletedSort === 'desc' ? db - da : da - db;
    });
  }, [poseAssets, deletedSort]);

  const pagedFaces = sortedFaces.slice(facePage * PAGE_SIZE, (facePage + 1) * PAGE_SIZE);
  const pagedBgs = sortedBgs.slice(bgPage * PAGE_SIZE, (bgPage + 1) * PAGE_SIZE);
  const pagedPas = sortedPas.slice(paPage * PAGE_SIZE, (paPage + 1) * PAGE_SIZE);
  const pagedItems = tab === 'faces' ? pagedFaces : tab === 'backgrounds' ? pagedBgs : pagedPas;

  const pagedIds = pagedItems.map((i) => i.id);
  const pageSelectedCount = pagedIds.filter((id) => selectedIds.includes(id)).length;
  const isPageFullySelected = pagedIds.length > 0 && pageSelectedCount === pagedIds.length;
  const isPagePartiallySelected = pageSelectedCount > 0 && !isPageFullySelected;
  const isAllItemsSelected = currentItems.length > 0 && selectedIds.length === currentItems.length;

  const setHeaderCheckbox = useCallback(
    (node: HTMLInputElement | null) => {
      headerCheckboxRef.current = node;
      if (node) {
        node.indeterminate = isPagePartiallySelected;
      }
    },
    [isPagePartiallySelected],
  );

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isPagePartiallySelected;
    }
  }, [isPagePartiallySelected]);

  function handleTogglePage() {
    if (isPageFullySelected) {
      setSelectedIds((prev) => prev.filter((id) => !pagedIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pagedIds])));
    }
  }

  function pluralLabel(type: 'face' | 'background' | 'poseAsset', n: number) {
    if (type === 'face') return n === 1 ? 'face' : 'faces';
    if (type === 'background') return n === 1 ? 'background' : 'backgrounds';
    return n === 1 ? 'pose asset' : 'pose assets';
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>Recycle bin</h1>
          <p className="lede" style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>
            Manage deleted assets and restore or permanently remove them.
          </p>
        </div>
        <div className="head-tools">
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void load()}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon.Refresh />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="tabs">
        {(
          [
            { k: 'faces', label: 'Faces', count: faces.length },
            { k: 'backgrounds', label: 'Backgrounds', count: backgrounds.length },
            { k: 'poseAssets', label: 'Pose assets', count: poseAssets.length },
          ] as { k: RbTab; label: string; count: number }[]
        ).map((t) => (
          <button
            key={t.k}
            type="button"
            className={`tab ${tab === t.k ? 'active' : ''}`}
            onClick={() => {
              setTabParam(t.k === 'faces' ? null : t.k);
              setFacePage(0);
              setBgPage(0);
              setPaPage(0);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: tab === t.k ? 600 : 500,
            }}
          >
            <span>{t.label}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 10,
                background: tab === t.k ? 'var(--subtle)' : 'var(--surface-2)',
                color: tab === t.k ? 'var(--ink)' : 'var(--muted)',
                border: '1px solid var(--border)',
                lineHeight: '16px',
              }}
            >
              {t.count.toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '3rem' }}>
          Loading recycle bin assets…
        </div>
      ) : currentItems.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '56px 24px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r, 8px)',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'var(--surface-2)',
              color: 'var(--muted)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              fontSize: 22,
            }}
          >
            ♻
          </div>
          <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
            {EMPTY_STATES[tab].title}
          </h3>
          <p
            style={{
              margin: '0 auto 20px',
              fontSize: 13,
              color: 'var(--muted)',
              maxWidth: 380,
              lineHeight: 1.5,
            }}
          >
            {EMPTY_STATES[tab].desc}
          </p>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void load()}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon.Refresh /> Refresh
          </button>
        </div>
      ) : (
        <>
          {selectedIds.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 16px',
                background: isAllItemsSelected
                  ? 'rgba(var(--primary-rgb, 99, 102, 241), 0.08)'
                  : 'var(--surface-2)',
                border: isAllItemsSelected
                  ? '1px solid rgba(var(--primary-rgb, 99, 102, 241), 0.25)'
                  : '1px solid var(--border)',
                borderRadius: 'var(--r, 8px)',
                marginBottom: 12,
                boxShadow: isAllItemsSelected
                  ? '0 2px 10px rgba(99, 102, 241, 0.08)'
                  : '0 2px 8px rgba(0, 0, 0, 0.04)',
                flexWrap: 'wrap',
                transition: 'all 0.15s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                  fontSize: 13,
                }}
              >
                {isAllItemsSelected && currentItems.length > PAGE_SIZE ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: 'var(--accent, #6366f1)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                      }}
                    >
                      <Icon.Check />
                    </div>
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                      All {currentItems.length.toLocaleString()}{' '}
                      {pluralLabel(currentType, currentItems.length)} selected
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>(across all pages)</span>
                  </div>
                ) : isPageFullySelected && currentItems.length > PAGE_SIZE ? (
                  <>
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                      {pageSelectedCount} {pluralLabel(currentType, pageSelectedCount)} selected on
                      this page
                    </span>
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => {
                        const allIds = currentItems.map((i) => i.id);
                        setSelectedIds(allIds);
                      }}
                      style={{ fontWeight: 500 }}
                    >
                      Select all {currentItems.length}{' '}
                      {pluralLabel(currentType, currentItems.length)}
                    </button>
                  </>
                ) : (
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                    {selectedIds.length} {pluralLabel(currentType, selectedIds.length)} selected
                  </span>
                )}

                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => setSelectedIds([])}
                  style={{ color: 'var(--muted)' }}
                >
                  Clear selection
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={working}
                  onClick={() =>
                    void restore(
                      currentType,
                      selectedIds,
                      `${selectedIds.length} ${pluralLabel(currentType, selectedIds.length)}`,
                    )
                  }
                >
                  Restore ({selectedIds.length})
                </button>
                {canHardDelete && (
                  <button
                    type="button"
                    className="btn sm danger"
                    disabled={working}
                    onClick={() => {
                      setPermDelIds(selectedIds);
                      setConfirmParam(PERM_DELETE_CONFIRM[currentType]);
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Icon.Trash /> Permanently delete ({selectedIds.length})
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="table-wrap">
            {tab === 'faces' && (
              <>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 44, paddingLeft: 12 }}>
                        <input
                          type="checkbox"
                          ref={setHeaderCheckbox}
                          checked={isPageFullySelected}
                          onChange={handleTogglePage}
                          aria-label="Select all faces on this page"
                        />
                      </th>
                      <th
                        style={{
                          width: '42%',
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        Face
                      </th>
                      <th
                        style={{
                          width: '16%',
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        Gender
                      </th>
                      <th
                        style={{
                          width: '20%',
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setDeletedSort((prev) => (prev === 'desc' ? 'asc' : 'desc'));
                            setFacePage(0);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            font: 'inherit',
                            color: 'inherit',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            textTransform: 'inherit',
                            fontSize: 'inherit',
                            letterSpacing: 'inherit',
                            fontWeight: 'inherit',
                          }}
                          title={
                            deletedSort === 'desc'
                              ? 'Sorted newest first (click for oldest first)'
                              : 'Sorted oldest first (click for newest first)'
                          }
                        >
                          Deleted {deletedSort === 'desc' ? '↓' : '↑'}
                        </button>
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          paddingRight: 16,
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedFaces.map((f) => {
                      const isSelected = selectedFaceIds.includes(f.id);
                      return (
                        <tr
                          key={f.id}
                          style={{
                            background: isSelected
                              ? 'rgba(var(--primary-rgb, 99, 102, 241), 0.05)'
                              : undefined,
                            borderLeft: isSelected
                              ? '3px solid var(--accent, #6366f1)'
                              : '3px solid transparent',
                          }}
                        >
                          <td style={{ paddingLeft: 12 }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) =>
                                setSelectedFaceIds((prev) =>
                                  e.target.checked
                                    ? [...prev, f.id]
                                    : prev.filter((x) => x !== f.id),
                                )
                              }
                              aria-label={`Select face ${f.label}`}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <Thumb
                                thumbnailUrl={f.thumbnailUrl}
                                label={f.label}
                                type="face"
                                onClick={() =>
                                  setPreviewAsset({
                                    url: f.r2Url || f.thumbnailUrl || '',
                                    label: f.label,
                                    meta: [f.gender, f.continent].filter(Boolean).join(' • '),
                                  })
                                }
                              />
                              <div>
                                <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                                  {f.label}
                                </div>
                                {f.continent && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: 'var(--muted)',
                                      textTransform: 'capitalize',
                                      marginTop: 2,
                                    }}
                                  >
                                    {f.continent}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td style={{ color: 'var(--ink-2)', textTransform: 'capitalize' }}>
                            {f.gender}
                          </td>
                          <td>
                            {f.deletedAt ? (
                              <div>
                                <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 13 }}>
                                  {new Date(f.deletedAt).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                                  {formatRelativeTime(f.deletedAt)}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', paddingRight: 16 }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn sm ghost"
                                disabled={working}
                                onClick={() => void restore('face', [f.id], f.label)}
                              >
                                Restore
                              </button>
                              {canHardDelete && (
                                <button
                                  type="button"
                                  className="btn sm danger"
                                  disabled={working}
                                  onClick={() => {
                                    setPermDelIds([f.id]);
                                    setConfirmParam(PERM_DELETE_CONFIRM.face);
                                  }}
                                >
                                  Permanently delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {Math.ceil(faces.length / PAGE_SIZE) > 1 && (
                  <Pager
                    page={facePage}
                    totalPages={Math.ceil(faces.length / PAGE_SIZE)}
                    onPage={setFacePage}
                    totalItems={faces.length}
                    pageSize={PAGE_SIZE}
                  />
                )}
              </>
            )}

            {tab === 'backgrounds' && (
              <>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 44, paddingLeft: 12 }}>
                        <input
                          type="checkbox"
                          ref={setHeaderCheckbox}
                          checked={isPageFullySelected}
                          onChange={handleTogglePage}
                          aria-label="Select all backgrounds on this page"
                        />
                      </th>
                      <th
                        style={{
                          width: '42%',
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        Background
                      </th>
                      <th
                        style={{
                          width: '16%',
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        Gender
                      </th>
                      <th
                        style={{
                          width: '20%',
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setDeletedSort((prev) => (prev === 'desc' ? 'asc' : 'desc'));
                            setBgPage(0);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            font: 'inherit',
                            color: 'inherit',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            textTransform: 'inherit',
                            fontSize: 'inherit',
                            letterSpacing: 'inherit',
                            fontWeight: 'inherit',
                          }}
                          title={
                            deletedSort === 'desc'
                              ? 'Sorted newest first (click for oldest first)'
                              : 'Sorted oldest first (click for newest first)'
                          }
                        >
                          Deleted {deletedSort === 'desc' ? '↓' : '↑'}
                        </button>
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          paddingRight: 16,
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedBgs.map((b) => {
                      const isSelected = selectedBgIds.includes(b.id);
                      return (
                        <tr
                          key={b.id}
                          style={{
                            background: isSelected
                              ? 'rgba(var(--primary-rgb, 99, 102, 241), 0.05)'
                              : undefined,
                            borderLeft: isSelected
                              ? '3px solid var(--accent, #6366f1)'
                              : '3px solid transparent',
                          }}
                        >
                          <td style={{ paddingLeft: 12 }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) =>
                                setSelectedBgIds((prev) =>
                                  e.target.checked
                                    ? [...prev, b.id]
                                    : prev.filter((x) => x !== b.id),
                                )
                              }
                              aria-label={`Select background ${b.label}`}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <Thumb
                                thumbnailUrl={b.thumbnailUrl}
                                label={b.label}
                                type="background"
                                onClick={() =>
                                  setPreviewAsset({
                                    url: b.r2Url || b.thumbnailUrl || '',
                                    label: b.label,
                                    meta: [b.genderSlug, b.isWhiteBg ? 'White BG' : null, b.scope]
                                      .filter(Boolean)
                                      .join(' • '),
                                  })
                                }
                              />
                              <div>
                                <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                                  {b.label}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: 'var(--muted)',
                                    display: 'flex',
                                    gap: 6,
                                    alignItems: 'center',
                                    marginTop: 2,
                                  }}
                                >
                                  {b.isWhiteBg && <span>White BG</span>}
                                  {b.specialTag && <span>• {b.specialTag}</span>}
                                  {b.tags && b.tags.length > 0 && (
                                    <span>• {b.tags.slice(0, 2).join(', ')}</span>
                                  )}
                                  {b.scope === 'template' && <span>• Template</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={{ color: 'var(--ink-2)', textTransform: 'capitalize' }}>
                            {b.genderSlug ?? 'all'}
                          </td>
                          <td>
                            {b.deletedAt ? (
                              <div>
                                <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 13 }}>
                                  {new Date(b.deletedAt).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                                  {formatRelativeTime(b.deletedAt)}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', paddingRight: 16 }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn sm ghost"
                                disabled={working}
                                onClick={() => void restore('background', [b.id], b.label)}
                              >
                                Restore
                              </button>
                              {canHardDelete && (
                                <button
                                  type="button"
                                  className="btn sm danger"
                                  disabled={working}
                                  onClick={() => {
                                    setPermDelIds([b.id]);
                                    setConfirmParam(PERM_DELETE_CONFIRM.background);
                                  }}
                                >
                                  Permanently delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {Math.ceil(backgrounds.length / PAGE_SIZE) > 1 && (
                  <Pager
                    page={bgPage}
                    totalPages={Math.ceil(backgrounds.length / PAGE_SIZE)}
                    onPage={setBgPage}
                    totalItems={backgrounds.length}
                    pageSize={PAGE_SIZE}
                  />
                )}
              </>
            )}

            {tab === 'poseAssets' && (
              <>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 44, paddingLeft: 12 }}>
                        <input
                          type="checkbox"
                          ref={setHeaderCheckbox}
                          checked={isPageFullySelected}
                          onChange={handleTogglePage}
                          aria-label="Select all pose assets on this page"
                        />
                      </th>
                      <th
                        style={{
                          width: '42%',
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        Pose asset
                      </th>
                      <th
                        style={{
                          width: '16%',
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        Gender
                      </th>
                      <th
                        style={{
                          width: '20%',
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setDeletedSort((prev) => (prev === 'desc' ? 'asc' : 'desc'));
                            setPaPage(0);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            font: 'inherit',
                            color: 'inherit',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            textTransform: 'inherit',
                            fontSize: 'inherit',
                            letterSpacing: 'inherit',
                            fontWeight: 'inherit',
                          }}
                          title={
                            deletedSort === 'desc'
                              ? 'Sorted newest first (click for oldest first)'
                              : 'Sorted oldest first (click for newest first)'
                          }
                        >
                          Deleted {deletedSort === 'desc' ? '↓' : '↑'}
                        </button>
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          paddingRight: 16,
                          textTransform: 'uppercase',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          color: 'var(--muted)',
                          fontWeight: 600,
                        }}
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPas.map((p) => {
                      const isSelected = selectedPaIds.includes(p.id);
                      return (
                        <tr
                          key={p.id}
                          style={{
                            background: isSelected
                              ? 'rgba(var(--primary-rgb, 99, 102, 241), 0.05)'
                              : undefined,
                            borderLeft: isSelected
                              ? '3px solid var(--accent, #6366f1)'
                              : '3px solid transparent',
                          }}
                        >
                          <td style={{ paddingLeft: 12 }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) =>
                                setSelectedPaIds((prev) =>
                                  e.target.checked
                                    ? [...prev, p.id]
                                    : prev.filter((x) => x !== p.id),
                                )
                              }
                              aria-label={`Select pose asset ${p.displayName || p.label}`}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <Thumb
                                thumbnailUrl={p.thumbnailUrl}
                                label={p.label}
                                type="poseAsset"
                                onClick={() =>
                                  setPreviewAsset({
                                    url: p.r2Url || p.thumbnailUrl || '',
                                    label: p.displayName || p.label,
                                    meta: [p.genderSlug, p.shotType, p.poseVariant]
                                      .filter(Boolean)
                                      .join(' • '),
                                  })
                                }
                              />
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                                    {p.displayName || p.label}
                                  </span>
                                  {p.poseVariant && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        padding: '1px 5px',
                                        borderRadius: 4,
                                        background: 'var(--surface-2)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--muted)',
                                      }}
                                    >
                                      {p.poseVariant}
                                    </span>
                                  )}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: 'var(--muted)',
                                    display: 'flex',
                                    gap: 6,
                                    alignItems: 'center',
                                    marginTop: 2,
                                  }}
                                >
                                  {p.displayName && <span>{p.label}</span>}
                                  {p.shotType && <span>• {p.shotType}</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={{ color: 'var(--ink-2)', textTransform: 'capitalize' }}>
                            {p.genderSlug ?? '—'}
                          </td>
                          <td>
                            {p.deletedAt ? (
                              <div>
                                <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 13 }}>
                                  {new Date(p.deletedAt).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                                  {formatRelativeTime(p.deletedAt)}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', paddingRight: 16 }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn sm ghost"
                                disabled={working}
                                onClick={() =>
                                  void restore('poseAsset', [p.id], p.displayName ?? p.label)
                                }
                              >
                                Restore
                              </button>
                              {canHardDelete && (
                                <button
                                  type="button"
                                  className="btn sm danger"
                                  disabled={working}
                                  onClick={() => {
                                    setPermDelIds([p.id]);
                                    setConfirmParam(PERM_DELETE_CONFIRM.poseAsset);
                                  }}
                                >
                                  Permanently delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {Math.ceil(poseAssets.length / PAGE_SIZE) > 1 && (
                  <Pager
                    page={paPage}
                    totalPages={Math.ceil(poseAssets.length / PAGE_SIZE)}
                    onPage={setPaPage}
                    totalItems={poseAssets.length}
                    pageSize={PAGE_SIZE}
                  />
                )}
              </>
            )}
          </div>
        </>
      )}

      {permDel && (
        <div className="modal-overlay" onClick={working ? undefined : closeConfirm}>
          <div
            className="modal confirm"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480 }}
          >
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'rgba(239, 68, 68, 0.1)',
                    color: 'var(--danger)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon.Warning />
                </div>
                <h3 style={{ margin: 0 }}>
                  {permDel.ids.length === 1
                    ? `Permanently delete this ${pluralLabel(permDel.type, 1)}?`
                    : `Permanently delete ${permDel.ids.length} ${pluralLabel(permDel.type, permDel.ids.length)}?`}
                </h3>
              </div>
            </div>
            <div className="modal-body">
              {permDel.ids.length === 1 &&
                (() => {
                  const item = currentItems.find((i) => i.id === permDel.ids[0]);
                  if (!item) return null;
                  const displayLabel =
                    'displayName' in item && item.displayName ? item.displayName : item.label;
                  const previewDims =
                    permDel.type === 'face'
                      ? { width: 72, height: 72 }
                      : permDel.type === 'background'
                        ? { width: 96, height: 68 }
                        : { width: 52, height: 76 };

                  return (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        padding: '12px 14px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r, 8px)',
                        marginBottom: 16,
                      }}
                    >
                      {item.thumbnailUrl ? (
                        // biome-ignore lint/performance/noImgElement: large thumbnail in delete confirmation preview
                        <img
                          src={item.thumbnailUrl}
                          alt={displayLabel}
                          style={{
                            width: previewDims.width,
                            height: previewDims.height,
                            borderRadius: 8,
                            objectFit: 'cover',
                            flexShrink: 0,
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.05)',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: previewDims.width,
                            height: previewDims.height,
                            borderRadius: 8,
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            fontSize: 16,
                            fontWeight: 700,
                            color: 'var(--muted)',
                          }}
                        >
                          {item.label.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            color: 'var(--ink)',
                            fontSize: 15,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {displayLabel}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 12,
                            color: 'var(--muted)',
                            marginTop: 4,
                            flexWrap: 'wrap',
                          }}
                        >
                          {'gender' in item && item.gender && (
                            <span style={{ textTransform: 'capitalize' }}>{item.gender}</span>
                          )}
                          {'genderSlug' in item && item.genderSlug && (
                            <span style={{ textTransform: 'capitalize' }}>{item.genderSlug}</span>
                          )}
                          {'continent' in item && item.continent && <span>• {item.continent}</span>}
                          {'shotType' in item && item.shotType && <span>• {item.shotType}</span>}
                          {'poseVariant' in item && item.poseVariant && (
                            <span>• {item.poseVariant}</span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--muted)',
                            marginTop: 4,
                            fontFamily: 'var(--mono)',
                          }}
                        >
                          ID: {item.id}
                        </div>
                      </div>
                    </div>
                  );
                })()}

              {permDel.ids.length > 1 &&
                (() => {
                  const sampleItems = currentItems
                    .filter((i) => permDel.ids.includes(i.id))
                    .slice(0, 4);
                  const remainingCount = permDel.ids.length - sampleItems.length;

                  return (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '12px 14px',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r, 8px)',
                        marginBottom: 16,
                        flexWrap: 'wrap',
                      }}
                    >
                      {sampleItems.map((item) => (
                        <Thumb
                          key={item.id}
                          thumbnailUrl={item.thumbnailUrl}
                          label={item.label}
                          type={permDel.type}
                        />
                      ))}
                      {remainingCount > 0 && (
                        <div
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            fontSize: 12,
                            fontWeight: 600,
                            color: 'var(--muted)',
                          }}
                        >
                          +{remainingCount} more
                        </div>
                      )}
                    </div>
                  );
                })()}

              <p style={{ margin: 0, lineHeight: 1.5, color: 'var(--ink)' }}>
                {permDel.ids.length === 1
                  ? 'This asset and its files will be permanently removed from R2. This action cannot be undone.'
                  : 'These assets and their files will be permanently removed from R2. This action cannot be undone.'}
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn ghost" disabled={working} onClick={closeConfirm}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={working}
                onClick={async () => {
                  if (!permDel) return;
                  setWorking(true);
                  try {
                    const res = await apiFetch<{ deleted: number }>('/admin/assets/recycle-bin', {
                      method: 'DELETE',
                      body: JSON.stringify(permDel),
                    });
                    const count = res?.deleted ?? permDel.ids.length;
                    toast({
                      title: `${count} ${pluralLabel(permDel.type, count)} permanently deleted`,
                    });
                    closeConfirm();
                    void load();
                  } catch (e) {
                    toast({
                      kind: 'error',
                      title: 'Delete failed',
                      body: apiErrorMessage(
                        e,
                        'Some or all selected assets could not be permanently deleted. Refreshing table to show current status.',
                      ),
                    });
                    void load();
                  } finally {
                    setWorking(false);
                  }
                }}
              >
                {working
                  ? 'Deleting…'
                  : permDel.ids.length === 1
                    ? 'Permanently delete'
                    : `Permanently delete ${permDel.ids.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewAsset && (
        <div
          className="modal-overlay"
          onClick={() => setPreviewAsset(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r, 12px)',
              padding: 16,
              maxWidth: 'min(90vw, 680px)',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.45)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink)' }}>
                  {previewAsset.label}
                </h3>
                {previewAsset.meta && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--muted)',
                      marginTop: 2,
                      textTransform: 'capitalize',
                    }}
                  >
                    {previewAsset.meta}
                  </div>
                )}
              </div>
              <button type="button" className="btn ghost sm" onClick={() => setPreviewAsset(null)}>
                Close
              </button>
            </div>

            <div
              style={{
                overflow: 'hidden',
                borderRadius: 8,
                background: 'var(--surface-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                maxHeight: 'calc(90vh - 120px)',
              }}
            >
              {/* biome-ignore lint/performance/noImgElement: lightbox full preview */}
              <img
                src={previewAsset.url}
                alt={previewAsset.label}
                style={{
                  maxWidth: '100%',
                  maxHeight: 'calc(90vh - 120px)',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
