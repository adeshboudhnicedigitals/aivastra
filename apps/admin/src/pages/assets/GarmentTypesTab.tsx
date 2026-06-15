import { useCallback, useEffect, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { EditPoseModal } from '../../components/EditPoseModal';
import { Icon } from '../../components/Icons';
import { Pager } from '../../components/Pager';
import { Switch } from '../../components/Switch';
import { apiFetch } from '../../lib/data';
import { makeThumbnail } from '../../lib/thumbnail';
import type { GarmentType, GenderSlug, ModelPose, WorkflowOption } from '../../types';
import { useAssetsContext } from './AssetsContext';

type SubView = { kind: 'list' } | { kind: 'garment-type'; sub: GarmentType };
type ConfirmDeleteGT =
  | { type: 'garment-type'; id: string; label: string }
  | { type: 'pose'; id: string; label: string };

const GENDER_TABS = [
  { k: 'all' as const, l: 'All' },
  { k: 'men' as const, l: 'Men' },
  { k: 'women' as const, l: 'Women' },
  { k: 'boys' as const, l: 'Boys' },
  { k: 'girls' as const, l: 'Girls' },
];

const POSE_PAGE_SIZE = 50;

export function GarmentTypesTab() {
  const {
    genderFilter,
    setGenderFilter,
    faces,
    allBackgrounds,
    garmentTypes,
    setGarmentTypes,
    loadGarmentTypes,
    workflows,
    setWorkflows,
    catalogItems,
    loading,
    setLoading,
    storagePublicUrl,
    setPreviewUrl,
    toast,
  } = useAssetsContext();

  const [subView, setSubView] = useState<SubView>({ kind: 'list' });
  const [poses, setPoses] = useState<ModelPose[]>([]);
  const [filterFace, setFilterFace] = useState('');
  const [filterBg, setFilterBg] = useState('');
  const [filterPose, setFilterPose] = useState('');
  const [poseSearch, setPoseSearch] = useState('');
  const [poseSortKey, setPoseSortKey] = useState<'label' | 'sortOrder' | 'createdAt'>('label');
  const [poseSortDir, setPoseSortDir] = useState<'asc' | 'desc'>('asc');
  const [posePage, setPosePage] = useState(1);
  const [selectedPoseIds, setSelectedPoseIds] = useState<string[]>([]);
  const [confirmBulkDeletePoseIds, setConfirmBulkDeletePoseIds] = useState<string[]>([]);
  const [bulkWorkflowId, setBulkWorkflowId] = useState('');
  const [bulkWorkflowing, setBulkWorkflowing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteGT | null>(null);
  const [editingPose, setEditingPose] = useState<ModelPose | null>(null);

  // Add garment type modal
  const [showSubcatModal, setShowSubcatModal] = useState(false);
  const [subcatForm, setSubcatForm] = useState({
    slug: '',
    label: '',
    genderSlug: 'men' as GenderSlug,
    requiresLowerUpload: false,
  });
  const [subcatSaving, setSubcatSaving] = useState(false);
  const [subcatImageFile, setSubcatImageFile] = useState<File | null>(null);

  // Edit garment type modal
  const [editingSubcat, setEditingSubcat] = useState<GarmentType | null>(null);
  const [editSubcatImageFile, setEditSubcatImageFile] = useState<File | null>(null);
  const [editSubcatSaving, setEditSubcatSaving] = useState(false);
  const [editSubcatLabel, setEditSubcatLabel] = useState('');
  const [editSubcatRequiresLowerUpload, setEditSubcatRequiresLowerUpload] = useState(false);
  const [editSubcatDefaultLowerId, setEditSubcatDefaultLowerId] = useState<string>('');
  const [editSubcatDefaultShoeId, setEditSubcatDefaultShoeId] = useState<string>('');

  const loadGarmentTypeAssets = useCallback(
    async (garmentTypeId: string) => {
      setLoading(true);
      try {
        const [posesRes, wfRes] = await Promise.all([
          apiFetch<{ items: ModelPose[] }>(`/admin/assets/poses?garmentTypeId=${garmentTypeId}`),
          apiFetch<WorkflowOption[]>('/admin/workflows'),
        ]);
        setPoses(posesRes.items);
        setWorkflows(wfRes);
      } catch {
        toast({ kind: 'error', title: 'Failed to load assets' });
      } finally {
        setLoading(false);
      }
    },
    [toast, setLoading, setWorkflows],
  );

  useEffect(() => {
    if (subView.kind === 'list') {
      void loadGarmentTypes();
    } else {
      void loadGarmentTypeAssets(subView.sub.id);
    }
  }, [subView, loadGarmentTypes, loadGarmentTypeAssets]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (subView.kind === 'list') void loadGarmentTypes();
      else void loadGarmentTypeAssets(subView.sub.id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [subView, loadGarmentTypes, loadGarmentTypeAssets]);

  const togglePose = async (id: string) => {
    const item = poses.find((p) => p.id === id);
    if (!item) return;
    const next = !item.isActive;
    setPoses((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: next } : p)));
    try {
      await apiFetch(`/admin/assets/poses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      toast({ title: `${item.label} ${item.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setPoses((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: item.isActive } : p)));
      toast({ kind: 'error', title: 'Failed to update pose' });
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { type, id, label } = confirmDelete;
    setConfirmDelete(null);
    const path =
      type === 'garment-type'
        ? `/admin/assets/garment-types/${id}`
        : `/admin/assets/poses/${id}?force=true`;
    try {
      await apiFetch(path, { method: 'DELETE' });
      if (type === 'garment-type') {
        setGarmentTypes((prev) => prev.filter((s) => s.id !== id));
        setSubView({ kind: 'list' });
      } else {
        setPoses((prev) => prev.filter((p) => p.id !== id));
      }
      toast({ title: `${label} deleted` });
    } catch {
      toast({ kind: 'error', title: `Failed to delete ${type}` });
    }
  };

  const doBulkDeletePoses = async () => {
    const ids = confirmBulkDeletePoseIds;
    setConfirmBulkDeletePoseIds([]);
    if (ids.length === 0) return;
    try {
      const res = await apiFetch<{ deleted: number }>('/admin/assets/poses', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      setPoses((prev) => prev.filter((p) => !ids.includes(p.id)));
      setSelectedPoseIds((prev) => prev.filter((id) => !ids.includes(id)));
      toast({ title: `Deleted ${res.deleted} pose${res.deleted !== 1 ? 's' : ''}` });
    } catch {
      toast({ kind: 'error', title: 'Bulk delete failed' });
    }
  };

  const doBulkWorkflow = async () => {
    if (!bulkWorkflowId || selectedPoseIds.length === 0) return;
    setBulkWorkflowing(true);
    try {
      await apiFetch('/admin/assets/poses/bulk-workflow', {
        method: 'PATCH',
        body: JSON.stringify({ ids: selectedPoseIds, workflowTemplateId: bulkWorkflowId }),
      });
      const wf = workflows.find((w) => w.id === bulkWorkflowId);
      setPoses((prev) =>
        prev.map((p) =>
          selectedPoseIds.includes(p.id)
            ? {
                ...p,
                workflowTemplateId: bulkWorkflowId,
                workflowLabel: wf?.label ?? null,
                showsLower: wf?.lowerNodeId != null,
                showsShoes: wf?.shoeNodeId != null,
              }
            : p,
        ),
      );
      toast({
        title: `Workflow updated for ${selectedPoseIds.length} pose${selectedPoseIds.length !== 1 ? 's' : ''}`,
      });
      setBulkWorkflowId('');
    } catch {
      toast({ kind: 'error', title: 'Bulk workflow update failed' });
    } finally {
      setBulkWorkflowing(false);
    }
  };

  // Derived data
  const filteredGarmentTypes = garmentTypes.filter(
    (s) => genderFilter === 'all' || s.genderSlug === genderFilter,
  );

  const posesInCell = poses.filter(
    (p) => (!filterFace || p.faceId === filterFace) && (!filterBg || p.backgroundId === filterBg),
  );

  const poseVariantsInCell = Array.from(
    new Set(
      posesInCell
        .map((p) => p.label.match(/pose(\d+)/i)?.[0]?.toLowerCase())
        .filter(Boolean) as string[],
    ),
  ).sort();

  const visiblePoses = posesInCell
    .filter((p) => !filterPose || p.label.match(/pose(\d+)/i)?.[0]?.toLowerCase() === filterPose)
    .filter((p) => !poseSearch || p.label.toLowerCase().includes(poseSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (poseSortKey === 'label') cmp = a.label.localeCompare(b.label);
      else if (poseSortKey === 'sortOrder') cmp = a.sortOrder - b.sortOrder;
      else cmp = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      return poseSortDir === 'asc' ? cmp : -cmp;
    });

  const poseTotalPages = Math.max(1, Math.ceil(visiblePoses.length / POSE_PAGE_SIZE));
  const poseClampedPage = Math.min(posePage, poseTotalPages);
  const pagedPoses = visiblePoses.slice(
    (poseClampedPage - 1) * POSE_PAGE_SIZE,
    poseClampedPage * POSE_PAGE_SIZE,
  );

  const usedFaceIds = new Set(
    poses.filter((p) => !filterBg || p.backgroundId === filterBg).map((p) => p.faceId),
  );
  const usedBgIds = new Set(
    poses.filter((p) => !filterFace || p.faceId === filterFace).map((p) => p.backgroundId),
  );
  const poseFaces = faces.filter((f) => usedFaceIds.has(f.id));
  const poseBgs = allBackgrounds.filter((b) => usedBgIds.has(b.id));

  const currentSubcatId = subView.kind === 'garment-type' ? subView.sub.id : null;
  const hasActiveLowerForSubcat =
    currentSubcatId !== null &&
    catalogItems.some(
      (c) => c.type === 'lower' && c.isActive && c.subcategoryIds.includes(currentSubcatId),
    );
  const hasActiveShoeForSubcat =
    currentSubcatId !== null &&
    catalogItems.some(
      (c) => c.type === 'shoe' && c.isActive && c.subcategoryIds.includes(currentSubcatId),
    );

  return (
    <>
      <div className="page-head">
        <div>
          {subView.kind === 'garment-type' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                fontSize: 13,
                color: 'var(--muted)',
              }}
            >
              <button
                className="btn sm ghost"
                onClick={() => {
                  setSubView({ kind: 'list' });
                  setSelectedPoseIds([]);
                }}
                style={{ padding: '2px 8px', fontSize: 13 }}
              >
                Garment Types
              </button>
              <Icon.Chevron />
              <span>{subView.sub.label}</span>
            </div>
          )}
          <h1>{subView.kind === 'garment-type' ? subView.sub.label : 'Garment Types'}</h1>
          <p className="lede">
            {subView.kind === 'list'
              ? 'Garment types. Click to manage assets.'
              : `Assets for ${subView.sub.genderSlug} / ${subView.sub.slug}. Filter by face or background to slice the tensor.`}
          </p>
        </div>
        {subView.kind === 'list' && (
          <div className="head-tools">
            <button
              className="btn"
              onClick={() => {
                setSubcatForm({
                  slug: '',
                  label: '',
                  genderSlug: 'men',
                  requiresLowerUpload: false,
                });
                setShowSubcatModal(true);
              }}
            >
              <Icon.Add /> Add garment type
            </button>
          </div>
        )}
      </div>

      {/* List view */}
      {!loading && subView.kind === 'list' && (
        <>
          <div className="tabs" style={{ marginTop: -8 }}>
            {GENDER_TABS.map((t) => (
              <button
                key={t.k}
                className={`tab ${genderFilter === t.k ? 'active' : ''}`}
                onClick={() => setGenderFilter(t.k)}
              >
                {t.l}
              </button>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Garment Type</th>
                  <th>Gender</th>
                  <th>Poses</th>
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredGarmentTypes.map((sub) => (
                  <tr
                    key={sub.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setFilterFace('');
                      setFilterBg('');
                      setFilterPose('');
                      setPoseSearch('');
                      setPosePage(1);
                      setSubView({ kind: 'garment-type', sub });
                    }}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <AssetThumb
                          thumbnailKey={sub.thumbnailKey ?? undefined}
                          label={sub.label}
                          w={40}
                          h={40}
                          storageBase={storagePublicUrl}
                        />
                        <div>
                          <span className="semi">{sub.label}</span>
                          <span className="sub mono" style={{ display: 'block' }}>
                            {sub.slug}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge dot accent">{sub.genderSlug}</span>
                    </td>
                    <td>
                      <span className="mono">{sub.poseCount ?? 0}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={sub.isActive}
                        onChange={async () => {
                          const next = !sub.isActive;
                          setGarmentTypes((prev) =>
                            prev.map((s) => (s.id === sub.id ? { ...s, isActive: next } : s)),
                          );
                          try {
                            await apiFetch(`/admin/assets/garment-types/${sub.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ isActive: next }),
                            });
                            toast({
                              title: `${sub.label} ${sub.isActive ? 'deactivated' : 'activated'}`,
                            });
                          } catch {
                            setGarmentTypes((prev) =>
                              prev.map((s) =>
                                s.id === sub.id ? { ...s, isActive: sub.isActive } : s,
                              ),
                            );
                            toast({ kind: 'error', title: 'Failed to update garment type' });
                          }
                        }}
                      />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn sm ghost"
                          onClick={() => {
                            setEditingSubcat(sub);
                            setEditSubcatLabel(sub.label);
                            setEditSubcatRequiresLowerUpload(sub.requiresLowerUpload);
                            setEditSubcatDefaultLowerId(sub.defaultLowerCatalogId ?? '');
                            setEditSubcatDefaultShoeId(sub.defaultShoeCatalogId ?? '');
                            setEditSubcatImageFile(null);
                          }}
                        >
                          <Icon.Edit />
                        </button>
                        <button
                          className="btn sm ghost"
                          onClick={() =>
                            setConfirmDelete({ type: 'garment-type', id: sub.id, label: sub.label })
                          }
                        >
                          <Icon.Trash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredGarmentTypes.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                    >
                      No garment types found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Poses subview */}
      {!loading && subView.kind === 'garment-type' && (
        <>
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              marginTop: 8,
              marginBottom: 4,
              flexWrap: 'wrap',
            }}
          >
            <button
              className="btn sm ghost"
              onClick={() => setSubView({ kind: 'list' })}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Icon.Back />
            </button>
            <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
            <input
              className="input"
              style={{ minWidth: 160, maxWidth: 220 }}
              placeholder="Search poses…"
              value={poseSearch}
              onChange={(e) => setPoseSearch(e.target.value)}
            />
            <select
              className="select"
              style={{ minWidth: 150 }}
              value={filterFace}
              onChange={(e) => {
                setFilterFace(e.target.value);
                setFilterPose('');
              }}
            >
              <option value="">All faces</option>
              {poseFaces.map((f) => (
                <option key={f.id} value={f.id}>
                  [{f.gender}] {f.label}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ minWidth: 150 }}
              value={filterBg}
              onChange={(e) => {
                setFilterBg(e.target.value);
                setFilterPose('');
              }}
            >
              <option value="">All backgrounds</option>
              {poseBgs
                .slice()
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
            </select>
            <select
              className="select"
              style={{ minWidth: 130 }}
              value={filterPose}
              disabled={posesInCell.length === 0}
              onChange={(e) => setFilterPose(e.target.value)}
            >
              <option value="">All poses ({posesInCell.length})</option>
              {poseVariantsInCell.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            {(filterFace || filterBg || filterPose || poseSearch) && (
              <button
                className="btn sm ghost"
                onClick={() => {
                  setFilterFace('');
                  setFilterBg('');
                  setFilterPose('');
                  setPoseSearch('');
                }}
              >
                Clear
              </button>
            )}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select
                className="select"
                style={{ minWidth: 120 }}
                value={poseSortKey}
                onChange={(e) =>
                  setPoseSortKey(e.target.value as 'label' | 'sortOrder' | 'createdAt')
                }
              >
                <option value="label">Name</option>
                <option value="sortOrder">Sort order</option>
                <option value="createdAt">Date added</option>
              </select>
              <button
                className="btn sm ghost"
                title={poseSortDir === 'asc' ? 'Ascending' : 'Descending'}
                onClick={() => setPoseSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              >
                {poseSortDir === 'asc' ? '↑' : '↓'}
              </button>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                className="btn sm ghost"
                onClick={() => {
                  const allVisible = visiblePoses.map((p) => p.id);
                  const allSelected = allVisible.every((id) => selectedPoseIds.includes(id));
                  setSelectedPoseIds(allSelected ? [] : allVisible);
                }}
              >
                {visiblePoses.every((p) => selectedPoseIds.includes(p.id)) &&
                visiblePoses.length > 0
                  ? 'Deselect all'
                  : 'Select all'}
              </button>
              {selectedPoseIds.length > 0 && (
                <>
                  <select
                    className="select"
                    style={{ minWidth: 140 }}
                    value={bulkWorkflowId}
                    onChange={(e) => setBulkWorkflowId(e.target.value)}
                  >
                    <option value="">Change workflow…</option>
                    {workflows.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn sm"
                    disabled={!bulkWorkflowId || bulkWorkflowing}
                    onClick={() => void doBulkWorkflow()}
                  >
                    Apply to {selectedPoseIds.length}
                  </button>
                  <button
                    className="btn sm danger"
                    onClick={() => setConfirmBulkDeletePoseIds([...selectedPoseIds])}
                  >
                    <Icon.Trash /> Delete selected ({selectedPoseIds.length})
                  </button>
                </>
              )}
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 10px' }}>
            {visiblePoses.length}/{poses.length} poses
            {poseTotalPages > 1 && ` · page ${poseClampedPage}/${poseTotalPages}`}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 14,
            }}
          >
            {pagedPoses.map((pose) => {
              const faceName = faces.find((f) => f.id === pose.faceId)?.label ?? '?';
              const bgName = allBackgrounds.find((b) => b.id === pose.backgroundId)?.label ?? '?';
              const wf = workflows.find((w) => w.id === pose.workflowTemplateId);
              const hasLower = !!wf?.lowerNodeId;
              const hasShoe = !!wf?.shoeNodeId;
              const missingLower = hasLower && !hasActiveLowerForSubcat;
              const missingShoe = hasShoe && !hasActiveShoeForSubcat;
              const missingAddons = missingLower || missingShoe;
              return (
                <div
                  key={pose.id}
                  className="card"
                  style={{
                    opacity: pose.isActive ? 1 : 0.6,
                    padding: 14,
                    outline: selectedPoseIds.includes(pose.id)
                      ? '2px solid var(--pink)'
                      : missingAddons
                        ? '2px solid #f59e0b'
                        : undefined,
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <AssetThumb
                        thumbnailKey={pose.thumbnailKey}
                        r2Key={pose.r2Key}
                        label={pose.label}
                        w={64}
                        h={88}
                        storageBase={storagePublicUrl}
                        onPreview={setPreviewUrl}
                      />
                      <input
                        type="checkbox"
                        checked={selectedPoseIds.includes(pose.id)}
                        onChange={(e) =>
                          setSelectedPoseIds((prev) =>
                            e.target.checked
                              ? [...prev, pose.id]
                              : prev.filter((id) => id !== pose.id),
                          )
                        }
                        style={{
                          position: 'absolute',
                          top: 4,
                          left: 4,
                          width: 15,
                          height: 15,
                          cursor: 'pointer',
                          accentColor: 'var(--pink)',
                        }}
                      />
                    </div>
                    <div style={{ marginTop: 4, minWidth: 0 }}>
                      <span className="semi" style={{ fontSize: 13 }}>
                        {pose.label}
                      </span>
                      <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        <span className="badge dot">{faceName}</span>
                        <span className="badge dot">{bgName}</span>
                        {pose.workflowLabel && (
                          <span className="badge dot accent">{pose.workflowLabel}</span>
                        )}
                        {hasLower && !missingLower && (
                          <span
                            className="badge dot"
                            style={{ background: '#d1fae5', color: '#065f46' }}
                            title="Lower garment items assigned"
                          >
                            lower ✓
                          </span>
                        )}
                        {hasShoe && !missingShoe && (
                          <span
                            className="badge dot"
                            style={{ background: '#dbeafe', color: '#1e3a8a' }}
                            title="Shoes items assigned"
                          >
                            shoes ✓
                          </span>
                        )}
                        {missingLower && (
                          <span
                            className="badge dot"
                            style={{ background: '#fef3c7', color: '#92400e' }}
                            title="Workflow requires lower garment but no lower items assigned"
                          >
                            ⚠ lower missing
                          </span>
                        )}
                        {missingShoe && (
                          <span
                            className="badge dot"
                            style={{ background: '#fef3c7', color: '#92400e' }}
                            title="Workflow requires shoes but no shoe items assigned"
                          >
                            ⚠ shoes missing
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Switch checked={pose.isActive} onChange={() => togglePose(pose.id)} />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn sm ghost"
                          title="Edit prompt & workflow"
                          onClick={() => setEditingPose(pose)}
                        >
                          <Icon.Edit />
                        </button>
                        <button
                          className="btn sm ghost"
                          onClick={() =>
                            setConfirmDelete({ type: 'pose', id: pose.id, label: pose.label })
                          }
                        >
                          <Icon.Trash />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {visiblePoses.length === 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  color: 'var(--muted)',
                  padding: '2rem',
                }}
              >
                {poses.length === 0
                  ? 'No poses yet. Upload poses to get started.'
                  : 'No poses match current filters.'}
              </div>
            )}
          </div>
          {poseTotalPages > 1 && (
            <Pager
              page={poseClampedPage - 1}
              totalPages={poseTotalPages}
              onPage={(n) => setPosePage(n + 1)}
              totalItems={visiblePoses.length}
              pageSize={POSE_PAGE_SIZE}
            />
          )}
        </>
      )}

      {/* ── Modals ── */}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete {confirmDelete.type === 'garment-type' ? 'garment type' : 'pose'}</h3>
            </div>
            <div className="modal-body">
              <p>
                Delete <strong>{confirmDelete.label}</strong>? This cannot be undone.
              </p>
              {confirmDelete.type === 'garment-type' && (
                <p style={{ color: 'var(--danger)', marginTop: 8 }}>
                  All related poses and templates will also be deleted.
                </p>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="btn danger" onClick={doDelete}>
                <Icon.Trash /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBulkDeletePoseIds.length > 0 && (
        <div className="modal-overlay" onClick={() => setConfirmBulkDeletePoseIds([])}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete {confirmBulkDeletePoseIds.length} poses</h3>
            </div>
            <div className="modal-body">
              <p>
                Permanently delete <strong>{confirmBulkDeletePoseIds.length} selected poses</strong>
                ? This cannot be undone.
              </p>
              <p style={{ color: 'var(--danger)', marginTop: 8 }}>
                Warning: poses referenced by existing jobs will still be deleted (force).
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmBulkDeletePoseIds([])}>
                Cancel
              </button>
              <button className="btn danger" onClick={doBulkDeletePoses}>
                <Icon.Trash /> Delete {confirmBulkDeletePoseIds.length} poses
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add garment type */}
      {showSubcatModal && (
        <div
          className="modal-overlay"
          onClick={
            subcatSaving
              ? undefined
              : () => {
                  setShowSubcatModal(false);
                  setSubcatImageFile(null);
                }
          }
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(440px, calc(100vw - 80px))' }}
          >
            <div className="modal-head">
              <h3>Add garment type</h3>
              <button
                className="btn sm ghost"
                onClick={() => {
                  setShowSubcatModal(false);
                  setSubcatImageFile(null);
                }}
                disabled={subcatSaving}
                style={{ marginLeft: 'auto' }}
              >
                <Icon.Close />
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div className="field">
                <label>Label</label>
                <input
                  className="input"
                  placeholder="Full Sleeve Shirt"
                  value={subcatForm.label}
                  disabled={subcatSaving}
                  onChange={(e) => setSubcatForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Slug</label>
                <input
                  className="input"
                  placeholder="fullsleeveshirt"
                  value={subcatForm.slug}
                  disabled={subcatSaving}
                  onChange={(e) =>
                    setSubcatForm((f) => ({
                      ...f,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                    }))
                  }
                />
              </div>
              <div className="field">
                <label>Gender</label>
                <select
                  className="select"
                  value={subcatForm.genderSlug}
                  disabled={subcatSaving}
                  onChange={(e) =>
                    setSubcatForm((f) => ({ ...f, genderSlug: e.target.value as GenderSlug }))
                  }
                >
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                  <option value="boys">Boys</option>
                  <option value="girls">Girls</option>
                </select>
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={subcatForm.requiresLowerUpload}
                    disabled={subcatSaving}
                    onChange={(e) =>
                      setSubcatForm((f) => ({ ...f, requiresLowerUpload: e.target.checked }))
                    }
                  />
                  Requires lower garment upload
                  <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>
                    (user uploads bottom wear separately)
                  </span>
                </label>
              </div>
              <div className="field">
                <label>
                  Thumbnail image{' '}
                  <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {subcatImageFile ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={URL.createObjectURL(subcatImageFile)}
                      alt="preview"
                      style={{
                        width: 48,
                        height: 48,
                        objectFit: 'cover',
                        borderRadius: 6,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 6,
                        background: 'var(--subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon.Image />
                    </div>
                  )}
                  <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
                    {subcatImageFile ? 'Change image' : 'Upload image'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setSubcatImageFile(f);
                      }}
                    />
                  </label>
                  {subcatImageFile && (
                    <button className="btn sm ghost" onClick={() => setSubcatImageFile(null)}>
                      <Icon.Close />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => {
                  setShowSubcatModal(false);
                  setSubcatImageFile(null);
                }}
                disabled={subcatSaving}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={subcatSaving || !subcatForm.label.trim() || !subcatForm.slug.trim()}
                onClick={async () => {
                  setSubcatSaving(true);
                  try {
                    let thumbnailKey: string | undefined;
                    if (subcatImageFile) {
                      const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
                        '/admin/assets/garment-types/presign',
                        {
                          method: 'POST',
                          body: JSON.stringify({ contentType: subcatImageFile.type }),
                        },
                      );
                      const thumb = await makeThumbnail(subcatImageFile);
                      await fetch(presign.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': thumb.type },
                        body: thumb,
                      });
                      thumbnailKey = presign.thumbnailKey;
                    }
                    const row = await apiFetch<GarmentType>('/admin/assets/garment-types', {
                      method: 'POST',
                      body: JSON.stringify({ ...subcatForm, thumbnailKey }),
                    });
                    setGarmentTypes((prev) => [...prev, row]);
                    toast({ title: `${row.label} created` });
                    setShowSubcatModal(false);
                    setSubcatImageFile(null);
                  } catch {
                    toast({ kind: 'error', title: 'Failed to create garment type' });
                  } finally {
                    setSubcatSaving(false);
                  }
                }}
              >
                <Icon.Add /> {subcatSaving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit garment type */}
      {editingSubcat && (
        <div
          className="modal-overlay"
          onClick={
            editSubcatSaving
              ? undefined
              : () => {
                  setEditingSubcat(null);
                  setEditSubcatImageFile(null);
                  setEditSubcatLabel('');
                  setEditSubcatRequiresLowerUpload(false);
                }
          }
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(440px, calc(100vw - 80px))' }}
          >
            <div className="modal-head">
              <h3>Edit garment type</h3>
              <button
                className="btn sm ghost"
                onClick={() => {
                  setEditingSubcat(null);
                  setEditSubcatImageFile(null);
                  setEditSubcatLabel('');
                  setEditSubcatRequiresLowerUpload(false);
                  setEditSubcatDefaultLowerId('');
                  setEditSubcatDefaultShoeId('');
                }}
                disabled={editSubcatSaving}
                style={{ marginLeft: 'auto' }}
              >
                <Icon.Close />
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div className="field">
                <label>Label</label>
                <input
                  className="input"
                  value={editSubcatLabel}
                  disabled={editSubcatSaving}
                  onChange={(e) => setEditSubcatLabel(e.target.value)}
                />
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editSubcatRequiresLowerUpload}
                    disabled={editSubcatSaving}
                    onChange={(e) => setEditSubcatRequiresLowerUpload(e.target.checked)}
                  />
                  Requires lower garment upload
                  <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>
                    (user uploads bottom wear separately)
                  </span>
                </label>
              </div>
              <div className="field">
                <label>Default lower garment</label>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    maxHeight: 180,
                    overflowY: 'auto',
                    padding: '2px 0',
                    opacity: editSubcatSaving ? 0.5 : 1,
                    pointerEvents: editSubcatSaving ? 'none' : undefined,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setEditSubcatDefaultLowerId('')}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 3,
                      background: 'none',
                      border: `2px solid ${editSubcatDefaultLowerId === '' ? 'var(--pink)' : 'var(--border)'}`,
                      borderRadius: 6,
                      padding: 3,
                      cursor: 'pointer',
                      width: 62,
                    }}
                  >
                    <div
                      style={{
                        width: 54,
                        height: 54,
                        borderRadius: 4,
                        background: 'var(--subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--muted)',
                        fontSize: 18,
                      }}
                    >
                      —
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1 }}>None</span>
                  </button>
                  {catalogItems
                    .filter(
                      (c) =>
                        c.type === 'lower' &&
                        c.isActive &&
                        (!c.genderSlug || c.genderSlug === editingSubcat.genderSlug),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        title={c.label}
                        onClick={() =>
                          setEditSubcatDefaultLowerId(c.id === editSubcatDefaultLowerId ? '' : c.id)
                        }
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 3,
                          background: 'none',
                          border: `2px solid ${editSubcatDefaultLowerId === c.id ? 'var(--pink)' : 'var(--border)'}`,
                          borderRadius: 6,
                          padding: 3,
                          cursor: 'pointer',
                          width: 62,
                        }}
                      >
                        <AssetThumb
                          thumbnailKey={c.thumbnailKey}
                          label={c.label}
                          w={54}
                          h={54}
                          storageBase={storagePublicUrl}
                        />
                        <span
                          style={{
                            fontSize: 10,
                            color: 'var(--muted)',
                            lineHeight: 1,
                            maxWidth: 54,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.label}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
              <div className="field">
                <label>Default shoe</label>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    maxHeight: 180,
                    overflowY: 'auto',
                    padding: '2px 0',
                    opacity: editSubcatSaving ? 0.5 : 1,
                    pointerEvents: editSubcatSaving ? 'none' : undefined,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setEditSubcatDefaultShoeId('')}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 3,
                      background: 'none',
                      border: `2px solid ${editSubcatDefaultShoeId === '' ? 'var(--pink)' : 'var(--border)'}`,
                      borderRadius: 6,
                      padding: 3,
                      cursor: 'pointer',
                      width: 62,
                    }}
                  >
                    <div
                      style={{
                        width: 54,
                        height: 54,
                        borderRadius: 4,
                        background: 'var(--subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--muted)',
                        fontSize: 18,
                      }}
                    >
                      —
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1 }}>None</span>
                  </button>
                  {catalogItems
                    .filter(
                      (c) =>
                        c.type === 'shoe' &&
                        c.isActive &&
                        (!c.genderSlug || c.genderSlug === editingSubcat.genderSlug),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        title={c.label}
                        onClick={() =>
                          setEditSubcatDefaultShoeId(c.id === editSubcatDefaultShoeId ? '' : c.id)
                        }
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 3,
                          background: 'none',
                          border: `2px solid ${editSubcatDefaultShoeId === c.id ? 'var(--pink)' : 'var(--border)'}`,
                          borderRadius: 6,
                          padding: 3,
                          cursor: 'pointer',
                          width: 62,
                        }}
                      >
                        <AssetThumb
                          thumbnailKey={c.thumbnailKey}
                          label={c.label}
                          w={54}
                          h={54}
                          storageBase={storagePublicUrl}
                        />
                        <span
                          style={{
                            fontSize: 10,
                            color: 'var(--muted)',
                            lineHeight: 1,
                            maxWidth: 54,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.label}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
              <div className="field">
                <label>Thumbnail image</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {editSubcatImageFile ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={URL.createObjectURL(editSubcatImageFile)}
                      alt="preview"
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: 'cover',
                        borderRadius: 6,
                        flexShrink: 0,
                      }}
                    />
                  ) : editingSubcat.thumbnailKey && storagePublicUrl ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={`${storagePublicUrl}/${editingSubcat.thumbnailKey}`}
                      alt={editingSubcat.label}
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: 'cover',
                        borderRadius: 6,
                        flexShrink: 0,
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 6,
                        background: 'var(--subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: 'var(--muted)',
                        fontSize: 12,
                      }}
                    >
                      No image
                    </div>
                  )}
                  <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
                    {editSubcatImageFile || editingSubcat.thumbnailKey
                      ? 'Replace image'
                      : 'Upload image'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setEditSubcatImageFile(f);
                      }}
                    />
                  </label>
                  {editSubcatImageFile && (
                    <button className="btn sm ghost" onClick={() => setEditSubcatImageFile(null)}>
                      <Icon.Close />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => {
                  setEditingSubcat(null);
                  setEditSubcatImageFile(null);
                  setEditSubcatLabel('');
                  setEditSubcatRequiresLowerUpload(false);
                  setEditSubcatDefaultLowerId('');
                  setEditSubcatDefaultShoeId('');
                }}
                disabled={editSubcatSaving}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={
                  editSubcatSaving ||
                  (!editSubcatImageFile &&
                    editSubcatLabel.trim() === editingSubcat.label.trim() &&
                    editSubcatRequiresLowerUpload === editingSubcat.requiresLowerUpload &&
                    editSubcatDefaultLowerId === (editingSubcat.defaultLowerCatalogId ?? '') &&
                    editSubcatDefaultShoeId === (editingSubcat.defaultShoeCatalogId ?? ''))
                }
                onClick={async () => {
                  setEditSubcatSaving(true);
                  try {
                    const patchBody: {
                      thumbnailKey?: string;
                      label?: string;
                      requiresLowerUpload?: boolean;
                      defaultLowerCatalogId?: string | null;
                      defaultShoeCatalogId?: string | null;
                    } = {};
                    if (editSubcatImageFile) {
                      const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
                        '/admin/assets/garment-types/presign',
                        {
                          method: 'POST',
                          body: JSON.stringify({ contentType: editSubcatImageFile.type }),
                        },
                      );
                      const thumb = await makeThumbnail(editSubcatImageFile);
                      await fetch(presign.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': thumb.type },
                        body: thumb,
                      });
                      patchBody.thumbnailKey = presign.thumbnailKey;
                    }
                    if (editSubcatLabel.trim() !== editingSubcat.label.trim()) {
                      patchBody.label = editSubcatLabel.trim();
                    }
                    if (editSubcatRequiresLowerUpload !== editingSubcat.requiresLowerUpload) {
                      patchBody.requiresLowerUpload = editSubcatRequiresLowerUpload;
                    }
                    if (editSubcatDefaultLowerId !== (editingSubcat.defaultLowerCatalogId ?? '')) {
                      patchBody.defaultLowerCatalogId = editSubcatDefaultLowerId || null;
                    }
                    if (editSubcatDefaultShoeId !== (editingSubcat.defaultShoeCatalogId ?? '')) {
                      patchBody.defaultShoeCatalogId = editSubcatDefaultShoeId || null;
                    }
                    if (Object.keys(patchBody).length > 0) {
                      await apiFetch(`/admin/assets/garment-types/${editingSubcat.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify(patchBody),
                      });
                      setGarmentTypes((prev) =>
                        prev.map((s) => (s.id === editingSubcat.id ? { ...s, ...patchBody } : s)),
                      );
                    }
                    toast({ title: `${patchBody.label ?? editingSubcat.label} updated` });
                    setEditingSubcat(null);
                    setEditSubcatImageFile(null);
                    setEditSubcatLabel('');
                    setEditSubcatRequiresLowerUpload(false);
                    setEditSubcatDefaultLowerId('');
                    setEditSubcatDefaultShoeId('');
                  } catch {
                    toast({ kind: 'error', title: 'Failed to save' });
                  } finally {
                    setEditSubcatSaving(false);
                  }
                }}
              >
                {editSubcatSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingPose && (
        <EditPoseModal
          pose={editingPose}
          faces={faces}
          backgrounds={allBackgrounds}
          workflows={workflows}
          onSaved={(updated) => {
            setPoses((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          }}
          onClose={() => setEditingPose(null)}
          toast={toast}
        />
      )}
    </>
  );
}
