import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { EditPoseAssetModal } from '../../components/EditPoseAssetModal';
import { Icon } from '../../components/Icons';
import { Pager } from '../../components/Pager';
import { PoseUploadModal } from '../../components/PoseUploadModal';
import { SearchableSelect } from '../../components/SearchableSelect';
import { Switch } from '../../components/Switch';
import { useCrumb } from '../../context/BreadcrumbContext';
import { useCloseOverlay } from '../../hooks/use-close-overlay';
import { useUrlStateMulti } from '../../hooks/use-url-state';
import { apiErrorMessage, apiFetch, getToken } from '../../lib/data';
import type {
  GenderSlug,
  ModelPoseAsset,
  PoseGarmentTypeConfig,
  WorkflowOption,
} from '../../types';
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
    workflows,
    setWorkflows,
    loading,
    setLoading,
    setPreviewUrl,
    toast,
  } = useAssetsContext();

  const tabHref = '/assets?tab=pose-assets';
  const [poseAssets, setPoseAssets] = useState<ModelPoseAsset[]>([]);
  const [paSearch, setPaSearch] = useState('');
  const [paFilterWorkflow, setPaFilterWorkflow] = useState('');
  const [paFilterPose, setPaFilterPose] = useState('');
  const [paSortKey, setPaSortKey] = useState<'label' | 'sortOrder' | 'createdAt'>('sortOrder');
  const [paSortDir, setPaSortDir] = useState<'asc' | 'desc'>('asc');
  const [paPage, setPaPage] = useState(1);
  const [selectedPoseAssetIds, setSelectedPoseAssetIds] = useState<string[]>([]);
  // Dialog open-ness is URL state; the specific ids being deleted are a
  // snapshot of `selectedPoseAssetIds` taken at open time and stay local,
  // same as UsersPage's bulk-delete precedent (confirm=bulk-delete-users).
  const [confirmBulkDeletePoseAssetIds, setConfirmBulkDeletePoseAssetIds] = useState<string[]>([]);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [confirmUnmapPoseAssetIds, setConfirmUnmapPoseAssetIds] = useState<string[]>([]);
  const [bulkUnmapSaving, setBulkUnmapSaving] = useState(false);

  // One shared `modal` param for every single-record modal on this tab,
  // mirroring UsersPage's modal enum. `editId` only matters for edit-pose,
  // resolved against the already-loaded `poseAssets` list.
  const [{ modal: modalParam, editId }, setModalParams] = useUrlStateMulti(['modal', 'editId']);
  const closeModal = useCloseOverlay(['modal', 'editId']);
  const showPoseAssetUpload = modalParam === 'upload-pose';
  const editingPoseAsset: ModelPoseAsset | null =
    modalParam === 'edit-pose' && editId ? (poseAssets.find((a) => a.id === editId) ?? null) : null;
  const showBulkRename = modalParam === 'bulk-rename';
  const showBulkWorkflow = modalParam === 'bulk-workflow';
  const showBulkImport = modalParam === 'bulk-import';
  const showBulkGarmentMap = modalParam === 'bulk-garment-map';

  const [{ confirm: confirmParam, confirmId }, setConfirmParams] = useUrlStateMulti([
    'confirm',
    'confirmId',
  ]);
  const closeConfirm = useCloseOverlay(['confirm', 'confirmId']);
  const confirmDeletePoseAssetId = confirmParam === 'delete-pose' ? confirmId : null;

  useCrumb(0, { label: 'Pose Assets', href: tabHref });
  useCrumb(
    1,
    showPoseAssetUpload
      ? { label: 'Upload pose', href: `${tabHref}&modal=upload-pose` }
      : editingPoseAsset
        ? {
            label: 'Edit pose',
            href: `${tabHref}&modal=edit-pose&editId=${encodeURIComponent(editingPoseAsset.id)}`,
          }
        : showBulkRename
          ? { label: 'Rename', href: `${tabHref}&modal=bulk-rename` }
          : showBulkWorkflow
            ? { label: 'Change workflow', href: `${tabHref}&modal=bulk-workflow` }
            : showBulkImport
              ? { label: 'Bulk import', href: `${tabHref}&modal=bulk-import` }
              : showBulkGarmentMap
                ? { label: 'Map to garment types', href: `${tabHref}&modal=bulk-garment-map` }
                : null,
  );
  useCrumb(
    2,
    confirmDeletePoseAssetId
      ? {
          label: 'Delete pose',
          href: `${tabHref}&confirm=delete-pose&confirmId=${encodeURIComponent(confirmDeletePoseAssetId)}`,
        }
      : confirmParam === 'bulk-delete-poses'
        ? { label: 'Move to recycle bin', href: `${tabHref}&confirm=bulk-delete-poses` }
        : confirmParam === 'unmap-poses-garment-types'
          ? { label: 'Unmap from all', href: `${tabHref}&confirm=unmap-poses-garment-types` }
          : null,
  );

  // Bulk rename state
  const [bulkRenameDisplayName, setBulkRenameDisplayName] = useState('');
  const [bulkRenaming, setBulkRenaming] = useState(false);

  // Bulk workflow state
  const [bulkWorkflowId, setBulkWorkflowId] = useState('');
  const [bulkWorkflowSaving, setBulkWorkflowSaving] = useState(false);

  // Bulk sort order state
  const [bulkSortStart, setBulkSortStart] = useState(0);
  const [bulkSortSaving, setBulkSortSaving] = useState(false);

  // Bulk garment-type mapping state — one pose's config list per selected
  // pose, fetched from the same per-pose endpoint the single-asset editor
  // uses, so preserving workflow/prompt overrides on apply doesn't need a
  // separate read path.
  const [bulkGarmentConfigsByPose, setBulkGarmentConfigsByPose] = useState<
    Record<string, PoseGarmentTypeConfig[]>
  >({});
  const [bulkGarmentLoading, setBulkGarmentLoading] = useState(false);
  const [bulkGarmentTypeIds, setBulkGarmentTypeIds] = useState<string[]>([]);
  const [bulkGarmentSaving, setBulkGarmentSaving] = useState(false);

  // Bulk import state
  const [bulkImportGender, setBulkImportGender] = useState<GenderSlug>('men');
  const [bulkImportWorkflowId, setBulkImportWorkflowId] = useState('');
  const [bulkImportFile, setBulkImportFile] = useState<File | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState(0);
  const [bulkImportPhase, setBulkImportPhase] = useState<'uploading' | 'processing'>('uploading');
  const [bulkImportCounts, setBulkImportCounts] = useState<{
    phase: string;
    done: number;
    total: number;
  } | null>(null);
  const bulkImportXhrRef = useRef<XMLHttpRequest | null>(null);
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleImageClick(id: string) {
    if (singleClickTimerRef.current) {
      // Second click of a double-click — cancel timer, let onDoubleClick handle it
      clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = null;
      return;
    }
    singleClickTimerRef.current = setTimeout(() => {
      singleClickTimerRef.current = null;
      setSelectedPoseAssetIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
    }, 250);
  }

  function handleImageDoubleClick(r2Url: string | null) {
    if (r2Url) setPreviewUrl(r2Url);
  }

  const loadPoseAssets = useCallback(async () => {
    setLoading(true);
    try {
      const [assetsRes, wfRes] = await Promise.all([
        apiFetch<{ items: ModelPoseAsset[] }>('/admin/assets/pose-assets'),
        apiFetch<WorkflowOption[]>('/admin/workflows'),
      ]);
      setPoseAssets(assetsRes.items);
      setWorkflows(wfRes);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load pose assets',
        body: apiErrorMessage(e, 'Please try again.'),
      });
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

  const toggleActive = async (id: string) => {
    const item = poseAssets.find((a) => a.id === id);
    if (!item) return;
    const next = !item.isActive;
    setPoseAssets((prev) => prev.map((a) => (a.id === id ? { ...a, isActive: next } : a)));
    try {
      await apiFetch(`/admin/assets/pose-assets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      toast({ title: `${item.displayName ?? item.label} ${next ? 'activated' : 'deactivated'}` });
    } catch (e) {
      setPoseAssets((prev) =>
        prev.map((a) => (a.id === id ? { ...a, isActive: item.isActive } : a)),
      );
      toast({
        kind: 'error',
        title: 'Failed to update pose asset',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  const dosBulkRename = async () => {
    const name = bulkRenameDisplayName.trim();
    if (!name || selectedPoseAssetIds.length === 0) return;
    setBulkRenaming(true);
    try {
      await apiFetch('/admin/assets/pose-assets/bulk-rename', {
        method: 'PATCH',
        body: JSON.stringify({ ids: selectedPoseAssetIds, displayName: name }),
      });
      setPoseAssets((prev) =>
        prev.map((a) => (selectedPoseAssetIds.includes(a.id) ? { ...a, displayName: name } : a)),
      );
      toast({
        title: `${selectedPoseAssetIds.length} pose asset${selectedPoseAssetIds.length !== 1 ? 's' : ''} renamed`,
      });
      closeModal();
      setSelectedPoseAssetIds([]);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Bulk rename failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
    setBulkRenaming(false);
  };

  const doBulkWorkflow = async () => {
    if (!bulkWorkflowId || selectedPoseAssetIds.length === 0) return;
    setBulkWorkflowSaving(true);
    try {
      await apiFetch('/admin/assets/pose-assets/bulk-workflow', {
        method: 'PATCH',
        body: JSON.stringify({ ids: selectedPoseAssetIds, workflowTemplateId: bulkWorkflowId }),
      });
      setPoseAssets((prev) =>
        prev.map((a) =>
          selectedPoseAssetIds.includes(a.id) ? { ...a, workflowTemplateId: bulkWorkflowId } : a,
        ),
      );
      toast({
        title: `Workflow updated for ${selectedPoseAssetIds.length} pose asset${selectedPoseAssetIds.length !== 1 ? 's' : ''}`,
      });
      closeModal();
      setSelectedPoseAssetIds([]);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Bulk workflow update failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBulkWorkflowSaving(false);
    }
  };

  const doBulkSortOrder = async () => {
    if (selectedPoseAssetIds.length === 0) return;
    setBulkSortSaving(true);
    // Assign sequential numbers in current display order
    const orderedSelected = filteredPoseAssets
      .filter((a) => selectedPoseAssetIds.includes(a.id))
      .map((a, i) => ({ id: a.id, sortOrder: bulkSortStart + i }));
    try {
      await Promise.all(
        orderedSelected.map(({ id, sortOrder }) =>
          apiFetch(`/admin/assets/pose-assets/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ sortOrder }),
          }),
        ),
      );
      setPoseAssets((prev) =>
        prev.map((a) => {
          const entry = orderedSelected.find((e) => e.id === a.id);
          return entry ? { ...a, sortOrder: entry.sortOrder } : a;
        }),
      );
      toast({
        title: `Sort order updated for ${orderedSelected.length} pose${orderedSelected.length !== 1 ? 's' : ''}`,
      });
      setSelectedPoseAssetIds([]);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update sort order',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBulkSortSaving(false);
    }
  };

  const openBulkGarmentMap = async () => {
    setBulkGarmentTypeIds([]);
    setModalParams({ modal: 'bulk-garment-map', editId: null });
    setBulkGarmentLoading(true);
    try {
      const entries = await Promise.all(
        selectedPoseAssetIds.map(async (id) => {
          const res = await apiFetch<{ items: PoseGarmentTypeConfig[] }>(
            `/admin/assets/pose-assets/${id}/garment-configs`,
          );
          return [id, res.items] as const;
        }),
      );
      setBulkGarmentConfigsByPose(Object.fromEntries(entries));
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load garment types',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBulkGarmentLoading(false);
    }
  };

  const doBulkGarmentMap = async (makeVisible: boolean) => {
    if (bulkGarmentTypeIds.length === 0 || selectedPoseAssetIds.length === 0) return;
    setBulkGarmentSaving(true);
    try {
      const patches: Promise<unknown>[] = [];
      for (const poseId of selectedPoseAssetIds) {
        const configs = bulkGarmentConfigsByPose[poseId] ?? [];
        for (const garmentTypeId of bulkGarmentTypeIds) {
          // A garment type not in this pose's own list means it's a different
          // gender than this pose — skip rather than write a cross-gender row.
          const cfg = configs.find((c) => c.id === garmentTypeId);
          if (!cfg) continue;
          patches.push(
            apiFetch(`/admin/assets/garment-types/${garmentTypeId}/pose-configs/${poseId}`, {
              method: 'PATCH',
              body: JSON.stringify({
                workflowTemplateId: cfg.config?.workflowTemplateId ?? null,
                promptGarmentPhase: cfg.config?.promptGarmentPhase ?? null,
                promptFacePhase: cfg.config?.promptFacePhase ?? null,
                isActive: makeVisible,
              }),
            }),
          );
        }
      }
      await Promise.all(patches);
      // Refetch rather than recompute visibleGarmentTypeCount/totalGarmentTypeCount
      // locally — the server already derives them from the same override rows we
      // just wrote, so this avoids duplicating that formula on the client.
      await loadPoseAssets();
      toast({
        title: `${selectedPoseAssetIds.length} pose${selectedPoseAssetIds.length !== 1 ? 's' : ''} ${makeVisible ? 'mapped to' : 'unmapped from'} ${bulkGarmentTypeIds.length} garment type${bulkGarmentTypeIds.length !== 1 ? 's' : ''}`,
      });
      closeModal();
      setSelectedPoseAssetIds([]);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Bulk garment mapping failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBulkGarmentSaving(false);
    }
  };

  const doUnmapAllGarmentTypes = async () => {
    const ids = confirmUnmapPoseAssetIds;
    if (ids.length === 0) return;
    closeConfirm();
    setConfirmUnmapPoseAssetIds([]);
    setBulkUnmapSaving(true);
    try {
      // Fetch fresh rather than reuse bulkGarmentConfigsByPose — this shortcut can be
      // used without ever opening the "Map to garment types" modal.
      const entries = await Promise.all(
        ids.map(async (id) => {
          const res = await apiFetch<{ items: PoseGarmentTypeConfig[] }>(
            `/admin/assets/pose-assets/${id}/garment-configs`,
          );
          return [id, res.items] as const;
        }),
      );
      const patches: Promise<unknown>[] = [];
      for (const [poseId, configs] of entries) {
        for (const cfg of configs) {
          patches.push(
            apiFetch(`/admin/assets/garment-types/${cfg.id}/pose-configs/${poseId}`, {
              method: 'PATCH',
              body: JSON.stringify({
                workflowTemplateId: cfg.config?.workflowTemplateId ?? null,
                promptGarmentPhase: cfg.config?.promptGarmentPhase ?? null,
                promptFacePhase: cfg.config?.promptFacePhase ?? null,
                isActive: false,
              }),
            }),
          );
        }
      }
      await Promise.all(patches);
      await loadPoseAssets();
      toast({
        title: `${ids.length} pose${ids.length !== 1 ? 's' : ''} unmapped from all garment types`,
      });
      setSelectedPoseAssetIds([]);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Unmap failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBulkUnmapSaving(false);
    }
  };

  const doBulkDeletePoseAssets = async () => {
    if (deleteConfirmText !== 'move to recycle bin') return;
    const ids = confirmBulkDeletePoseAssetIds;
    closeConfirm();
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
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Bulk delete failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  // Derived data
  const filteredPoseAssets = poseAssets
    .filter((a) => {
      if (genderFilter !== 'all' && a.genderSlug !== genderFilter) return false;
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
      else if (paSortKey === 'sortOrder') cmp = a.sortOrder - b.sortOrder;
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
  const paWorkflowOptions = workflows.filter((w) =>
    genderSlicedAssets.some((a) => a.workflowTemplateId === w.id),
  );
  const paPoseVariants = Array.from(
    new Set(genderSlicedAssets.map((a) => a.poseVariant).filter(Boolean) as string[]),
  ).sort();

  // Union of garment types across every selected pose's own list (each pose's
  // list is already scoped to its own gender) — a mixed-gender selection just
  // shows more rows, each still only applied to poses that share its gender.
  const bulkGarmentTypeOptions = Array.from(
    new Map(
      Object.values(bulkGarmentConfigsByPose)
        .flat()
        .map((g) => [g.id, g] as const),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pose Assets</h1>
          <p className="lede">
            Pose image assets. Filtered by gender — active poses are shown to users in studio.
          </p>
        </div>
        <div className="head-tools">
          <button
            className="btn ghost"
            onClick={() => setModalParams({ modal: 'upload-pose', editId: null })}
          >
            <Icon.Add /> Upload pose
          </button>
          <button
            className="btn"
            onClick={() => {
              setBulkImportGender('men');
              setBulkImportWorkflowId(workflows[0]?.id ?? '');
              setBulkImportFile(null);
              setModalParams({ modal: 'bulk-import', editId: null });
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
            <div style={{ minWidth: 140, width: 'auto' }}>
              <SearchableSelect
                options={paWorkflowOptions}
                value={paFilterWorkflow}
                onChange={setPaFilterWorkflow}
                emptyLabel="All workflows"
                placeholder="All workflows"
              />
            </div>
            <div style={{ minWidth: 130, width: 'auto' }}>
              <SearchableSelect
                options={paPoseVariants.map((v) => ({ id: v, label: v }))}
                value={paFilterPose}
                onChange={setPaFilterPose}
                emptyLabel="All poses"
                placeholder="All poses"
              />
            </div>
            <SearchableSelect
              style={{ minWidth: 110 }}
              options={[
                { id: 'sortOrder', label: 'Sort order' },
                { id: 'label', label: 'Name' },
                { id: 'createdAt', label: 'Date added' },
              ]}
              value={paSortKey}
              onChange={(v) => setPaSortKey(v as 'label' | 'sortOrder' | 'createdAt')}
            />
            <button
              className="btn sm ghost"
              title={paSortDir === 'asc' ? 'Ascending' : 'Descending'}
              onClick={() => setPaSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            >
              {paSortDir === 'asc' ? '↑' : '↓'}
            </button>
            {(paSearch || paFilterWorkflow || paFilterPose) && (
              <button
                className="btn sm ghost"
                onClick={() => {
                  setPaSearch('');
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
                    setBulkRenameDisplayName('');
                    setModalParams({ modal: 'bulk-rename', editId: null });
                  }}
                >
                  <Icon.Edit /> Rename ({selectedPoseAssetIds.length})
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    setBulkWorkflowId(workflows[0]?.id ?? '');
                    setModalParams({ modal: 'bulk-workflow', editId: null });
                  }}
                >
                  <Icon.Workflow /> Workflow ({selectedPoseAssetIds.length})
                </button>
                <button className="btn sm" onClick={() => void openBulkGarmentMap()}>
                  <Icon.Catalog /> Map to garment types ({selectedPoseAssetIds.length})
                </button>
                <button
                  className="btn sm ghost"
                  disabled={bulkUnmapSaving}
                  onClick={() => {
                    setConfirmUnmapPoseAssetIds([...selectedPoseAssetIds]);
                    setConfirmParams({ confirm: 'unmap-poses-garment-types', confirmId: null });
                  }}
                >
                  Unmap from all
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    Sort from
                  </span>
                  <input
                    type="number"
                    className="input"
                    min={0}
                    step={1}
                    value={bulkSortStart}
                    disabled={bulkSortSaving}
                    onChange={(e) => setBulkSortStart(Number(e.target.value))}
                    style={{ width: 64, padding: '3px 6px', fontSize: 12, height: 28 }}
                  />
                  <button
                    className="btn sm"
                    disabled={bulkSortSaving}
                    onClick={() => void doBulkSortOrder()}
                  >
                    {bulkSortSaving ? 'Saving…' : `Apply (${selectedPoseAssetIds.length})`}
                  </button>
                </div>
                <button
                  className="btn sm danger"
                  onClick={() => {
                    setConfirmBulkDeletePoseAssetIds([...selectedPoseAssetIds]);
                    setConfirmParams({ confirm: 'bulk-delete-poses', confirmId: null });
                  }}
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
                    opacity: a.isActive ? 1 : 0.55,
                  }}
                >
                  <div
                    style={{
                      background: 'var(--surface2, #1a1a1a)',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      aspectRatio: '3/4',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                    onClick={() => handleImageClick(a.id)}
                    onDoubleClick={() => handleImageDoubleClick(a.r2Url)}
                  >
                    <AssetThumb
                      thumbnailUrl={a.thumbnailUrl}
                      fullUrl={a.r2Url}
                      label={a.label}
                      cursor="pointer"
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
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                      {a.genderSlug && (
                        <span className="badge dot accent" style={{ fontSize: 10 }}>
                          {a.genderSlug}
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
                      {a.totalGarmentTypeCount !== undefined && (
                        <span
                          className="badge dot accent"
                          style={{ fontSize: 10 }}
                          title="Garment types this pose is visible on"
                        >
                          <Icon.Catalog /> {a.visibleGarmentTypeCount}/{a.totalGarmentTypeCount}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: 8,
                      }}
                    >
                      <Switch checked={a.isActive} onChange={() => void toggleActive(a.id)} />
                      <button
                        className="btn ghost"
                        style={{ fontSize: 10, padding: '3px 8px' }}
                        onClick={() => setModalParams({ modal: 'edit-pose', editId: a.id })}
                      >
                        <Icon.Edit /> Edit
                      </button>
                    </div>
                    <button
                      className="btn danger"
                      style={{ width: '100%', marginTop: 4, fontSize: 11, padding: '3px 0' }}
                      onClick={() => setConfirmParams({ confirm: 'delete-pose', confirmId: a.id })}
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
        <div className="modal-overlay" onClick={closeConfirm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Move to recycle bin</h3>
            </div>
            <div className="modal-body">
              <p>Move this pose asset to the recycle bin? You can restore it later.</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={closeConfirm}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  const id = confirmDeletePoseAssetId;
                  closeConfirm();
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

      {confirmParam === 'bulk-delete-poses' && (
        <div
          className="modal-overlay"
          onClick={() => {
            closeConfirm();
            setConfirmBulkDeletePoseAssetIds([]);
            setDeleteConfirmText('');
          }}
        >
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
                  closeConfirm();
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

      {/* Bulk workflow change */}
      {showBulkWorkflow && (
        <div className="modal-overlay" onClick={() => !bulkWorkflowSaving && closeModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-head">
              <h3>
                Change workflow for {selectedPoseAssetIds.length} pose asset
                {selectedPoseAssetIds.length !== 1 ? 's' : ''}
              </h3>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                Workflow template
                <SearchableSelect
                  options={workflows}
                  value={bulkWorkflowId}
                  disabled={bulkWorkflowSaving}
                  onChange={setBulkWorkflowId}
                  placeholder="— search workflow —"
                />
              </label>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" disabled={bulkWorkflowSaving} onClick={closeModal}>
                Cancel
              </button>
              <button
                className="btn"
                disabled={bulkWorkflowSaving || !bulkWorkflowId}
                onClick={() => void doBulkWorkflow()}
              >
                {bulkWorkflowSaving
                  ? 'Saving…'
                  : `Apply to ${selectedPoseAssetIds.length} pose${selectedPoseAssetIds.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unmap from all garment types */}
      {confirmParam === 'unmap-poses-garment-types' && (
        <div
          className="modal-overlay"
          onClick={() => {
            closeConfirm();
            setConfirmUnmapPoseAssetIds([]);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Unmap from all garment types</h3>
            </div>
            <div className="modal-body">
              <p>
                Hide <strong>{confirmUnmapPoseAssetIds.length}</strong> selected pose
                {confirmUnmapPoseAssetIds.length !== 1 ? 's' : ''} from every garment type of its
                gender? Any workflow/prompt override per garment type is kept, and you can re-map
                individual types afterward.
              </p>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => {
                  closeConfirm();
                  setConfirmUnmapPoseAssetIds([]);
                }}
              >
                Cancel
              </button>
              <button
                className="btn"
                disabled={bulkUnmapSaving}
                onClick={() => void doUnmapAllGarmentTypes()}
              >
                {bulkUnmapSaving ? 'Unmapping…' : `Unmap ${confirmUnmapPoseAssetIds.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk map to garment types */}
      {showBulkGarmentMap && (
        <div className="modal-overlay" onClick={() => !bulkGarmentSaving && closeModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <h3>
                Map {selectedPoseAssetIds.length} pose{selectedPoseAssetIds.length !== 1 ? 's' : ''}{' '}
                to garment types
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                Select garment types, then show or hide the selected poses on them. A pose already
                shows on every garment type of its gender by default.
              </p>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {bulkGarmentLoading ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Loading garment types…</p>
              ) : bulkGarmentTypeOptions.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                  No garment types found for the selected poses.
                </p>
              ) : (
                <>
                  <button
                    className="btn sm ghost"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() =>
                      setBulkGarmentTypeIds((prev) =>
                        prev.length === bulkGarmentTypeOptions.length
                          ? []
                          : bulkGarmentTypeOptions.map((g) => g.id),
                      )
                    }
                  >
                    {bulkGarmentTypeIds.length === bulkGarmentTypeOptions.length
                      ? 'Deselect all'
                      : 'Select all'}
                  </button>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      maxHeight: 280,
                      overflowY: 'auto',
                    }}
                  >
                    {bulkGarmentTypeOptions.map((g) => (
                      <label
                        key={g.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: 'var(--surface-2)',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={bulkGarmentTypeIds.includes(g.id)}
                          onChange={(e) =>
                            setBulkGarmentTypeIds((prev) =>
                              e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id),
                            )
                          }
                        />
                        {g.label}
                        {g.genderSlug && (
                          <span className="badge dot accent" style={{ fontSize: 10 }}>
                            {g.genderSlug}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" disabled={bulkGarmentSaving} onClick={closeModal}>
                Cancel
              </button>
              <button
                className="btn ghost"
                disabled={bulkGarmentSaving || bulkGarmentTypeIds.length === 0}
                onClick={() => void doBulkGarmentMap(false)}
              >
                {bulkGarmentSaving ? 'Saving…' : `Hide from ${bulkGarmentTypeIds.length}`}
              </button>
              <button
                className="btn"
                disabled={bulkGarmentSaving || bulkGarmentTypeIds.length === 0}
                onClick={() => void doBulkGarmentMap(true)}
              >
                {bulkGarmentSaving ? 'Saving…' : `Map to ${bulkGarmentTypeIds.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk rename display name */}
      {showBulkRename && (
        <div className="modal-overlay" onClick={() => !bulkRenaming && closeModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-head">
              <h3>
                Rename {selectedPoseAssetIds.length} pose asset
                {selectedPoseAssetIds.length !== 1 ? 's' : ''}
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                Sets the display name on all selected assets.
              </p>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                Display name
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Standing Front"
                  value={bulkRenameDisplayName}
                  disabled={bulkRenaming}
                  onChange={(e) => setBulkRenameDisplayName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && bulkRenameDisplayName.trim() && !bulkRenaming) {
                      e.preventDefault();
                      await dosBulkRename();
                    }
                  }}
                />
              </label>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" disabled={bulkRenaming} onClick={closeModal}>
                Cancel
              </button>
              <button
                className="btn"
                disabled={bulkRenaming || !bulkRenameDisplayName.trim()}
                onClick={dosBulkRename}
              >
                {bulkRenaming ? 'Renaming…' : `Rename ${selectedPoseAssetIds.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk import ZIP */}
      {showBulkImport && (
        <div
          className="modal-overlay"
          onClick={() => !(bulkImporting && bulkImportPhase === 'processing') && closeModal()}
        >
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
                <SearchableSelect
                  options={[
                    { id: 'men', label: 'Men' },
                    { id: 'women', label: 'Women' },
                    { id: 'boys', label: 'Boys' },
                    { id: 'girls', label: 'Girls' },
                  ]}
                  value={bulkImportGender}
                  onChange={(v) => setBulkImportGender(v as GenderSlug)}
                  disabled={bulkImporting}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  Workflow template
                </label>
                <SearchableSelect
                  options={workflows}
                  value={bulkImportWorkflowId}
                  onChange={setBulkImportWorkflowId}
                  disabled={bulkImporting}
                  placeholder="— search workflow —"
                />
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                ZIP must contain <code>poses/</code> folder with pose images. Filenames become the
                dedup label.
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
                    <span>
                      {bulkImportPhase === 'uploading'
                        ? 'Uploading…'
                        : bulkImportCounts
                          ? `Processing ${bulkImportCounts.phase} (${bulkImportCounts.done}/${bulkImportCounts.total})…`
                          : 'Processing ZIP…'}
                    </span>
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
                disabled={bulkImporting && bulkImportPhase === 'processing'}
                onClick={() => {
                  if (bulkImportXhrRef.current) {
                    bulkImportXhrRef.current.abort();
                    bulkImportXhrRef.current = null;
                  }
                  closeModal();
                }}
              >
                Cancel
              </button>
              <button
                className="btn"
                disabled={bulkImporting || !bulkImportFile || !bulkImportWorkflowId}
                onClick={() => {
                  if (!bulkImportFile || !bulkImportWorkflowId) return;
                  setBulkImporting(true);
                  setBulkImportProgress(0);
                  setBulkImportPhase('uploading');
                  setBulkImportCounts(null);
                  const fd = new FormData();
                  fd.append('workflowTemplateId', bulkImportWorkflowId);
                  fd.append('genderSlug', bulkImportGender);
                  fd.append('zip', bulkImportFile);
                  const tok = getToken();
                  const xhr = new XMLHttpRequest();
                  bulkImportXhrRef.current = xhr;
                  xhr.open('POST', '/admin/assets/bulk-import');
                  if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);
                  xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable)
                      setBulkImportProgress(Math.round((e.loaded / e.total) * 100));
                  };
                  xhr.upload.onload = () => {
                    setBulkImportPhase('processing');
                    setBulkImportProgress(0);
                  };
                  let lastLen = 0;
                  xhr.onprogress = () => {
                    const newText = xhr.responseText.slice(lastLen);
                    lastLen = xhr.responseText.length;
                    for (const line of newText.split('\n').filter(Boolean)) {
                      try {
                        const msg = JSON.parse(line) as {
                          phase?: string;
                          done?: number;
                          total?: number;
                        };
                        if (msg.phase && msg.done !== undefined && msg.total !== undefined) {
                          setBulkImportCounts({
                            phase: msg.phase,
                            done: msg.done,
                            total: msg.total,
                          });
                          setBulkImportProgress(Math.round((msg.done / msg.total) * 100));
                        }
                      } catch {
                        /* partial line — ignore */
                      }
                    }
                  };
                  xhr.onload = async () => {
                    bulkImportXhrRef.current = null;
                    setBulkImporting(false);
                    setBulkImportPhase('uploading');
                    setBulkImportCounts(null);
                    if (xhr.status >= 200 && xhr.status < 300) {
                      const lines = xhr.responseText.split('\n').filter(Boolean);
                      const result = JSON.parse(lines[lines.length - 1] ?? '{}') as {
                        done?: boolean;
                        created: { faces: number; backgrounds: number; poses: number };
                        errors: string[];
                      };
                      closeModal();
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
                      await loadPoseAssets();
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
                    bulkImportXhrRef.current = null;
                    setBulkImporting(false);
                    setBulkImportPhase('uploading');
                    setBulkImportCounts(null);
                    toast({ kind: 'error', title: 'Bulk import failed', body: 'Network error' });
                  };
                  xhr.onabort = () => {
                    bulkImportXhrRef.current = null;
                    setBulkImporting(false);
                    setBulkImportPhase('uploading');
                    setBulkImportProgress(0);
                    setBulkImportCounts(null);
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
          onDone={() => {
            closeModal();
            void loadPoseAssets();
          }}
          onClose={closeModal}
          toast={toast}
        />
      )}

      {editingPoseAsset && (
        <EditPoseAssetModal
          asset={editingPoseAsset}
          workflows={workflows}
          onSaved={(updated) => {
            setPoseAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
          }}
          onClose={() => {
            closeModal();
            // Garment-type visibility toggles inside the modal write directly via
            // their own PATCH calls (not through onSaved), so refetch to pick up
            // any visibleGarmentTypeCount/totalGarmentTypeCount change for this pose.
            void loadPoseAssets();
          }}
          toast={toast}
        />
      )}
    </>
  );
}
