import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BackgroundUploadModal } from '../components/BackgroundUploadModal';
import { BatchCatalogUploadModal } from '../components/BatchCatalogUploadModal';
import { EditBackgroundModal } from '../components/EditBackgroundModal';
import { EditFaceModal } from '../components/EditFaceModal';
import { EditPoseModal } from '../components/EditPoseModal';
import { Icon } from '../components/Icons';
import { Pager } from '../components/Pager';
import { PoseUploadModal } from '../components/PoseUploadModal';
import { Switch } from '../components/Switch';
import type { SortDir } from '../components/Th';
import { Th } from '../components/Th';
import type { FieldDef } from '../components/UploadModal';
import { UploadModal } from '../components/UploadModal';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type {
  CatalogItem,
  GarmentType,
  GenderSlug,
  ModelBackground,
  ModelFace,
  ModelPose,
  WorkflowOption,
} from '../types';

type AssetTab = 'garment-types' | 'faces' | 'backgrounds' | 'lower' | 'shoe';
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
  const VALID_TABS: AssetTab[] = ['garment-types', 'faces', 'backgrounds', 'lower', 'shoe'];
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
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [filterFace, setFilterFace] = useState('');
  const [filterBg, setFilterBg] = useState('');
  const [filterPose, setFilterPose] = useState('');
  const [poseSortKey, setPoseSortKey] = useState<'label' | 'sortOrder' | 'createdAt'>('label');
  const [poseSortDir, setPoseSortDir] = useState<'asc' | 'desc'>('asc');
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
  const [showPoseUpload, setShowPoseUpload] = useState(false);
  const [editingPose, setEditingPose] = useState<ModelPose | null>(null);
  const [clonePoseIds, setClonePoseIds] = useState<string[]>([]);
  const [cloneTargetIds, setCloneTargetIds] = useState<string[]>([]);
  const [cloning, setCloning] = useState(false);
  const [selectedPoseIds, setSelectedPoseIds] = useState<string[]>([]);
  const [confirmBulkDeletePoseIds, setConfirmBulkDeletePoseIds] = useState<string[]>([]);
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
    else if (activeTab === 'garment-types') {
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

  // Poses available in current face×bg cell (for 3rd-dimension selector)
  const posesInCell = poses.filter(
    (p) => (!filterFace || p.faceId === filterFace) && (!filterBg || p.backgroundId === filterBg),
  );

  // Filtered poses for grid
  const visiblePoses = posesInCell
    .filter((p) => !filterPose || p.id === filterPose)
    .sort((a, b) => {
      let cmp = 0;
      if (poseSortKey === 'label') cmp = a.label.localeCompare(b.label);
      else if (poseSortKey === 'sortOrder') cmp = a.sortOrder - b.sortOrder;
      else cmp = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      return poseSortDir === 'asc' ? cmp : -cmp;
    });

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
          {activeTab === 'garment-types' && subView.kind === 'garment-type' && (
            <button className="btn" onClick={() => setShowPoseUpload(true)}>
              <Icon.Upload /> Upload poses
            </button>
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
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
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
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 14,
              marginTop: 14,
            }}
          >
            {filteredFaces.map((face) => (
              <div
                key={face.id}
                className="card"
                style={{ opacity: face.isActive ? 1 : 0.6, padding: 14 }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
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
              marginBottom: 14,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {poses.length} poses
            </span>
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
            {(filterFace || filterBg || filterPose) && (
              <button
                className="btn sm ghost"
                onClick={() => {
                  setFilterFace('');
                  setFilterBg('');
                  setFilterPose('');
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
                  <button
                    className="btn sm primary"
                    onClick={() => {
                      setClonePoseIds(selectedPoseIds);
                      setCloneTargetIds([]);
                    }}
                  >
                    Clone selected ({selectedPoseIds.length})
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

          {/* Pose grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 14,
            }}
          >
            {visiblePoses.map((pose) => {
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
                        <button className="btn sm ghost" onClick={() => setEditingPose(pose)}>
                          <Icon.Edit />
                        </button>
                        <button
                          className="btn sm ghost"
                          title="Clone to other garment types"
                          onClick={() => {
                            setClonePoseIds([pose.id]);
                            setCloneTargetIds([]);
                          }}
                        >
                          <Icon.Copy />
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
      {showPoseUpload && subView.kind === 'garment-type' && (
        <PoseUploadModal
          garmentTypeId={subView.sub.id}
          garmentTypeGenderSlug={subView.sub.genderSlug}
          faces={faces}
          backgrounds={allBackgrounds}
          onDone={(added) => {
            setShowPoseUpload(false);
            setPoses((prev) => [...prev, added]);
            apiFetch<{ items: ModelFace[] }>('/admin/assets/faces')
              .then((r) => setFaces(r.items))
              .catch(() => {});
            apiFetch<{ items: ModelBackground[] }>('/admin/assets/backgrounds')
              .then((r) => setAllBackgrounds(r.items))
              .catch(() => {});
          }}
          onClose={() => setShowPoseUpload(false)}
          toast={toast}
        />
      )}
      {editingPose && (
        <EditPoseModal
          pose={editingPose}
          faces={faces}
          backgrounds={allBackgrounds}
          workflows={workflows}
          onSaved={(updated) => {
            setPoses((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setEditingPose(null);
          }}
          onClose={() => setEditingPose(null)}
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
      {clonePoseIds.length > 0 && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setClonePoseIds([])}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '1.5rem',
              width: 420,
              maxWidth: '95vw',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {clonePoseIds.length === 1
                ? `Clone "${poses.find((p) => p.id === clonePoseIds[0])?.label ?? '…'}" to garment types`
                : `Clone ${clonePoseIds.length} poses to garment types`}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Select garment types to clone to. Existing combos (same face + background) will be
              skipped.
            </div>
            {(() => {
              const cloneableIds = garmentTypes
                .filter(
                  (g) =>
                    g.id !== (subView.kind === 'garment-type' ? subView.sub.id : '') &&
                    (subView.kind !== 'garment-type' || g.genderSlug === subView.sub.genderSlug),
                )
                .map((g) => g.id);
              const allSelected =
                cloneableIds.length > 0 && cloneableIds.every((id) => cloneTargetIds.includes(id));
              return (
                <button
                  className="btn sm ghost"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => setCloneTargetIds(allSelected ? [] : cloneableIds)}
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              );
            })()}
            <div
              style={{
                overflowY: 'auto',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {garmentTypes
                .filter(
                  (g) =>
                    g.id !== (subView.kind === 'garment-type' ? subView.sub.id : '') &&
                    (subView.kind !== 'garment-type' || g.genderSlug === subView.sub.genderSlug),
                )
                .map((g) => (
                  <label
                    key={g.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: cloneTargetIds.includes(g.id)
                        ? 'var(--surface-hover)'
                        : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={cloneTargetIds.includes(g.id)}
                      onChange={(e) =>
                        setCloneTargetIds((prev) =>
                          e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id),
                        )
                      }
                    />
                    <span style={{ fontSize: 13 }}>
                      {g.label}
                      <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 11 }}>
                        {g.genderSlug}
                      </span>
                    </span>
                  </label>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn sm ghost" onClick={() => setClonePoseIds([])}>
                Cancel
              </button>
              <button
                className="btn sm primary"
                disabled={cloneTargetIds.length === 0 || cloning}
                onClick={async () => {
                  setCloning(true);
                  try {
                    const res = await apiFetch<{ created: number; skipped: number }>(
                      clonePoseIds.length === 1
                        ? `/admin/assets/poses/${clonePoseIds[0]}/clone`
                        : '/admin/assets/poses/clone-bulk',
                      {
                        method: 'POST',
                        body: JSON.stringify(
                          clonePoseIds.length === 1
                            ? { targetGarmentTypeIds: cloneTargetIds }
                            : { poseIds: clonePoseIds, targetGarmentTypeIds: cloneTargetIds },
                        ),
                      },
                    );
                    toast({
                      title: `Cloned to ${res.created} garment type${res.created !== 1 ? 's' : ''}${res.skipped > 0 ? ` (${res.skipped} skipped)` : ''}`,
                    });
                    setClonePoseIds([]);
                    setCloneTargetIds([]);
                    setSelectedPoseIds([]);
                  } catch {
                    toast({ kind: 'error', title: 'Clone failed' });
                  } finally {
                    setCloning(false);
                  }
                }}
              >
                {cloning
                  ? 'Cloning…'
                  : `Clone to ${cloneTargetIds.length} type${cloneTargetIds.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
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
