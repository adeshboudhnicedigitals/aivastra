import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BackgroundUploadModal } from '../components/BackgroundUploadModal';
import { BatchCatalogUploadModal } from '../components/BatchCatalogUploadModal';
import { EditBackgroundModal } from '../components/EditBackgroundModal';
import { EditFaceModal } from '../components/EditFaceModal';
import { EditPoseAssetModal } from '../components/EditPoseAssetModal';

import { Icon } from '../components/Icons';
import { Pager } from '../components/Pager';
import { PoseUploadModal } from '../components/PoseUploadModal';
import { Switch } from '../components/Switch';
import type { SortDir } from '../components/Th';
import { Th } from '../components/Th';
import type { FieldDef } from '../components/UploadModal';
import { UploadModal } from '../components/UploadModal';
import { useAuth } from '../context/AuthContext';
import { apiFetch, getToken } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type {
  CatalogItem,
  GarmentType,
  GenderSlug,
  ModelBackground,
  ModelFace,
  ModelPose,
  ModelPoseAsset,
  WorkflowOption,
} from '../types';

type AssetTab = 'garment-types' | 'faces' | 'backgrounds' | 'lower' | 'shoe' | 'pose-assets';
type GenderFilter = 'all' | GenderSlug;

type SubView = { kind: 'list' } | { kind: 'garment-type'; sub: GarmentType };

type ConfirmDelete =
  | { type: 'background'; id: string; label: string }
  | { type: 'face'; id: string; label: string }
  | { type: 'garment-type'; id: string; label: string }
  | { type: 'pose'; id: string; label: string };

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

const FACE_FIELDS: FieldDef[] = [
  {
    type: 'text',
    name: 'label',
    label: 'Label',
    required: true,
    placeholder: 'e.g. Model 1 — Men',
  },
  {
    type: 'select',
    name: 'gender',
    label: 'Gender',
    options: [
      { value: 'men', label: 'Men' },
      { value: 'women', label: 'Women' },
      { value: 'boys', label: 'Boys' },
      { value: 'girls', label: 'Girls' },
    ],
  },
  {
    type: 'number',
    name: 'sortOrder',
    label: 'Sort order (lower = first)',
    min: 0,
    defaultValue: 0,
  },
];

