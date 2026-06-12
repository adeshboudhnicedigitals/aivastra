import { useCallback, useEffect, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { EditPoseAssetModal } from '../../components/EditPoseAssetModal';
import { Icon } from '../../components/Icons';
import { Pager } from '../../components/Pager';
import { PoseUploadModal } from '../../components/PoseUploadModal';
import { apiFetch, getToken } from '../../lib/data';
import type { GenderSlug, ModelPoseAsset, WorkflowOption } from '../../types';
import { useAssetsContext } from './AssetsContext';

const GENDER_TABS = [
  { k: 'all' as const, l: 'All' },
  { k: 'men' as const, l: 'Men' },
  { k: 'women' as const, l: 'Women' },
  { k: 'boys' as const, l: 'Boys' },
  { k: 'girls' as const, l: 'Girls' },
];

const PA_PAGE_SIZE = 50;

export function PoseAssetsTab() {
  const {
    genderFilter,
    setGenderFilter,
    faces,
    setFaces,
    allBackgrounds,
    setAllBackgrounds,
    garmentTypes,
    workflows,
    setWorkflows,
    loading,
    setLoading,
    storagePublicUrl,
    setPreviewUrl,
    toast,
  } = useAssetsContext();

  const [poseAssets, setPoseAssets] = useState<ModelPoseAsset[]>([]);
  const [paSearch, setPaSearch] = useState('');
  const [paFilterFace, setPaFilterFace] = useState('');
  const [paFilterBg, setPaFilterBg] = useState('');
  const [paFilterWorkflow, setPaFilterWorkflow] = useState('');
  const [paFilterPose, setPaFilterPose] = useState('');
  const [paSortKey, setPaSortKey] = useState<'label' | 'createdAt'>('label');
  const [paSortDir, setPaSortDir] = useState<'asc' | 'desc'>('asc');
  const [paPage, setPaPage] = useState(1);
  const [selectedPoseAssetIds, setSelectedPoseAssetIds] = useState<string[]>([]);
  const [confirmBulkDeletePoseAssetIds, setConfirmBulkDeletePoseAssetIds] = useState<string[]>([]);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [confirmDeletePoseAssetId, setConfirmDeletePoseAssetId] = useState<string | null>(null);
  const [showPoseAssetUpload, setShowPoseAssetUpload] = useState(false);
  const [editingPoseAsset, setEditingPoseAsset] = useState<ModelPoseAsset | null>(null);
  const [mappingPoseAsset, setMappingPoseAsset] = useState<ModelPoseAsset | null>(null);
  const [existingMappings, setExistingMappings] = useState<
    {
      id: string;
      garmentTypeId: string;
      garmentTypeLabel: string | null;
      faceId: string;
      faceLabel: string | null;
      backgroundId: string;
      backgroundLabel: string | null;
      workflowTemplateId: string;
      workflowLabel: string | null;
      isActive: boolean;
      createdAt: string;
    }[]
  >([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [showBulkMap, setShowBulkMap] = useState(false);
  const [bulkMapGarmentTypeIds, setBulkMapGarmentTypeIds] = useState<Set<string>>(new Set());
  const [bulkMapping, setBulkMapping] = useState(false);
  const [bulkMapProgress, setBulkMapProgress] = useState(0);
  const [bulkMapTotal, setBulkMapTotal] = useState(0);

  // Bulk import state
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkImportGender, setBulkImportGender] = useState<GenderSlug>('men');
  const [bulkImportWorkflowId, setBulkImportWorkflowId] = useState('');
  const [bulkImportFile, setBulkImportFile] = useState<File | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState(0);

  const loadPoseAssets = useCallback(async () => {
    setLoading(true);
    try {
      const [assetsRes, wfRes] = await Promise.all([
        apiFetch<{ items: ModelPoseAsset[] }>('/admin/assets/pose-assets'),
        apiFetch<WorkflowOption[]>('/admin/workflows'),
      ]);
      setPoseAssets(assetsRes.items);
      setWorkflows(wfRes);
    } catch {
      toast({ kind: 'error', title: 'Failed to load pose assets' });
    } finally {
      setLoading(false);
    }
  }, [toast, setLoading, setWorkflows]);

  useEffect(() => {
    void loadPoseAssets();
  }, [loadPoseAssets]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadPoseAssets();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadPoseAssets]);

  const doBulkDeletePoseAssets = async () => {
    if (deleteConfirmText !== 'move to recycle bin') return;
    const ids = confirmBulkDeletePoseAssetIds;
    setConfirmBulkDeletePoseAssetIds([]);
    setDeleteConfirmText('');
    if (ids.length === 0) return;
    try {
      const res = await apiFetch<{ deleted: number }>('/admin/assets/pose-assets', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      setPoseAssets((prev) => prev.filter((a) => !ids.includes(a.id)));
      setSelectedPoseAssetIds((prev) => prev.filter((id) => !ids.includes(id)));
      toast({
        title: `${res.deleted} pose asset${res.deleted !== 1 ? 's' : ''} moved to recycle bin`,
      });
    } catch {
      toast({ kind: 'error', title: 'Bulk delete failed' });
    }
  };

  // Derived data
  const filteredPoseAssets = poseAssets
    .filter((a) => {
      if (genderFilter !== 'all' && a.genderSlug !== genderFilter) return false;
      if (paFilterFace && a.faceId !== paFilterFace) return false;
      if (paFilterBg && a.backgroundId !== paFilterBg) return false;
      if (paFilterWorkflow && a.workflowTemplateId !== paFilterWorkflow) return false;
      if (paFilterPose && a.poseVariant !== paFilterPose) return false;
      if (paSearch) {
        const q = paSearch.toLowerCase();
        if (
          !a.label.toLowerCase().includes(q) &&
          !(a.displayName?.toLowerCase().includes(q) ?? false)
        )
          return false;
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (paSortKey === 'label') cmp = a.label.localeCompare(b.label);
      else cmp = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      return paSortDir === 'asc' ? cmp : -cmp;
    });

  const paTotalPages = Math.max(1, Math.ceil(filteredPoseAssets.length / PA_PAGE_SIZE));
  const paClampedPage = Math.min(paPage, paTotalPages);
  const pagedPoseAssets = filteredPoseAssets.slice(
    (paClampedPage - 1) * PA_PAGE_SIZE,
    paClampedPage * PA_PAGE_SIZE,
  );

  const genderSlicedAssets = poseAssets.filter(
    (a) => genderFilter === 'all' || a.genderSlug === genderFilter,
  );
  const paFaceOptions = faces.filter((f) => genderSlicedAssets.some((a) => a.faceId === f.id));
  const paBgOptions = allBackgrounds.filter((b) =>
    genderSlicedAssets.some((a) => a.backgroundId === b.id),
  );
  const paWorkflowOptions = workflows.filter((w) =>
    genderSlicedAssets.some((a) => a.workflowTemplateId === w.id),
  );
  const paPoseVariants = Array.from(
    new Set(genderSlicedAssets.map((a) => a.poseVariant).filter(Boolean) as string[]),
  ).sort();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pose Assets</h1>
          <p className="lede">
            Centralised pose image assets. Delete here removes R2 objects. Remove all garment-type
            mappings first.
          </p>
        </div>
        <div className="head-tools">
          <button className="btn ghost" onClick={() => setShowPoseAssetUpload(true)}>
            <Icon.Add /> Upload pose
          </button>
          <button
            className="btn"
            onClick={() => {
              setBulkImportGender('men');
              setBulkImportWorkflowId('');
              setBulkImportFile(null);
              setShowBulkImport(true);
            }}
          >
            <Icon.Upload /> Bulk import ZIP
          </button>
        </div>
      </div>

      <div className="tabs" style={{ marginTop: -8 }}>
        {GENDER_TABS.map((t) => (
          <button
            key={t.k}
            className={`tab ${genderFilter === t.k ? 'active' : ''}`}
            onClick={() => {
              setGenderFilter(t.k);
              setPaFilterFace('');
              setPaFilterBg('');
              setPaFilterWorkflow('');
              setPaFilterPose('');
              setPaSearch('');
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {!loading && (
        <>
          {/* Filter bar */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              marginTop: 8,
              marginBottom: 4,
              flexWrap: 'wrap',
            }}
          >
            <input
              className="input"
              style={{ minWidth: 160, maxWidth: 220 }}
              placeholder="Search label…"
              value={paSearch}
              onChange={(e) => setPaSearch(e.target.value)}
            />
            <select
              className="select"
              style={{ minWidth: 140 }}
              value={paFilterFace}
              onChange={(e) => setPaFilterFace(e.target.value)}
            >
              <option value="">All faces</option>
              {paFaceOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  [{f.gender}] {f.label}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ minWidth: 140 }}
              value={paFilterBg}
              onChange={(e) => setPaFilterBg(e.target.value)}
            >
              <option value="">All backgrounds</option>
              {paBgOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ minWidth: 140 }}
              value={paFilterWorkflow}
              onChange={(e) => setPaFilterWorkflow(e.target.value)}
            >
              <option value="">All workflows</option>
              {paWorkflowOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ minWidth: 130 }}
              value={paFilterPose}
              onChange={(e) => setPaFilterPose(e.target.value)}
            >
              <option value="">All poses</option>
              {paPoseVariants.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ minWidth: 110 }}
              value={paSortKey}
              onChange={(e) => setPaSortKey(e.target.value as 'label' | 'createdAt')}
            >
              <option value="label">Name</option>
              <option value="createdAt">Date added</option>
            </select>
            <button
              className="btn sm ghost"
              title={paSortDir === 'asc' ? 'Ascending' : 'Descending'}
              onClick={() => setPaSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            >
              {paSortDir === 'asc' ? '↑' : '↓'}
            </button>
            {(paSearch || paFilterFace || paFilterBg || paFilterWorkflow || paFilterPose) && (
              <button
                className="btn sm ghost"
                onClick={() => {
                  setPaSearch('');
                  setPaFilterFace('');
                  setPaFilterBg('');
                  setPaFilterWorkflow('');
                  setPaFilterPose('');
                }}
              >
                Clear
              </button>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
              flexWrap: 'wrap',
            }}
          >
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              {filteredPoseAssets.length} asset{filteredPoseAssets.length !== 1 ? 's' : ''}
              {paTotalPages > 1 && ` · page ${paClampedPage}/${paTotalPages}`}
              {genderFilter !== 'all' && ` · ${poseAssets.length} total`}
            </p>
            {filteredPoseAssets.length > 0 && (
              <button
                className="btn sm ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  const allIds = filteredPoseAssets.map((a) => a.id);
                  const allSelected = allIds.every((id) => selectedPoseAssetIds.includes(id));
                  setSelectedPoseAssetIds(allSelected ? [] : allIds);
                }}
              >
                {filteredPoseAssets.length > 0 &&
                filteredPoseAssets.every((a) => selectedPoseAssetIds.includes(a.id))
                  ? 'Deselect all'
                  : 'Select all'}
              </button>
            )}
            {selectedPoseAssetIds.length > 0 && (
              <>
                <button
                  className="btn sm"
                  onClick={() => {
                    setBulkMapGarmentTypeIds(new Set());
                    setShowBulkMap(true);
                  }}
                >
                  <Icon.Add /> Map selected ({selectedPoseAssetIds.length})
                </button>
                <button
                  className="btn sm danger"
                  onClick={() => setConfirmBulkDeletePoseAssetIds([...selectedPoseAssetIds])}
                >
                  <Icon.Trash /> Move to recycle bin ({selectedPoseAssetIds.length})
                </button>
              </>
            )}
          </div>

          {filteredPoseAssets.length === 0 ? (
            <p style={{ color: 'var(--muted)', marginTop: 24 }}>No pose assets for this gender.</p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 12,
                marginTop: 12,
              }}
            >
              {pagedPoseAssets.map((a) => (
                <div
                  key={a.id}
                  className="card"
                  style={{
                    padding: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    outline: selectedPoseAssetIds.includes(a.id)
                      ? '2px solid var(--pink)'
                      : undefined,
                  }}
                >
                  <div
                    style={{
                      background: 'var(--surface2, #1a1a1a)',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      aspectRatio: '3/4',
                      cursor: 'zoom-in',
                      position: 'relative',
                    }}
                    onClick={() => setPreviewUrl(`${storagePublicUrl}/${a.r2Key}`)}
                  >
                    <AssetThumb
                      thumbnailKey={a.thumbnailKey}
                      r2Key={a.r2Key}
                      label={a.label}
                      storageBase={storagePublicUrl}
                      onPreview={setPreviewUrl}
                      w={160}
                      h={210}
                    />
                    <input
                      type="checkbox"
                      checked={selectedPoseAssetIds.includes(a.id)}
                      onChange={(e) =>
                        setSelectedPoseAssetIds((prev) =>
                          e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id),
                        )
                      }
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute',
                        top: 6,
                        left: 6,
                        width: 15,
                        height: 15,
                        cursor: 'pointer',
                        accentColor: 'var(--pink)',
                      }}
                    />
                  </div>
                  <div style={{ padding: '8px 8px 10px' }}>
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={a.displayName ?? a.label}
                    >
                      {a.displayName ?? a.label}
                    </p>
                    {a.genderSlug && (
                      <span className="badge dot accent" style={{ fontSize: 10, marginTop: 4 }}>
                        {a.genderSlug}
                      </span>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
                      {a.faceId && (
                        <span className="badge dot" style={{ fontSize: 10 }} title="Face">
                          {faces.find((f) => f.id === a.faceId)?.label ?? '?'}
                        </span>
                      )}
                      {a.backgroundId && (
                        <span className="badge dot" style={{ fontSize: 10 }} title="Background">
                          {allBackgrounds.find((b) => b.id === a.backgroundId)?.label ?? '?'}
                        </span>
                      )}
                      {a.workflowTemplateId && (
                        <span
                          className="badge dot accent"
                          style={{ fontSize: 10 }}
                          title="Workflow"
                        >
                          {workflows.find((w) => w.id === a.workflowTemplateId)?.label ?? '?'}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                      <button
                        className="btn ghost"
                        style={{ flex: 1, fontSize: 10, padding: '3px 0' }}
                        onClick={() => setEditingPoseAsset(a)}
                      >
                        <Icon.Edit /> Edit
                      </button>
                      <button
                        className="btn ghost"
                        style={{ flex: 1, fontSize: 10, padding: '3px 0' }}
                        onClick={async () => {
                          setMappingPoseAsset(a);
                          setExistingMappings([]);
                          setLoadingMappings(true);
                          try {
                            const res = await apiFetch<{ items: typeof existingMappings }>(
                              `/admin/assets/pose-assets/${a.id}/mappings`,
                            );
                            setExistingMappings(res.items);
                          } catch {
                            /* ignore */
                          } finally {
                            setLoadingMappings(false);
                          }
                        }}
                      >
                        <Icon.Eye /> Mappings
                      </button>
                    </div>
                    <button
                      className="btn danger"
                      style={{ width: '100%', marginTop: 4, fontSize: 11, padding: '3px 0' }}
                      onClick={() => setConfirmDeletePoseAssetId(a.id)}
                    >
                      <Icon.Trash /> Move to recycle bin
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {paTotalPages > 1 && (
            <Pager
              page={paClampedPage - 1}
              totalPages={paTotalPages}
              onPage={(n) => setPaPage(n + 1)}
              totalItems={filteredPoseAssets.length}
              pageSize={PA_PAGE_SIZE}
            />
          )}
        </>
      )}

      {/* ── Modals ── */}

      {confirmDeletePoseAssetId && (
        <div className="modal-overlay" onClick={() => setConfirmDeletePoseAssetId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Move to recycle bin</h3>
            </div>
            <div className="modal-body">
              <p>Move this pose asset to the recycle bin? You can restore it later.</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDeletePoseAssetId(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  const id = confirmDeletePoseAssetId;
                  setConfirmDeletePoseAssetId(null);
                  try {
                    await apiFetch(`/admin/assets/pose-assets/${id}?force=true`, {
                      method: 'DELETE',
                    });
                    setPoseAssets((prev) => prev.filter((a) => a.id !== id));
                    toast({ title: 'Pose asset moved to recycle bin' });
                  } catch (e) {
                    toast({ kind: 'error', title: 'Delete failed', body: (e as Error).message });
                  }
                }}
              >
                <Icon.Trash /> Move to recycle bin
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBulkDeletePoseAssetIds.length > 0 && (
        <div className="modal-overlay" onClick={() => setConfirmBulkDeletePoseAssetIds([])}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Move {confirmBulkDeletePoseAssetIds.length} pose assets to recycle bin</h3>
            </div>
            <div className="modal-body">
              <p>
                Move <strong>{confirmBulkDeletePoseAssetIds.length} selected pose assets</strong> to
                the recycle bin? You can restore them later.
              </p>
              <div className="field" style={{ marginTop: 16 }}>
                <label style={{ fontSize: 13 }}>
                  Type{' '}
                  <strong style={{ fontFamily: 'monospace', color: 'var(--danger)' }}>
                    move to recycle bin
                  </strong>{' '}
                  to confirm
                </label>
                <input
                  className="input"
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="move to recycle bin"
                />
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => {
                  setConfirmBulkDeletePoseAssetIds([]);
                  setDeleteConfirmText('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={doBulkDeletePoseAssets}
                disabled={deleteConfirmText !== 'move to recycle bin'}
              >
                <Icon.Trash /> Move to recycle bin ({confirmBulkDeletePoseAssetIds.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Map pose asset mappings view */}
      {mappingPoseAsset && (
        <div className="modal-overlay" onClick={() => setMappingPoseAsset(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Pose mappings</h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                {mappingPoseAsset.label}
              </p>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div>
                <label className="field-label" style={{ marginBottom: 6, display: 'block' }}>
                  Existing mappings
                </label>
                {loadingMappings ? (
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</p>
                ) : existingMappings.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>None yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {existingMappings.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 10px',
                          background: 'var(--subtle)',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>
                            {m.garmentTypeLabel ?? m.garmentTypeId}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                            {m.faceLabel && <span className="badge dot">{m.faceLabel}</span>}
                            {m.backgroundLabel && (
                              <span className="badge dot">{m.backgroundLabel}</span>
                            )}
                            {m.workflowLabel && (
                              <span className="badge dot accent">{m.workflowLabel}</span>
                            )}
                          </div>
                        </div>
                        <button
                          className="btn sm danger ghost"
                          style={{ flexShrink: 0, padding: '2px 6px', fontSize: 11 }}
                          onClick={async () => {
                            try {
                              await apiFetch(`/admin/assets/poses/${m.id}`, { method: 'DELETE' });
                              setExistingMappings((prev) => prev.filter((x) => x.id !== m.id));
                            } catch (err: unknown) {
                              toast({
                                kind: 'error',
                                title: 'Delete mapping failed',
                                body: err instanceof Error ? err.message : String(err),
                              });
                            }
                          }}
                        >
                          <Icon.Trash />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setMappingPoseAsset(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk map selected pose assets */}
      {showBulkMap &&
        (() => {
          const genderOrder: GenderSlug[] = ['men', 'women', 'boys', 'girls'];
          const byGender = genderOrder
            .map((g) => ({ gender: g, types: garmentTypes.filter((t) => t.genderSlug === g) }))
            .filter((group) => group.types.length > 0);

          const toggleId = (id: string) => {
            setBulkMapGarmentTypeIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          };

          const toggleGender = (ids: string[]) => {
            const allChecked = ids.every((id) => bulkMapGarmentTypeIds.has(id));
            setBulkMapGarmentTypeIds((prev) => {
              const next = new Set(prev);
              if (allChecked)
                ids.forEach((id) => {
                  next.delete(id);
                });
              else
                ids.forEach((id) => {
                  next.add(id);
                });
              return next;
            });
          };

          return (
            <div className="modal-overlay" onClick={() => !bulkMapping && setShowBulkMap(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
                <div className="modal-head">
                  <h3>Bulk map poses</h3>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    Map {selectedPoseAssetIds.length} selected pose
                    {selectedPoseAssetIds.length !== 1 ? 's' : ''} to one or more subcategories
                  </p>
                </div>
                <div
                  className="modal-body"
                  style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                >
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                    Each pose uses its own stored face / background / workflow. Select all
                    subcategories you want to map to — duplicates are skipped automatically.
                  </p>
                  {bulkMapping && (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 12,
                          color: 'var(--muted)',
                          marginBottom: 6,
                        }}
                      >
                        <span>Mapping…</span>
                        <span>
                          {bulkMapProgress} / {bulkMapTotal}
                        </span>
                      </div>
                      <div
                        style={{
                          height: 6,
                          background: 'var(--border)',
                          borderRadius: 3,
                          overflow: 'hidden',
                          width: '100%',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            background: 'var(--accent)',
                            borderRadius: 3,
                            width:
                              bulkMapTotal > 0
                                ? `${Math.round((bulkMapProgress / bulkMapTotal) * 100)}%`
                                : '0%',
                            transition: 'width 0.15s ease',
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {byGender.map(({ gender, types }) => {
                      const typeIds = types.map((t) => t.id);
                      const allChecked = typeIds.every((id) => bulkMapGarmentTypeIds.has(id));
                      const someChecked = typeIds.some((id) => bulkMapGarmentTypeIds.has(id));
                      return (
                        <div key={gender}>
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              cursor: bulkMapping ? 'default' : 'pointer',
                              fontSize: 11,
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              letterSpacing: '0.08em',
                              color: 'var(--muted)',
                              marginBottom: 6,
                              userSelect: 'none',
                            }}
                          >
                            <input
                              type="checkbox"
                              disabled={bulkMapping}
                              checked={allChecked}
                              ref={(el) => {
                                if (el) el.indeterminate = someChecked && !allChecked;
                              }}
                              onChange={() => !bulkMapping && toggleGender(typeIds)}
                            />
                            {gender.charAt(0).toUpperCase() + gender.slice(1)}
                          </label>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                              gap: '4px 12px',
                              paddingLeft: 4,
                            }}
                          >
                            {types.map((gt) => (
                              <label
                                key={gt.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  cursor: bulkMapping ? 'default' : 'pointer',
                                  fontSize: 13,
                                  padding: '4px 0',
                                  userSelect: 'none',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  disabled={bulkMapping}
                                  checked={bulkMapGarmentTypeIds.has(gt.id)}
                                  onChange={() => !bulkMapping && toggleId(gt.id)}
                                />
                                {gt.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {bulkMapGarmentTypeIds.size > 0 && (
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
                      {bulkMapGarmentTypeIds.size} subcategor
                      {bulkMapGarmentTypeIds.size === 1 ? 'y' : 'ies'} selected →{' '}
                      {selectedPoseAssetIds.length * bulkMapGarmentTypeIds.size} mappings to create
                    </p>
                  )}
                </div>
                <div className="modal-foot">
                  <button
                    className="btn ghost"
                    disabled={bulkMapping}
                    onClick={() => setShowBulkMap(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn"
                    disabled={bulkMapping || bulkMapGarmentTypeIds.size === 0}
                    onClick={async () => {
                      if (bulkMapGarmentTypeIds.size === 0) return;
                      setBulkMapping(true);
                      setBulkMapProgress(0);
                      setBulkMapTotal(selectedPoseAssetIds.length * bulkMapGarmentTypeIds.size);
                      try {
                        const res = await apiFetch<{
                          created: number;
                          skipped: number;
                          errors: string[];
                        }>('/admin/assets/pose-assets/bulk-map', {
                          method: 'POST',
                          body: JSON.stringify({
                            assetIds: selectedPoseAssetIds,
                            garmentTypeIds: [...bulkMapGarmentTypeIds],
                          }),
                        });
                        setBulkMapProgress(
                          selectedPoseAssetIds.length * bulkMapGarmentTypeIds.size,
                        );
                        const parts = [];
                        if (res.created > 0) parts.push(`mapped ${res.created}`);
                        if (res.skipped > 0) parts.push(`skipped ${res.skipped} already mapped`);
                        if (res.errors.length > 0) parts.push(`${res.errors.length} errors`);
                        toast({
                          kind: res.errors.length > 0 ? 'error' : undefined,
                          title: parts.join(', ') || 'nothing to map',
                        });
                      } catch {
                        toast({ kind: 'error', title: 'Bulk map failed' });
                      }
                      setBulkMapping(false);
                      setShowBulkMap(false);
                      setSelectedPoseAssetIds([]);
                      setBulkMapGarmentTypeIds(new Set());
                    }}
                  >
                    {bulkMapping
                      ? 'Mapping…'
                      : `Map to ${bulkMapGarmentTypeIds.size} subcategor${bulkMapGarmentTypeIds.size === 1 ? 'y' : 'ies'}`}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Bulk import ZIP */}
      {showBulkImport && (
        <div className="modal-overlay" onClick={() => !bulkImporting && setShowBulkImport(false)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Bulk import ZIP</h3>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  ZIP file
                </label>
                <input
                  type="file"
                  accept=".zip"
                  style={{ width: '100%' }}
                  onChange={(e) => setBulkImportFile(e.target.files?.[0] ?? null)}
                />
                {bulkImportFile && (
                  <p style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)' }}>
                    {bulkImportFile.name} ({(bulkImportFile.size / 1024 / 1024).toFixed(1)} MB)
                  </p>
                )}
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Gender</label>
                <select
                  className="input"
                  value={bulkImportGender}
                  onChange={(e) => setBulkImportGender(e.target.value as GenderSlug)}
                  disabled={bulkImporting}
                >
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                  <option value="boys">Boys</option>
                  <option value="girls">Girls</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  Workflow template{' '}
                  <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span>
                </label>
                <select
                  className="input"
                  value={bulkImportWorkflowId}
                  onChange={(e) => setBulkImportWorkflowId(e.target.value)}
                  disabled={bulkImporting}
                >
                  <option value="">— none —</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                ZIP must contain <code>backgrounds/</code>, <code>faces/</code>, and{' '}
                <code>poses/</code> folders. Pose filenames: <code>faceXXbgYposeZZ.png</code>
              </p>
              {bulkImporting && (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      marginBottom: 4,
                      color: 'var(--muted)',
                    }}
                  >
                    <span>{bulkImportProgress < 100 ? 'Uploading…' : 'Processing ZIP…'}</span>
                    <span>{bulkImportProgress}%</span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: 'var(--border)',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${bulkImportProgress}%`,
                        background: 'var(--accent, #6366f1)',
                        borderRadius: 3,
                        transition: 'width 0.2s ease',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                disabled={bulkImporting}
                onClick={() => setShowBulkImport(false)}
              >
                Cancel
              </button>
              <button
                className="btn"
                disabled={bulkImporting || !bulkImportFile}
                onClick={() => {
                  if (!bulkImportFile) return;
                  setBulkImporting(true);
                  setBulkImportProgress(0);
                  const fd = new FormData();
                  if (bulkImportWorkflowId) fd.append('workflowTemplateId', bulkImportWorkflowId);
                  fd.append('genderSlug', bulkImportGender);
                  fd.append('zip', bulkImportFile);
                  const tok = getToken();
                  const xhr = new XMLHttpRequest();
                  xhr.open('POST', '/admin/assets/bulk-import');
                  if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);
                  xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable)
                      setBulkImportProgress(Math.round((e.loaded / e.total) * 100));
                  };
                  xhr.onload = async () => {
                    setBulkImporting(false);
                    if (xhr.status >= 200 && xhr.status < 300) {
                      const result = JSON.parse(xhr.responseText) as {
                        created: { faces: number; backgrounds: number; poses: number };
                        errors: string[];
                      };
                      setShowBulkImport(false);
                      setBulkImportFile(null);
                      setBulkImportProgress(0);
                      const { faces: fCount, backgrounds: bCount, poses: pCount } = result.created;
                      toast({
                        title: `Imported ${fCount} faces, ${bCount} backgrounds, ${pCount} poses`,
                        body:
                          fCount + bCount + pCount === 0
                            ? 'All items already exist — nothing new to import.'
                            : undefined,
                      });
                      if (result.errors.length > 0) {
                        console.error('Bulk import errors:', result.errors);
                        toast({
                          kind: 'error',
                          title: `${result.errors.length} item(s) failed`,
                          body: result.errors[0],
                        });
                      }
                      await Promise.all([
                        loadPoseAssets(),
                        apiFetch<{ items: typeof faces }>('/admin/assets/faces')
                          .then((r) => setFaces(r.items))
                          .catch(() => {}),
                        apiFetch<{ items: typeof allBackgrounds }>('/admin/assets/backgrounds')
                          .then((r) => setAllBackgrounds(r.items))
                          .catch(() => {}),
                      ]);
                    } else {
                      const err = JSON.parse(xhr.responseText) as { error?: { message?: string } };
                      toast({
                        kind: 'error',
                        title: 'Bulk import failed',
                        body: err.error?.message ?? xhr.statusText,
                      });
                    }
                  };
                  xhr.onerror = () => {
                    setBulkImporting(false);
                    toast({ kind: 'error', title: 'Bulk import failed', body: 'Network error' });
                  };
                  xhr.send(fd);
                }}
              >
                {bulkImporting ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPoseAssetUpload && (
        <PoseUploadModal
          garmentTypeGenderSlug={genderFilter !== 'all' ? genderFilter : 'men'}
          faces={faces}
          backgrounds={allBackgrounds}
          onDone={(_added) => {
            setShowPoseAssetUpload(false);
            void loadPoseAssets();
            apiFetch<{ items: typeof faces }>('/admin/assets/faces')
              .then((r) => setFaces(r.items))
              .catch(() => {});
            apiFetch<{ items: typeof allBackgrounds }>('/admin/assets/backgrounds')
              .then((r) => setAllBackgrounds(r.items))
              .catch(() => {});
          }}
          onClose={() => setShowPoseAssetUpload(false)}
          toast={toast}
        />
      )}

      {editingPoseAsset && (
        <EditPoseAssetModal
          asset={editingPoseAsset}
          faces={faces}
          backgrounds={allBackgrounds}
          workflows={workflows}
          onSaved={(updated) => {
            setPoseAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
          }}
          onClose={() => setEditingPoseAsset(null)}
          toast={toast}
        />
      )}
    </>
  );
}