function AssetThumb({
  thumbnailKey,
  r2Key,
  label,
  w = 64,
  h = 64,
  storageBase,
  onPreview,
}: {
  thumbnailKey?: string;
  r2Key?: string;
  label: string;
  w?: number;
  h?: number;
  storageBase: string | null;
  onPreview?: (url: string) => void;
}) {
  const src = thumbnailKey && storageBase ? `${storageBase}/${thumbnailKey}` : null;
  const fullUrl = r2Key && storageBase ? `${storageBase}/${r2Key}` : null;
  if (src) {
    const img = (
      <img
        src={src}
        alt={label}
        loading="lazy"
        style={{
          width: w,
          height: h,
          objectFit: 'cover',
          borderRadius: 6,
          flexShrink: 0,
          display: 'block',
          cursor: fullUrl ? 'zoom-in' : undefined,
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
    return fullUrl ? (
      <a
        href={fullUrl}
        rel="noreferrer"
        style={{ flexShrink: 0 }}
        onClick={(e) => {
          e.preventDefault();
          onPreview?.(src);
        }}
      >
        {img}
      </a>
    ) : (
      img
    );
  }
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 6,
        background: 'var(--subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: 'var(--muted)',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function AssetsPage({ onNav: _onNav, toast }: Props) {
  const { storagePublicUrl } = useAuth();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const VALID_TABS: AssetTab[] = [
    'garment-types',
    'faces',
    'backgrounds',
    'lower',
    'shoe',
    'pose-assets',
  ];
  const rawTab = searchParams.get('tab') as AssetTab | null;
  const activeTab: AssetTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'garment-types';
  const setActiveTab = (tab: AssetTab) => setSearchParams({ tab }, { replace: true });
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [subView, setSubView] = useState<SubView>({ kind: 'list' });

  const [backgrounds, setBackgrounds] = useState<ModelBackground[]>([]);
  const [allBackgrounds, setAllBackgrounds] = useState<ModelBackground[]>([]);
  const [faces, setFaces] = useState<ModelFace[]>([]);
  const [garmentTypes, setGarmentTypes] = useState<GarmentType[]>([]);
  const [poses, setPoses] = useState<ModelPose[]>([]);
  const [poseAssets, setPoseAssets] = useState<ModelPoseAsset[]>([]);
  const [confirmDeletePoseAssetId, setConfirmDeletePoseAssetId] = useState<string | null>(null);
  const [selectedPoseAssetIds, setSelectedPoseAssetIds] = useState<string[]>([]);
  const [confirmBulkDeletePoseAssetIds, setConfirmBulkDeletePoseAssetIds] = useState<string[]>([]);
  const [selectedBgIds, setSelectedBgIds] = useState<string[]>([]);
  const [confirmBulkDeleteBgIds, setConfirmBulkDeleteBgIds] = useState<string[]>([]);
  const [selectedFaceIds, setSelectedFaceIds] = useState<string[]>([]);
  const [confirmBulkDeleteFaceIds, setConfirmBulkDeleteFaceIds] = useState<string[]>([]);

  // Upload pose asset state
  const [showPoseAssetUpload, setShowPoseAssetUpload] = useState(false);

  // Edit pose asset state
  const [editingPoseAsset, setEditingPoseAsset] = useState<ModelPoseAsset | null>(null);

  // Map pose asset state
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

  // Bulk-map selected pose assets
  const [showBulkMap, setShowBulkMap] = useState(false);
  const [bulkMapGarmentTypeIds, setBulkMapGarmentTypeIds] = useState<Set<string>>(new Set());
  const [bulkMapping, setBulkMapping] = useState(false);
  const [bulkMapProgress, setBulkMapProgress] = useState(0);
  const [bulkMapTotal, setBulkMapTotal] = useState(0);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [filterFace, setFilterFace] = useState('');
  const [filterBg, setFilterBg] = useState('');
  const [filterPose, setFilterPose] = useState('');
  const [poseSearch, setPoseSearch] = useState('');
  const [poseSortKey, setPoseSortKey] = useState<'label' | 'sortOrder' | 'createdAt'>('label');
  const [poseSortDir, setPoseSortDir] = useState<'asc' | 'desc'>('asc');
  const [posePage, setPosePage] = useState(1);

  // Pose-asset tab filters
  const [paFilterFace, setPaFilterFace] = useState('');
  const [paFilterBg, setPaFilterBg] = useState('');
  const [paFilterWorkflow, setPaFilterWorkflow] = useState('');
  const [paFilterPose, setPaFilterPose] = useState('');
  const [paSearch, setPaSearch] = useState('');
  const [paSortKey, setPaSortKey] = useState<'label' | 'createdAt'>('label');
  const [paSortDir, setPaSortDir] = useState<'asc' | 'desc'>('asc');
  const [paPage, setPaPage] = useState(1);
  const [showSubcatModal, setShowSubcatModal] = useState(false);
  const [subcatForm, setSubcatForm] = useState({
    slug: '',
    label: '',
    genderSlug: 'men' as GenderSlug,
    requiresLowerUpload: false,
  });
  const [subcatSaving, setSubcatSaving] = useState(false);
  const [subcatImageFile, setSubcatImageFile] = useState<File | null>(null);

  const [editingSubcat, setEditingSubcat] = useState<GarmentType | null>(null);
  const [editSubcatImageFile, setEditSubcatImageFile] = useState<File | null>(null);
  const [editSubcatSaving, setEditSubcatSaving] = useState(false);
  const [editSubcatLabel, setEditSubcatLabel] = useState('');
  const [editSubcatRequiresLowerUpload, setEditSubcatRequiresLowerUpload] = useState(false);

  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete | null>(null);

  const [showBgUpload, setShowBgUpload] = useState(false);
  const [showFaceUpload, setShowFaceUpload] = useState(false);

  const [selectedPoseIds, setSelectedPoseIds] = useState<string[]>([]);
  const [confirmBulkDeletePoseIds, setConfirmBulkDeletePoseIds] = useState<string[]>([]);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkImportGender, setBulkImportGender] = useState<GenderSlug>('men');
  const [bulkImportWorkflowId, setBulkImportWorkflowId] = useState('');
  const [bulkImportFile, setBulkImportFile] = useState<File | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState(0);
  const bulkImportRef = useRef<HTMLInputElement>(null);
  const [editingBackground, setEditingBackground] = useState<ModelBackground | null>(null);
  const [editingFace, setEditingFace] = useState<ModelFace | null>(null);

  // Catalog (lower / shoe) state
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogPage, setCatalogPage] = useState(0);
  const [catalogSortKey, setCatalogSortKey] = useState<keyof CatalogItem>('sortOrder');
  const [catalogSortDir, setCatalogSortDir] = useState<SortDir>('asc');
  const [confirmDeleteCatalog, setConfirmDeleteCatalog] = useState<string | null>(null);
  const [showCatalogUpload, setShowCatalogUpload] = useState(false);
  const [editingCatalogItem, setEditingCatalogItem] = useState<CatalogItem | null>(null);
  const [editCatalogGender, setEditCatalogGender] = useState<string>('men');
  const [editCatalogSubcatIds, setEditCatalogSubcatIds] = useState<string[]>([]);
  const [editCatalogLabel, setEditCatalogLabel] = useState('');
  const [editCatalogSaving, setEditCatalogSaving] = useState(false);
  const [catalogReplaceFile, setCatalogReplaceFile] = useState<File | null>(null);
  const [catalogReplacePreview, setCatalogReplacePreview] = useState<string | null>(null);
  const [catalogReplaceUploading, setCatalogReplaceUploading] = useState(false);
  const catalogReplaceRef = useRef<HTMLInputElement>(null);

  const loadBackgrounds = useCallback(
    async (genderSlug?: string) => {
      setLoading(true);
      try {
        const qs = genderSlug ? `?genderSlug=${genderSlug}` : '';
        const res = await apiFetch<{ items: ModelBackground[] }>(`/admin/assets/backgrounds${qs}`);
        setBackgrounds(res.items);
        if (!genderSlug) setAllBackgrounds(res.items);
      } catch {
        toast({ kind: 'error', title: 'Failed to load backgrounds' });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  const loadFaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ModelFace[] }>('/admin/assets/faces');
      setFaces(res.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load faces' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadGarmentTypes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: GarmentType[] }>('/admin/assets/garment-types');
      setGarmentTypes(res.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load garment types' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

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
  }, [toast]);

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
    [toast],
  );

  const loadCatalog = useCallback(
    async (genderSlug?: string) => {
      setLoading(true);
      try {
        const qs = genderSlug ? `?genderSlug=${genderSlug}` : '';
        const items = await apiFetch<CatalogItem[]>(`/admin/catalog/items${qs}`);
        setCatalogItems(items);
      } catch {
        toast({ kind: 'error', title: 'Failed to load catalog' });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    const g = genderFilter === 'all' ? undefined : genderFilter;
    if (activeTab === 'backgrounds') {
      loadBackgrounds(g);
    } else if (activeTab === 'faces') loadFaces();
    else if (activeTab === 'lower' || activeTab === 'shoe') loadCatalog(g);
    else if (activeTab === 'pose-assets') {
      loadPoseAssets();
      loadGarmentTypes();
    } else if (activeTab === 'garment-types') {
      if (subView.kind === 'list') loadGarmentTypes();
      else loadGarmentTypeAssets(subView.sub.id);
    }
  }, [
    activeTab,
    genderFilter,
    subView,
    loadBackgrounds,
    loadFaces,
    loadGarmentTypes,
    loadGarmentTypeAssets,
    loadCatalog,
    loadPoseAssets,
  ]);

  // Preload faces + backgrounds silently so upload selects + filters are populated
  useEffect(() => {
    apiFetch<{ items: ModelFace[] }>('/admin/assets/faces')
      .then((r) => setFaces(r.items))
      .catch(() => {});
    apiFetch<{ items: ModelBackground[] }>('/admin/assets/backgrounds')
      .then((r) => setAllBackgrounds(r.items))
      .catch(() => {});
    apiFetch<CatalogItem[]>('/admin/catalog/items')
      .then((items) => setCatalogItems(items))
      .catch(() => {});
    apiFetch<{ items: GarmentType[] }>('/admin/assets/garment-types')
      .then((r) => setGarmentTypes(r.items))
      .catch(() => {});
  }, []);

  // Reset to page 1 whenever filters or sort change
  useEffect(() => {
    setPaPage(1);
  }, [
    paFilterFace,
    paFilterBg,
    paFilterWorkflow,
    paFilterPose,
    paSearch,
    paSortKey,
    paSortDir,
    genderFilter,
  ]);

  useEffect(() => {
    setPosePage(1);
  }, [filterFace, filterBg, filterPose, poseSearch, poseSortKey, poseSortDir]);

  const toggleBg = async (id: string) => {
    const item = backgrounds.find((b) => b.id === id);
    if (!item) return;
    const next = !item.isActive;
    setBackgrounds((prev) => prev.map((b) => (b.id === id ? { ...b, isActive: next } : b)));
    try {
      await apiFetch(`/admin/assets/backgrounds/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      toast({ title: `${item.label} ${item.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setBackgrounds((prev) =>
        prev.map((b) => (b.id === id ? { ...b, isActive: item.isActive } : b)),
      );
      toast({ kind: 'error', title: 'Failed to update background' });
    }
  };

  const toggleFace = async (id: string) => {
    const item = faces.find((f) => f.id === id);
    if (!item) return;
    const next = !item.isActive;
    setFaces((prev) => prev.map((f) => (f.id === id ? { ...f, isActive: next } : f)));
    try {
      await apiFetch(`/admin/assets/faces/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      toast({ title: `${item.label} ${item.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setFaces((prev) => prev.map((f) => (f.id === id ? { ...f, isActive: item.isActive } : f)));
      toast({ kind: 'error', title: 'Failed to update face' });
    }
  };

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
    const paths: Record<typeof type, string> = {
      background: `/admin/assets/backgrounds/${id}`,
      face: `/admin/assets/faces/${id}`,
      'garment-type': `/admin/assets/garment-types/${id}`,
      pose: `/admin/assets/poses/${id}?force=true`,
    };
    try {
      await apiFetch(paths[type], { method: 'DELETE' });
      if (type === 'background') setBackgrounds((prev) => prev.filter((b) => b.id !== id));
      else if (type === 'face') setFaces((prev) => prev.filter((f) => f.id !== id));
      else if (type === 'garment-type') {
        setGarmentTypes((prev) => prev.filter((s) => s.id !== id));
        setSubView({ kind: 'list' });
      } else if (type === 'pose') setPoses((prev) => prev.filter((p) => p.id !== id));
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

  const doBulkDeletePoseAssets = async () => {
    const ids = confirmBulkDeletePoseAssetIds;
    setConfirmBulkDeletePoseAssetIds([]);
    if (ids.length === 0) return;
    try {
      const res = await apiFetch<{ deleted: number }>('/admin/assets/pose-assets', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      setPoseAssets((prev) => prev.filter((a) => !ids.includes(a.id)));
      setSelectedPoseAssetIds((prev) => prev.filter((id) => !ids.includes(id)));
      toast({ title: `Deleted ${res.deleted} pose asset${res.deleted !== 1 ? 's' : ''}` });
    } catch {
      toast({ kind: 'error', title: 'Bulk delete failed' });
    }
  };

  const doBulkDeleteFaces = async () => {
    const ids = confirmBulkDeleteFaceIds;
    setConfirmBulkDeleteFaceIds([]);
    if (ids.length === 0) return;
    try {
      const res = await apiFetch<{ deleted: number }>('/admin/assets/faces', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      setFaces((prev) => prev.filter((f) => !ids.includes(f.id)));
      setSelectedFaceIds((prev) => prev.filter((id) => !ids.includes(id)));
      toast({ title: `Deleted ${res.deleted} face${res.deleted !== 1 ? 's' : ''}` });
    } catch {
      toast({ kind: 'error', title: 'Bulk delete failed' });
    }
  };

  const doBulkDeleteBackgrounds = async () => {
    const ids = confirmBulkDeleteBgIds;
    setConfirmBulkDeleteBgIds([]);
    if (ids.length === 0) return;
    try {
      const res = await apiFetch<{ deleted: number }>('/admin/assets/backgrounds', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      setBackgrounds((prev) => prev.filter((b) => !ids.includes(b.id)));
      setSelectedBgIds((prev) => prev.filter((id) => !ids.includes(id)));
      toast({ title: `Deleted ${res.deleted} background${res.deleted !== 1 ? 's' : ''}` });
    } catch {
      toast({ kind: 'error', title: 'Bulk delete failed' });
    }
  };

  const setAmazonWhiteBg = async (id: string) => {
    const prev = backgrounds.find((b) => b.isWhiteBg);
    // Optimistic update: set the selected one as white, unset all others
    setBackgrounds((prevBg) => prevBg.map((b) => ({ ...b, isWhiteBg: b.id === id })));
    try {
      await apiFetch(`/admin/assets/backgrounds/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isWhiteBg: true }),
      });
      const item = backgrounds.find((b) => b.id === id);
      toast({ title: `${item?.label ?? 'Background'} set as Amazon white background` });
    } catch {
      // Rollback
      setBackgrounds((prevBg) =>
        prevBg.map((b) => ({ ...b, isWhiteBg: prev != null && prev.id === b.id })),
      );
      toast({ kind: 'error', title: 'Failed to set Amazon white background' });
    }
  };

  const T = (
    item: { thumbnailKey: string; r2Key?: string; label: string },
    w?: number,
    h?: number,
  ) => (
    <AssetThumb
      thumbnailKey={item.thumbnailKey}
      r2Key={item.r2Key}
      label={item.label}
      w={w}
      h={h}
      storageBase={storagePublicUrl}
      onPreview={setPreviewUrl}
    />
  );

  const TABS: { k: AssetTab; l: string }[] = [
    { k: 'garment-types', l: 'Garment Types' },
    { k: 'faces', l: 'Model Faces' },
    { k: 'backgrounds', l: 'Backgrounds' },
    { k: 'pose-assets', l: 'Pose Assets' },
    { k: 'lower', l: 'Lower garments' },
    { k: 'shoe', l: 'Shoes' },
  ];

  const GENDER_TABS: { k: GenderFilter; l: string }[] = [
    { k: 'all', l: 'All' },
    { k: 'men', l: 'Men' },
    { k: 'women', l: 'Women' },
    { k: 'boys', l: 'Boys' },
    { k: 'girls', l: 'Girls' },
  ];

  const filteredFaces = faces.filter((f) => genderFilter === 'all' || f.gender === genderFilter);
  const filteredGarmentTypes = garmentTypes.filter(
    (s) => genderFilter === 'all' || s.genderSlug === genderFilter,
  );
  const filteredPoseAssets = poseAssets
    .filter((a) => {
      if (genderFilter !== 'all' && a.genderSlug !== genderFilter) return false;
      if (paFilterFace && a.faceId !== paFilterFace) return false;
      if (paFilterBg && a.backgroundId !== paFilterBg) return false;
      if (paFilterWorkflow && a.workflowTemplateId !== paFilterWorkflow) return false;
      if (paFilterPose && a.poseVariant !== paFilterPose) return false;
      if (paSearch) {
        const q = paSearch.toLowerCase();
        const matchLabel = a.label.toLowerCase().includes(q);
        const matchDisplay = a.displayName?.toLowerCase().includes(q) ?? false;
        if (!matchLabel && !matchDisplay) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (paSortKey === 'label') cmp = a.label.localeCompare(b.label);
      else cmp = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      return paSortDir === 'asc' ? cmp : -cmp;
    });

  const PA_PAGE_SIZE = 50;
  const paTotalPages = Math.max(1, Math.ceil(filteredPoseAssets.length / PA_PAGE_SIZE));
  const paClampedPage = Math.min(paPage, paTotalPages);
  const pagedPoseAssets = filteredPoseAssets.slice(
    (paClampedPage - 1) * PA_PAGE_SIZE,
    paClampedPage * PA_PAGE_SIZE,
  );

  // Face / bg / workflow options for pose-asset filters (only IDs that appear in current gender slice)
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

  // Poses available in current face×bg cell (for 3rd-dimension selector)
  const posesInCell = poses.filter(
    (p) => (!filterFace || p.faceId === filterFace) && (!filterBg || p.backgroundId === filterBg),
  );

  // Filtered poses for grid
  const visiblePoses = posesInCell
    .filter((p) => !filterPose || p.id === filterPose)
    .filter((p) => !poseSearch || p.label.toLowerCase().includes(poseSearch.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (poseSortKey === 'label') cmp = a.label.localeCompare(b.label);
      else if (poseSortKey === 'sortOrder') cmp = a.sortOrder - b.sortOrder;
      else cmp = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      return poseSortDir === 'asc' ? cmp : -cmp;
    });

  const POSE_PAGE_SIZE = 50;
  const poseTotalPages = Math.max(1, Math.ceil(visiblePoses.length / POSE_PAGE_SIZE));
  const poseClampedPage = Math.min(posePage, poseTotalPages);
  const pagedPoses = visiblePoses.slice(
    (poseClampedPage - 1) * POSE_PAGE_SIZE,
    poseClampedPage * POSE_PAGE_SIZE,
  );

  // Faces valid given current bg filter; backgrounds valid given current face filter
  const usedFaceIds = new Set(
    poses.filter((p) => !filterBg || p.backgroundId === filterBg).map((p) => p.faceId),
  );
  const usedBgIds = new Set(
    poses.filter((p) => !filterFace || p.faceId === filterFace).map((p) => p.backgroundId),
  );
  const poseFaces = faces.filter((f) => usedFaceIds.has(f.id));
  const poseBgs = allBackgrounds.filter((b) => usedBgIds.has(b.id));

  // Catalog coverage for the current garment-type subcategory
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
          <h1>
            {activeTab === 'backgrounds'
              ? 'Backgrounds'
              : activeTab === 'faces'
                ? 'Model Faces'
                : activeTab === 'pose-assets'
                  ? 'Pose Assets'
                  : activeTab === 'lower'
                    ? 'Lower garments'
                    : activeTab === 'shoe'
                      ? 'Shoes'
                      : subView.kind === 'garment-type'
                        ? subView.sub.label
                        : 'Garment Types'}
          </h1>
          <p className="lede">
            {activeTab === 'backgrounds' &&
              'Global backgrounds sent to ComfyUI for all garment types.'}
            {activeTab === 'faces' && 'Model face images — select gender to filter.'}
            {activeTab === 'pose-assets' &&
              'Centralised pose image assets. Delete here removes R2 objects. Remove all garment-type mappings first.'}
            {activeTab === 'garment-types' &&
              subView.kind === 'list' &&
              'Garment types. Click to manage assets.'}
            {activeTab === 'garment-types' &&
              subView.kind === 'garment-type' &&
              `Assets for ${subView.sub.genderSlug} / ${subView.sub.slug}. Filter by face or background to slice the tensor.`}
            {(activeTab === 'lower' || activeTab === 'shoe') &&
              'Optional add-ons shown when pose permits.'}
          </p>
        </div>
        <div className="head-tools">
          {activeTab === 'backgrounds' && (
            <button className="btn" onClick={() => setShowBgUpload(true)}>
              <Icon.Add /> Add background
            </button>
          )}
          {activeTab === 'faces' && (
            <button className="btn" onClick={() => setShowFaceUpload(true)}>
              <Icon.Add /> Add face
            </button>
          )}
          {activeTab === 'garment-types' && subView.kind === 'list' && (
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
          )}

          {activeTab === 'pose-assets' && (
            <>
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
            </>
          )}
          {(activeTab === 'lower' || activeTab === 'shoe') && (
            <button className="btn" onClick={() => setShowCatalogUpload(true)}>
              <Icon.Add /> Add item
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.k}
            className={`tab ${activeTab === t.k ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(t.k);
              setSubView({ kind: 'list' });
              setSelectedPoseAssetIds([]);
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>Loading…</div>
      )}

      {!loading && activeTab === 'backgrounds' && (
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
              marginBottom: 8,
              flexWrap: 'wrap',
            }}
          >
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              {backgrounds.length} background{backgrounds.length !== 1 ? 's' : ''}
            </p>
            {backgrounds.length > 0 && (
              <button
                className="btn sm ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  const allSelected = backgrounds.every((b) => selectedBgIds.includes(b.id));
                  setSelectedBgIds(allSelected ? [] : backgrounds.map((b) => b.id));
                }}
              >
                {backgrounds.every((b) => selectedBgIds.includes(b.id))
                  ? 'Deselect all'
                  : 'Select all'}
              </button>
            )}
            {selectedBgIds.length > 0 && (
              <button
                className="btn sm danger"
                onClick={() => setConfirmBulkDeleteBgIds([...selectedBgIds])}
              >
                <Icon.Trash /> Delete selected ({selectedBgIds.length})
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Label</th>
                  <th>Gender</th>
                  <th>Amazon</th>
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {backgrounds.map((bg) => (
                  <tr key={bg.id} style={{ opacity: bg.isActive ? 1 : 0.6 }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedBgIds.includes(bg.id)}
                        onChange={(e) =>
                          setSelectedBgIds((prev) =>
                            e.target.checked ? [...prev, bg.id] : prev.filter((id) => id !== bg.id),
                          )
                        }
                        style={{ accentColor: 'var(--pink)', cursor: 'pointer' }}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {T(bg, 40, 30)}
                        <div>
                          <span className="semi">{bg.label}</span>
                          <span className="sub mono" style={{ display: 'block' }}>
                            {bg.id.slice(0, 8)}…
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge dot">{(bg as any).genderSlug ?? 'all'}</span>
                    </td>
                    <td>
                      <button
                        className={`btn sm ${bg.isWhiteBg ? 'primary' : 'ghost'}`}
                        onClick={() => setAmazonWhiteBg(bg.id)}
                        title={
                          bg.isWhiteBg
                            ? 'Amazon white background (selected)'
                            : 'Set as Amazon white background'
                        }
                      >
                        {bg.isWhiteBg ? (
                          <>
                            <span style={{ color: 'var(--success)', marginRight: 4 }}>&#9733;</span>
                            White BG
                          </>
                        ) : (
                          'Set White BG'
                        )}
                      </button>
                    </td>
                    <td>
                      <Switch checked={bg.isActive} onChange={() => toggleBg(bg.id)} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn sm ghost" onClick={() => setEditingBackground(bg)}>
                          <Icon.Edit />
                        </button>
                        <button
                          className="btn sm ghost"
                          onClick={() =>
                            setConfirmDelete({ type: 'background', id: bg.id, label: bg.label })
                          }
                        >
                          <Icon.Trash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {backgrounds.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                    >
                      No backgrounds yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && activeTab === 'faces' && (
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
              marginBottom: 4,
              flexWrap: 'wrap',
            }}
          >
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              {filteredFaces.length} face{filteredFaces.length !== 1 ? 's' : ''}
            </p>
            {filteredFaces.length > 0 && (
              <button
                className="btn sm ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  const allSelected = filteredFaces.every((f) => selectedFaceIds.includes(f.id));
                  setSelectedFaceIds(allSelected ? [] : filteredFaces.map((f) => f.id));
                }}
              >
                {filteredFaces.every((f) => selectedFaceIds.includes(f.id))
                  ? 'Deselect all'
                  : 'Select all'}
              </button>
            )}
            {selectedFaceIds.length > 0 && (
              <button
                className="btn sm danger"
                onClick={() => setConfirmBulkDeleteFaceIds([...selectedFaceIds])}
              >
                <Icon.Trash /> Delete selected ({selectedFaceIds.length})
              </button>
            )}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 14,
              marginTop: 10,
            }}
          >
            {filteredFaces.map((face) => (
              <div
                key={face.id}
                className="card"
                style={{
                  opacity: face.isActive ? 1 : 0.6,
                  padding: 14,
                  outline: selectedFaceIds.includes(face.id) ? '2px solid var(--pink)' : undefined,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={selectedFaceIds.includes(face.id)}
                    onChange={(e) =>
                      setSelectedFaceIds((prev) =>
                        e.target.checked ? [...prev, face.id] : prev.filter((id) => id !== face.id),
                      )
                    }
                    style={{
                      accentColor: 'var(--pink)',
                      cursor: 'pointer',
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  />
                  {T(face, 48, 64)}
                  <div style={{ marginTop: 4 }}>
                    <span className="semi">{face.label}</span>
                    <div style={{ marginTop: 4 }}>
                      <span className="badge dot accent">{face.gender}</span>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <Switch checked={face.isActive} onChange={() => toggleFace(face.id)} />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn sm ghost" onClick={() => setEditingFace(face)}>
                      <Icon.Edit />
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() =>
                        setConfirmDelete({ type: 'face', id: face.id, label: face.label })
                      }
                    >
                      <Icon.Trash />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {filteredFaces.length === 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  color: 'var(--muted)',
                  padding: '2rem',
                }}
              >
                No faces found.
              </div>
            )}
          </div>
        </>
      )}

      {!loading && activeTab === 'garment-types' && subView.kind === 'list' && (
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

      {!loading && activeTab === 'garment-types' && subView.kind === 'garment-type' && (
        <>
          {/* Face × background × pose filter bar */}
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
              {posesInCell
                .slice()
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
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
                <button
                  className="btn sm danger"
                  onClick={() => setConfirmBulkDeletePoseIds([...selectedPoseIds])}
                >
                  <Icon.Trash /> Delete selected ({selectedPoseIds.length})
                </button>
              )}
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 10px' }}>
            {visiblePoses.length}/{poses.length} poses
            {poseTotalPages > 1 && ` · page ${poseClampedPage}/${poseTotalPages}`}
          </p>

          {/* Pose grid */}
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
                      {T(pose, 64, 88)}
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
                            title="Workflow requires lower garment but no lower items assigned to this garment type"
                          >
                            ⚠ lower missing
                          </span>
                        )}
                        {missingShoe && (
                          <span
                            className="badge dot"
                            style={{ background: '#fef3c7', color: '#92400e' }}
                            title="Workflow requires shoes but no shoe items assigned to this garment type"
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 16,
                justifyContent: 'center',
              }}
            >
              <button
                className="btn sm ghost"
                disabled={poseClampedPage <= 1}
                onClick={() => setPosePage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Page {poseClampedPage} / {poseTotalPages}
              </span>
              <button
                className="btn sm ghost"
                disabled={poseClampedPage >= poseTotalPages}
                onClick={() => setPosePage((p) => Math.min(poseTotalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {!loading && activeTab === 'pose-assets' && (
        <>
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
                  <Icon.Trash /> Delete selected ({selectedPoseAssetIds.length})
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
                      <Icon.Trash /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {paTotalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 16,
                justifyContent: 'center',
              }}
            >
              <button
                className="btn sm ghost"
                disabled={paClampedPage <= 1}
                onClick={() => setPaPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Page {paClampedPage} / {paTotalPages}
              </span>
              <button
                className="btn sm ghost"
                disabled={paClampedPage >= paTotalPages}
                onClick={() => setPaPage((p) => Math.min(paTotalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {!loading &&
        (activeTab === 'lower' || activeTab === 'shoe') &&
        (() => {
          const filtered = catalogItems.filter(
            (c) =>
              c.type === activeTab &&
              (!catalogQuery ||
                c.label.toLowerCase().includes(catalogQuery.toLowerCase()) ||
                c.id.toLowerCase().includes(catalogQuery.toLowerCase())),
          );
          const sorted = [...filtered].sort((a, b) => {
            const aVal = a[catalogSortKey] ?? '';
            const bVal = b[catalogSortKey] ?? '';
            let cmp: number;
            if (typeof aVal === 'boolean') cmp = Number(bVal as boolean) - Number(aVal);
            else if (typeof aVal === 'string') cmp = aVal.localeCompare(bVal as string);
            else cmp = (aVal as number) - (bVal as number);
            return catalogSortDir === 'asc' ? cmp : -cmp;
          });
          const PAGE_SIZE = 25;
          const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
          const paged = sorted.slice(catalogPage * PAGE_SIZE, (catalogPage + 1) * PAGE_SIZE);
          return (
            <>
              <div className="tabs" style={{ marginTop: -8, marginBottom: 4 }}>
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
              <div style={{ marginBottom: 12 }}>
                <input
                  className="input"
                  placeholder="Search by label or ID…"
                  value={catalogQuery}
                  onChange={(e) => {
                    setCatalogQuery(e.target.value);
                    setCatalogPage(0);
                  }}
                  style={{ maxWidth: 320 }}
                />
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <Th
                        k="label"
                        sortKey={catalogSortKey}
                        sortDir={catalogSortDir}
                        onSort={(k) => {
                          if (k === catalogSortKey)
                            setCatalogSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                          else {
                            setCatalogSortKey(k as keyof CatalogItem);
                            setCatalogSortDir('asc');
                          }
                        }}
                      >
                        Label
                      </Th>
                      <th>Gender</th>
                      <Th
                        k="sortOrder"
                        sortKey={catalogSortKey}
                        sortDir={catalogSortDir}
                        onSort={(k) => {
                          if (k === catalogSortKey)
                            setCatalogSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                          else {
                            setCatalogSortKey(k as keyof CatalogItem);
                            setCatalogSortDir('asc');
                          }
                        }}
                      >
                        Order
                      </Th>
                      <Th
                        k="isActive"
                        sortKey={catalogSortKey}
                        sortDir={catalogSortDir}
                        onSort={(k) => {
                          if (k === catalogSortKey)
                            setCatalogSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                          else {
                            setCatalogSortKey(k as keyof CatalogItem);
                            setCatalogSortDir('asc');
                          }
                        }}
                      >
                        Active
                      </Th>
                      <Th
                        k="updatedAt"
                        sortKey={catalogSortKey}
                        sortDir={catalogSortDir}
                        onSort={(k) => {
                          if (k === catalogSortKey)
                            setCatalogSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                          else {
                            setCatalogSortKey(k as keyof CatalogItem);
                            setCatalogSortDir('asc');
                          }
                        }}
                      >
                        Updated
                      </Th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {T(c, 40, 40)}
                            <div>
                              <span className="semi">{c.label}</span>
                              <span className="sub mono" style={{ display: 'block' }}>
                                {c.id.slice(0, 8)}…
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="badge dot">{c.genderSlug ?? 'all'}</span>
                        </td>
                        <td>
                          <span className="mono">{c.sortOrder}</span>
                        </td>
                        <td>
                          <Switch
                            checked={c.isActive}
                            onChange={async () => {
                              const next = !c.isActive;
                              setCatalogItems((prev) =>
                                prev.map((x) => (x.id === c.id ? { ...x, isActive: next } : x)),
                              );
                              try {
                                await apiFetch(`/admin/catalog/items/${c.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ isActive: next }),
                                });
                                toast({
                                  title: `${c.label} ${c.isActive ? 'deactivated' : 'activated'}`,
                                });
                              } catch {
                                setCatalogItems((prev) =>
                                  prev.map((x) =>
                                    x.id === c.id ? { ...x, isActive: c.isActive } : x,
                                  ),
                                );
                                toast({ kind: 'error', title: 'Failed to update item' });
                              }
                            }}
                          />
                        </td>
                        <td>
                          <span className="mono">{c.updatedAt.slice(0, 10)}</span>
                        </td>
                        <td>
                          <button
                            className="btn sm ghost"
                            onClick={() => {
                              setEditingCatalogItem(c);
                              setEditCatalogLabel(c.label);
                              setEditCatalogGender(c.genderSlug ?? 'men');
                              setEditCatalogSubcatIds(c.subcategoryIds ?? []);
                              setCatalogReplaceFile(null);
                              setCatalogReplacePreview(null);
                            }}
                          >
                            <Icon.Edit />
                          </button>
                          <button
                            className="btn sm ghost"
                            onClick={() => setConfirmDeleteCatalog(c.id)}
                          >
                            <Icon.Trash />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {paged.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                        >
                          No items found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pager
                page={catalogPage}
                totalPages={totalPages}
                onPage={setCatalogPage}
                totalItems={sorted.length}
                pageSize={PAGE_SIZE}
              />
            </>
          );
        })()}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete {confirmDelete.type}</h3>
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

      {confirmBulkDeleteBgIds.length > 0 && (
        <div className="modal-overlay" onClick={() => setConfirmBulkDeleteBgIds([])}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                Delete {confirmBulkDeleteBgIds.length} background
                {confirmBulkDeleteBgIds.length !== 1 ? 's' : ''}
              </h3>
            </div>
            <div className="modal-body">
              <p>
                Permanently delete{' '}
                <strong>
                  {confirmBulkDeleteBgIds.length} selected background
                  {confirmBulkDeleteBgIds.length !== 1 ? 's' : ''}
                </strong>{' '}
                and their R2 images? This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmBulkDeleteBgIds([])}>
                Cancel
              </button>
              <button className="btn danger" onClick={doBulkDeleteBackgrounds}>
                <Icon.Trash /> Delete {confirmBulkDeleteBgIds.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBulkDeleteFaceIds.length > 0 && (
        <div className="modal-overlay" onClick={() => setConfirmBulkDeleteFaceIds([])}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                Delete {confirmBulkDeleteFaceIds.length} face
                {confirmBulkDeleteFaceIds.length !== 1 ? 's' : ''}
              </h3>
            </div>
            <div className="modal-body">
              <p>
                Permanently delete{' '}
                <strong>
                  {confirmBulkDeleteFaceIds.length} selected face
                  {confirmBulkDeleteFaceIds.length !== 1 ? 's' : ''}
                </strong>{' '}
                and their R2 images? This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmBulkDeleteFaceIds([])}>
                Cancel
              </button>
              <button className="btn danger" onClick={doBulkDeleteFaces}>
                <Icon.Trash /> Delete {confirmBulkDeleteFaceIds.length}
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
                  ref={bulkImportRef}
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
                    if (e.lengthComputable) {
                      setBulkImportProgress(Math.round((e.loaded / e.total) * 100));
                    }
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
                      const { faces, backgrounds, poses } = result.created;
                      toast({
                        title: `Imported ${faces} faces, ${backgrounds} backgrounds, ${poses} poses`,
                        body:
                          faces + backgrounds + poses === 0
                            ? 'All items already exist — nothing new to import.'
                            : undefined,
                      });
                      if (result.errors.length > 0) {
                        // biome-ignore lint/suspicious/noConsole: surface import errors in devtools
                        console.error('Bulk import errors:', result.errors);
                        toast({
                          kind: 'error',
                          title: `${result.errors.length} item(s) failed`,
                          body: result.errors[0],
                        });
                      }
                      await Promise.all([loadPoseAssets(), loadFaces(), loadBackgrounds()]);
                    } else {
                      const err = JSON.parse(xhr.responseText) as {
                        error?: { message?: string };
                      };
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

      {/* ── Upload single pose asset (rich form via PoseUploadModal in asset mode) ── */}
      {showPoseAssetUpload && (
        <PoseUploadModal
          garmentTypeGenderSlug={genderFilter !== 'all' ? genderFilter : 'men'}
          faces={faces}
          backgrounds={allBackgrounds}
          onDone={(_added) => {
            setShowPoseAssetUpload(false);
            loadPoseAssets();
            apiFetch<{ items: ModelFace[] }>('/admin/assets/faces')
              .then((r) => setFaces(r.items))
              .catch(() => {});
            apiFetch<{ items: ModelBackground[] }>('/admin/assets/backgrounds')
              .then((r) => setAllBackgrounds(r.items))
              .catch(() => {});
          }}
          onClose={() => setShowPoseAssetUpload(false)}
          toast={toast}
        />
      )}

      {/* ── Edit pose asset ── */}
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

      {/* ── Map pose asset to garment type ── */}
      {mappingPoseAsset &&
        (() => {
          return (
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
                  {/* Existing mappings */}
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
                              <div
                                style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}
                              >
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
                                  await apiFetch(`/admin/assets/poses/${m.id}`, {
                                    method: 'DELETE',
                                  });
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
          );
        })()}

      {confirmBulkDeletePoseAssetIds.length > 0 && (
        <div className="modal-overlay" onClick={() => setConfirmBulkDeletePoseAssetIds([])}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete {confirmBulkDeletePoseAssetIds.length} pose assets</h3>
            </div>
            <div className="modal-body">
              <p>
                Permanently delete{' '}
                <strong>{confirmBulkDeletePoseAssetIds.length} selected pose assets</strong> and
                their R2 images? This cannot be undone.
              </p>
              <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>
                All garment-type mappings and associated jobs will also be removed.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmBulkDeletePoseAssetIds([])}>
                Cancel
              </button>
              <button className="btn danger" onClick={doBulkDeletePoseAssets}>
                <Icon.Trash /> Delete {confirmBulkDeletePoseAssetIds.length} assets
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk map selected pose assets ── */}
      {showBulkMap &&
        (() => {
          // Group garment types by gender for the checkbox list
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
                          {/* Gender header with select-all toggle */}
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

      {confirmDeletePoseAssetId && (
        <div className="modal-overlay" onClick={() => setConfirmDeletePoseAssetId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete pose asset</h3>
            </div>
            <div className="modal-body">
              <p>Permanently delete this pose asset and its R2 images? This cannot be undone.</p>
              <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>
                All garment-type mappings and any associated jobs for this asset will also be
                removed.
              </p>
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
                    toast({ title: 'Pose asset deleted' });
                  } catch (e) {
                    toast({ kind: 'error', title: 'Delete failed', body: (e as Error).message });
                  }
                }}
              >
                <Icon.Trash /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showBgUpload && (
        <BackgroundUploadModal
          defaultGenderSlug={genderFilter === 'all' ? '' : genderFilter}
          onDone={(row) => {
            setShowBgUpload(false);
            setBackgrounds((prev) => [...prev, row]);
            setAllBackgrounds((prev) => [...prev, row]);
          }}
          onClose={() => setShowBgUpload(false)}
          toast={toast}
        />
      )}
      {showFaceUpload && (
        <UploadModal
          title="Add model face"
          presignPath="/admin/assets/faces/presign"
          confirmPath="/admin/assets/faces/confirm"
          fields={FACE_FIELDS}
          onDone={(row) => {
            setShowFaceUpload(false);
            setFaces((prev) => [...prev, row as ModelFace]);
          }}
          onClose={() => setShowFaceUpload(false)}
          toast={toast}
        />
      )}

      {editingBackground && (
        <EditBackgroundModal
          background={editingBackground}
          storagePublicUrl={storagePublicUrl}
          onSaved={(updated) => {
            setBackgrounds((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
            setEditingBackground(null);
          }}
          onClose={() => setEditingBackground(null)}
          toast={toast}
        />
      )}
      {editingFace && (
        <EditFaceModal
          face={editingFace}
          storagePublicUrl={storagePublicUrl}
          onSaved={(updated) => {
            setFaces((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
            setEditingFace(null);
          }}
          onClose={() => setEditingFace(null)}
          toast={toast}
        />
      )}
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
                      const subcatThumb = await makeThumbnail(subcatImageFile);
                      await fetch(presign.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': subcatThumb.type },
                        body: subcatThumb,
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
                <label>Thumbnail image</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {editSubcatImageFile ? (
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
                    editSubcatRequiresLowerUpload === editingSubcat.requiresLowerUpload)
                }
                onClick={async () => {
                  setEditSubcatSaving(true);
                  try {
                    const patchBody: {
                      thumbnailKey?: string;
                      label?: string;
                      requiresLowerUpload?: boolean;
                    } = {};
                    if (editSubcatImageFile) {
                      const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
                        '/admin/assets/garment-types/presign',
                        {
                          method: 'POST',
                          body: JSON.stringify({ contentType: editSubcatImageFile.type }),
                        },
                      );
                      const editSubcatThumb = await makeThumbnail(editSubcatImageFile);
                      await fetch(presign.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': editSubcatThumb.type },
                        body: editSubcatThumb,
                      });
                      patchBody.thumbnailKey = presign.thumbnailKey;
                    }
                    if (editSubcatLabel.trim() !== editingSubcat.label.trim()) {
                      patchBody.label = editSubcatLabel.trim();
                    }
                    if (editSubcatRequiresLowerUpload !== editingSubcat.requiresLowerUpload) {
                      patchBody.requiresLowerUpload = editSubcatRequiresLowerUpload;
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
      {editingCatalogItem && (
        <div
          className="modal-overlay"
          onClick={editCatalogSaving ? undefined : () => setEditingCatalogItem(null)}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(440px, calc(100vw - 40px))' }}
          >
            <div className="modal-head">
              <h3>Edit catalog item</h3>
              <button
                className="btn sm ghost"
                onClick={() => setEditingCatalogItem(null)}
                disabled={editCatalogSaving}
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
                  value={editCatalogLabel}
                  disabled={editCatalogSaving}
                  onChange={(e) => setEditCatalogLabel(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Gender</label>
                <select
                  className="select"
                  value={editCatalogGender}
                  disabled={editCatalogSaving}
                  onChange={(e) => setEditCatalogGender(e.target.value)}
                >
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                  <option value="boys">Boys</option>
                  <option value="girls">Girls</option>
                </select>
              </div>
              {/* Subcategory checklist */}
              {(() => {
                const matchingSubs = garmentTypes.filter((g) => g.genderSlug === editCatalogGender);
                return (
                  <div className="field">
                    <label>
                      Garment types this item applies to
                      <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 6 }}>
                        ({editCatalogSubcatIds.length} selected)
                      </span>
                    </label>
                    {matchingSubs.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        No garment types for {editCatalogGender}.
                      </div>
                    ) : (
                      <div
                        style={{
                          padding: '8px 12px',
                          background: 'var(--subtle)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          maxHeight: 160,
                          overflowY: 'auto',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                        }}
                      >
                        {matchingSubs.map((gt) => (
                          <label
                            key={gt.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '4px 0',
                              cursor: editCatalogSaving ? 'default' : 'pointer',
                              fontSize: 12.5,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={editCatalogSubcatIds.includes(gt.id)}
                              disabled={editCatalogSaving}
                              onChange={(e) =>
                                setEditCatalogSubcatIds((prev) =>
                                  e.target.checked
                                    ? [...prev, gt.id]
                                    : prev.filter((id) => id !== gt.id),
                                )
                              }
                            />
                            <span>{gt.label}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{gt.slug}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="field">
                <label>Replace image</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {(catalogReplacePreview ??
                    (storagePublicUrl && editingCatalogItem.thumbnailKey
                      ? `${storagePublicUrl}/${editingCatalogItem.thumbnailKey}`
                      : null)) && (
                    <img
                      src={
                        catalogReplacePreview ??
                        `${storagePublicUrl}/${editingCatalogItem.thumbnailKey}`
                      }
                      alt=""
                      style={{
                        width: 56,
                        height: 56,
                        objectFit: 'cover',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input
                      ref={catalogReplaceRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setCatalogReplaceFile(file);
                        setCatalogReplacePreview(URL.createObjectURL(file));
                      }}
                    />
                    <button
                      type="button"
                      className="btn sm ghost"
                      disabled={editCatalogSaving || catalogReplaceUploading}
                      onClick={() => catalogReplaceRef.current?.click()}
                    >
                      <Icon.Image />{' '}
                      {catalogReplaceFile ? catalogReplaceFile.name : 'Pick new image'}
                    </button>
                    {catalogReplaceFile && (
                      <button
                        type="button"
                        className="btn sm primary"
                        disabled={catalogReplaceUploading}
                        onClick={async () => {
                          if (!editingCatalogItem || !catalogReplaceFile) return;
                          setCatalogReplaceUploading(true);
                          try {
                            const presign = await apiFetch<{
                              uploadUrl: string;
                              r2Key: string;
                              thumbnailUploadUrl: string;
                              thumbnailKey: string;
                            }>('/admin/catalog/items/presign', {
                              method: 'POST',
                              body: JSON.stringify({
                                typeSlug: editingCatalogItem.type,
                                contentType: catalogReplaceFile.type,
                              }),
                            });
                            const catThumb = await makeThumbnail(catalogReplaceFile);
                            await Promise.all([
                              new Promise<void>((res, rej) => {
                                const xhr = new XMLHttpRequest();
                                xhr.open('PUT', presign.uploadUrl);
                                xhr.setRequestHeader('Content-Type', catalogReplaceFile.type);
                                xhr.onload = () =>
                                  xhr.status < 300 ? res() : rej(new Error(`${xhr.status}`));
                                xhr.onerror = () => rej(new Error('Network error'));
                                xhr.send(catalogReplaceFile);
                              }),
                              new Promise<void>((res, rej) => {
                                const xhr = new XMLHttpRequest();
                                xhr.open('PUT', presign.thumbnailUploadUrl);
                                xhr.setRequestHeader('Content-Type', catThumb.type);
                                xhr.onload = () =>
                                  xhr.status < 300 ? res() : rej(new Error(`${xhr.status}`));
                                xhr.onerror = () => rej(new Error('Network error'));
                                xhr.send(catThumb);
                              }),
                            ]);
                            await apiFetch(`/admin/catalog/items/${editingCatalogItem.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({
                                r2Key: presign.r2Key,
                                thumbnailKey: presign.thumbnailKey,
                                isActive: true,
                              }),
                            });
                            setCatalogItems((prev) =>
                              prev.map((x) =>
                                x.id === editingCatalogItem.id
                                  ? {
                                      ...x,
                                      r2Key: presign.r2Key,
                                      thumbnailKey: presign.thumbnailKey,
                                      isActive: true,
                                    }
                                  : x,
                              ),
                            );
                            setEditingCatalogItem((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    r2Key: presign.r2Key,
                                    thumbnailKey: presign.thumbnailKey,
                                    isActive: true,
                                  }
                                : prev,
                            );
                            setCatalogReplaceFile(null);
                            setCatalogReplacePreview(null);
                            toast({ title: 'Image replaced' });
                          } catch {
                            toast({ kind: 'error', title: 'Image replace failed' });
                          } finally {
                            setCatalogReplaceUploading(false);
                          }
                        }}
                      >
                        {catalogReplaceUploading ? 'Uploading…' : 'Upload & replace'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setEditingCatalogItem(null)}
                disabled={editCatalogSaving}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={editCatalogSaving}
                onClick={async () => {
                  setEditCatalogSaving(true);
                  try {
                    await apiFetch(`/admin/catalog/items/${editingCatalogItem.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({
                        label: editCatalogLabel.trim() || editingCatalogItem.label,
                        genderSlug: editCatalogGender,
                        subcategoryIds: editCatalogSubcatIds,
                      }),
                    });
                    setCatalogItems((prev) =>
                      prev.map((x) =>
                        x.id === editingCatalogItem.id
                          ? {
                              ...x,
                              label: editCatalogLabel.trim() || x.label,
                              genderSlug: editCatalogGender,
                              subcategoryIds: editCatalogSubcatIds,
                            }
                          : x,
                      ),
                    );
                    toast({ title: `${editingCatalogItem.label} updated` });
                    setEditingCatalogItem(null);
                  } catch {
                    toast({ kind: 'error', title: 'Failed to update item' });
                  } finally {
                    setEditCatalogSaving(false);
                  }
                }}
              >
                {editCatalogSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteCatalog && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteCatalog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete catalog item</h3>
            </div>
            <div className="modal-body">
              <p>
                Delete{' '}
                <strong>
                  {catalogItems.find((c) => c.id === confirmDeleteCatalog)?.label ??
                    confirmDeleteCatalog}
                </strong>
                ? This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDeleteCatalog(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  const id = confirmDeleteCatalog;
                  setConfirmDeleteCatalog(null);
                  try {
                    await apiFetch(`/admin/catalog/items/${id}`, { method: 'DELETE' });
                    setCatalogItems((prev) => prev.filter((c) => c.id !== id));
                    toast({ title: 'Item deleted' });
                  } catch {
                    toast({ kind: 'error', title: 'Failed to delete item' });
                  }
                }}
              >
                <Icon.Trash /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {showCatalogUpload && (
        <BatchCatalogUploadModal
          typeSlug={activeTab === 'shoe' ? 'shoe' : 'lower'}
          garmentTypes={garmentTypes}
          defaultGenderSlug={genderFilter === 'all' ? '' : genderFilter}
          onDone={(added) => {
            setShowCatalogUpload(false);
            setCatalogItems((prev) => [...prev, ...(added as unknown as CatalogItem[])]);
            apiFetch<CatalogItem[]>('/admin/catalog/items')
              .then(setCatalogItems)
              .catch(() => {
                toast({ kind: 'error', title: 'Items added but failed to refresh list' });
              });
          }}
          onClose={() => setShowCatalogUpload(false)}
          toast={toast}
        />
      )}

      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={previewUrl}
            alt="preview"
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: 8,
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
