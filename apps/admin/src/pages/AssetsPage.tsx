import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import type {
  ModelFace, ModelBackground, GarmentSubcategory, ModelPose, GenderSlug,
} from '../types';
import { apiFetch } from '../lib/data';
import { Icon } from '../components/Icons';
import { Switch } from '../components/Switch';
import { UploadModal } from '../components/UploadModal';
import type { FieldDef } from '../components/UploadModal';
import { PoseUploadModal } from '../components/PoseUploadModal';
import { EditPoseModal } from '../components/EditPoseModal';
import { EditBackgroundModal } from '../components/EditBackgroundModal';
import { EditFaceModal } from '../components/EditFaceModal';

type AssetTab = 'backgrounds' | 'faces' | 'subcategories';
type GenderFilter = 'all' | GenderSlug;

type SubView =
  | { kind: 'list' }
  | { kind: 'subcategory'; sub: GarmentSubcategory };

type ConfirmDelete =
  | { type: 'background'; id: string; label: string }
  | { type: 'face'; id: string; label: string }
  | { type: 'subcategory'; id: string; label: string }
  | { type: 'pose'; id: string; label: string };

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

const FACE_FIELDS: FieldDef[] = [
  { type: 'text', name: 'label', label: 'Label', required: true, placeholder: 'e.g. Model 1 — Men' },
  {
    type: 'select', name: 'gender', label: 'Gender',
    options: [
      { value: 'men', label: 'Men' },
      { value: 'women', label: 'Women' },
      { value: 'boys', label: 'Boys' },
      { value: 'girls', label: 'Girls' },
    ],
  },
  { type: 'number', name: 'sortOrder', label: 'Sort order (lower = first)', min: 0, defaultValue: 0 },
];

const BG_FIELDS: FieldDef[] = [
  { type: 'text', name: 'label', label: 'Label', required: true, placeholder: 'e.g. Studio White' },
  { type: 'number', name: 'sortOrder', label: 'Sort order (lower = first)', min: 0, defaultValue: 0 },
];

function AssetThumb({ thumbnailKey, label, w = 64, h = 64, storageBase }: {
  thumbnailKey?: string; label: string; w?: number; h?: number; storageBase: string | null;
}) {
  const src = thumbnailKey && storageBase ? `${storageBase}/${thumbnailKey}` : null;
  if (src) {
    return (
      <img
        src={src}
        alt={label}
        style={{ width: w, height: h, objectFit: 'cover', borderRadius: 6, flexShrink: 0, display: 'block' }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div style={{
      width: w, height: h, borderRadius: 6,
      background: 'var(--subtle)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, color: 'var(--muted)', fontSize: 11, fontWeight: 600,
    }}>
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function AssetsPage({ onNav: _onNav, toast }: Props) {
  const { storagePublicUrl } = useAuth();
  const [activeTab, setActiveTab] = useState<AssetTab>('backgrounds');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [subView, setSubView] = useState<SubView>({ kind: 'list' });

  const [backgrounds, setBackgrounds] = useState<ModelBackground[]>([]);
  const [faces, setFaces] = useState<ModelFace[]>([]);
  const [subcategories, setSubcategories] = useState<GarmentSubcategory[]>([]);
  const [poses, setPoses] = useState<ModelPose[]>([]);
  const [filterFace, setFilterFace] = useState('');
  const [filterBg, setFilterBg] = useState('');
  const [filterPose, setFilterPose] = useState('');
  const [showSubcatModal, setShowSubcatModal] = useState(false);
  const [subcatForm, setSubcatForm] = useState({ slug: '', label: '', genderSlug: 'men' as GenderSlug });
  const [subcatSaving, setSubcatSaving] = useState(false);

  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete | null>(null);

  const [showBgUpload, setShowBgUpload] = useState(false);
  const [showFaceUpload, setShowFaceUpload] = useState(false);
  const [showBatchPoseUpload, setShowBatchPoseUpload] = useState(false);
  const [editingPose, setEditingPose] = useState<ModelPose | null>(null);
  const [editingBackground, setEditingBackground] = useState<ModelBackground | null>(null);
  const [editingFace, setEditingFace] = useState<ModelFace | null>(null);

  const loadBackgrounds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ModelBackground[] }>('/admin/assets/backgrounds');
      setBackgrounds(res.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load backgrounds' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

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

  const loadSubcategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: GarmentSubcategory[] }>('/admin/assets/subcategories');
      setSubcategories(res.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load subcategories' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadSubcategoryAssets = useCallback(async (subcategoryId: string) => {
    setLoading(true);
    try {
      const posesRes = await apiFetch<{ items: ModelPose[] }>(`/admin/assets/poses?subcategoryId=${subcategoryId}`);
      setPoses(posesRes.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load assets' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeTab === 'backgrounds') loadBackgrounds();
    else if (activeTab === 'faces') loadFaces();
    else if (activeTab === 'subcategories') {
      if (subView.kind === 'list') loadSubcategories();
      else loadSubcategoryAssets(subView.sub.id);
    }
  }, [activeTab, subView, loadBackgrounds, loadFaces, loadSubcategories, loadSubcategoryAssets]);

  // Preload faces + backgrounds silently so upload selects + filters are populated
  useEffect(() => {
    apiFetch<{ items: ModelFace[] }>('/admin/assets/faces')
      .then((r) => setFaces(r.items)).catch(() => {});
    apiFetch<{ items: ModelBackground[] }>('/admin/assets/backgrounds')
      .then((r) => setBackgrounds(r.items)).catch(() => {});
  }, []);

  const toggleBg = async (id: string) => {
    const item = backgrounds.find((b) => b.id === id);
    if (!item) return;
    const next = !item.isActive;
    setBackgrounds((prev) => prev.map((b) => b.id === id ? { ...b, isActive: next } : b));
    try {
      await apiFetch(`/admin/assets/backgrounds/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
      toast({ title: `${item.label} ${item.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setBackgrounds((prev) => prev.map((b) => b.id === id ? { ...b, isActive: item.isActive } : b));
      toast({ kind: 'error', title: 'Failed to update background' });
    }
  };

  const toggleFace = async (id: string) => {
    const item = faces.find((f) => f.id === id);
    if (!item) return;
    const next = !item.isActive;
    setFaces((prev) => prev.map((f) => f.id === id ? { ...f, isActive: next } : f));
    try {
      await apiFetch(`/admin/assets/faces/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
      toast({ title: `${item.label} ${item.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setFaces((prev) => prev.map((f) => f.id === id ? { ...f, isActive: item.isActive } : f));
      toast({ kind: 'error', title: 'Failed to update face' });
    }
  };

  const togglePose = async (id: string) => {
    const item = poses.find((p) => p.id === id);
    if (!item) return;
    const next = !item.isActive;
    setPoses((prev) => prev.map((p) => p.id === id ? { ...p, isActive: next } : p));
    try {
      await apiFetch(`/admin/assets/poses/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
      toast({ title: `${item.label} ${item.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setPoses((prev) => prev.map((p) => p.id === id ? { ...p, isActive: item.isActive } : p));
      toast({ kind: 'error', title: 'Failed to update pose' });
    }
  };

  const setAsTemplate = async (id: string) => {
    const pose = poses.find((p) => p.id === id);
    if (!pose || pose.isTemplate) return;
    // Optimistically update: unset old template in same cell, set new one
    setPoses((prev) => prev.map((p) => {
      if (p.faceId === pose.faceId && p.backgroundId === pose.backgroundId && p.subcategoryId === pose.subcategoryId) {
        return { ...p, isTemplate: p.id === id };
      }
      return p;
    }));
    try {
      await apiFetch(`/admin/assets/poses/${id}`, { method: 'PATCH', body: JSON.stringify({ isTemplate: true }) });
      toast({ title: `${pose.label} set as template` });
    } catch {
      // Revert
      setPoses((prev) => prev.map((p) => {
        if (p.faceId === pose.faceId && p.backgroundId === pose.backgroundId && p.subcategoryId === pose.subcategoryId) {
          return { ...p, isTemplate: p.id !== id && p.isTemplate };
        }
        return p;
      }));
      toast({ kind: 'error', title: 'Failed to set template' });
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { type, id, label } = confirmDelete;
    setConfirmDelete(null);
    const paths: Record<typeof type, string> = {
      background: `/admin/assets/backgrounds/${id}`,
      face: `/admin/assets/faces/${id}`,
      subcategory: `/admin/assets/subcategories/${id}`,
      pose: `/admin/assets/poses/${id}`,
    };
    try {
      await apiFetch(paths[type], { method: 'DELETE' });
      if (type === 'background') setBackgrounds((prev) => prev.filter((b) => b.id !== id));
      else if (type === 'face') setFaces((prev) => prev.filter((f) => f.id !== id));
      else if (type === 'subcategory') {
        setSubcategories((prev) => prev.filter((s) => s.id !== id));
        setSubView({ kind: 'list' });
      } else if (type === 'pose') setPoses((prev) => prev.filter((p) => p.id !== id));
      toast({ title: `${label} deleted` });
    } catch {
      toast({ kind: 'error', title: `Failed to delete ${type}` });
    }
  };

  const T = (item: { thumbnailKey: string; label: string }, w?: number, h?: number) => (
    <AssetThumb thumbnailKey={item.thumbnailKey} label={item.label} w={w} h={h} storageBase={storagePublicUrl} />
  );

  const TABS: { k: AssetTab; l: string }[] = [
    { k: 'backgrounds', l: 'Backgrounds' },
    { k: 'faces', l: 'Model Faces' },
    { k: 'subcategories', l: 'Subcategories' },
  ];

  const GENDER_TABS: { k: GenderFilter; l: string }[] = [
    { k: 'all', l: 'All' },
    { k: 'men', l: 'Men' },
    { k: 'women', l: 'Women' },
    { k: 'boys', l: 'Boys' },
    { k: 'girls', l: 'Girls' },
  ];

  const filteredFaces = faces.filter((f) => genderFilter === 'all' || f.gender === genderFilter);

  // Poses available in current face×bg cell (for 3rd-dimension selector)
  const posesInCell = poses.filter((p) =>
    (!filterFace || p.faceId === filterFace) &&
    (!filterBg || p.backgroundId === filterBg)
  );

  // Filtered poses for grid
  const visiblePoses = posesInCell.filter((p) => !filterPose || p.id === filterPose);
  const templateCount = poses.filter((p) => p.isTemplate).length;

  return (
    <>
      <div className="page-head">
        <div>
          {subView.kind === 'subcategory' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 13, color: 'var(--muted)' }}>
              <button className="btn sm ghost" onClick={() => setSubView({ kind: 'list' })} style={{ padding: '2px 8px', fontSize: 13 }}>
                Subcategories
              </button>
              <Icon.Chevron />
              <span>{subView.sub.label}</span>
            </div>
          )}
          <h1>
            {activeTab === 'backgrounds' ? 'Backgrounds'
              : activeTab === 'faces' ? 'Model Faces'
              : subView.kind === 'subcategory' ? subView.sub.label
              : 'Subcategories'}
          </h1>
          <p className="lede">
            {activeTab === 'backgrounds' && 'Global backgrounds sent to ComfyUI for all garment types.'}
            {activeTab === 'faces' && 'Model face images — select gender to filter.'}
            {activeTab === 'subcategories' && subView.kind === 'list' && 'Garment subcategories. Click to manage assets.'}
            {activeTab === 'subcategories' && subView.kind === 'subcategory' && `Assets for ${subView.sub.genderSlug} / ${subView.sub.slug}. Filter by face or background to slice the tensor.`}
          </p>
        </div>
        <div className="head-tools">
          {activeTab === 'backgrounds' && (
            <button className="btn" onClick={() => setShowBgUpload(true)}><Icon.Add /> Add background</button>
          )}
          {activeTab === 'faces' && (
            <button className="btn" onClick={() => setShowFaceUpload(true)}><Icon.Add /> Add face</button>
          )}
          {activeTab === 'subcategories' && subView.kind === 'list' && (
            <button className="btn" onClick={() => {
              setSubcatForm({ slug: '', label: '', genderSlug: 'men' });
              setShowSubcatModal(true);
            }}><Icon.Add /> Add subcategory</button>
          )}
          {activeTab === 'subcategories' && subView.kind === 'subcategory' && (
            <button className="btn" onClick={() => setShowBatchPoseUpload(true)}><Icon.Upload /> Upload poses</button>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.k} className={`tab ${activeTab === t.k ? 'active' : ''}`}
            onClick={() => { setActiveTab(t.k); setSubView({ kind: 'list' }); }}>
            {t.l}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>Loading…</div>
      )}

      {!loading && activeTab === 'backgrounds' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
          {backgrounds.map((bg) => (
            <div key={bg.id} className="card" style={{ opacity: bg.isActive ? 1 : 0.6, padding: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {T(bg, 64, 48)}
                <div style={{ marginTop: 4 }}>
                  <span className="semi">{bg.label}</span>
                  <span className="sub mono" style={{ display: 'block', marginTop: 2 }}>{bg.id.slice(0, 8)}…</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <Switch checked={bg.isActive} onChange={() => toggleBg(bg.id)} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn sm ghost" onClick={() => setEditingBackground(bg)}><Icon.Edit /></button>
                  <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'background', id: bg.id, label: bg.label })}><Icon.Trash /></button>
                </div>
              </div>
            </div>
          ))}
          {backgrounds.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>No backgrounds yet.</div>
          )}
        </div>
      )}

      {!loading && activeTab === 'faces' && (
        <>
          <div className="tabs" style={{ marginTop: -8 }}>
            {GENDER_TABS.map((t) => (
              <button key={t.k} className={`tab ${genderFilter === t.k ? 'active' : ''}`}
                onClick={() => setGenderFilter(t.k)}>
                {t.l}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginTop: 14 }}>
            {filteredFaces.map((face) => (
              <div key={face.id} className="card" style={{ opacity: face.isActive ? 1 : 0.6, padding: 14 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {T(face, 48, 64)}
                  <div style={{ marginTop: 4 }}>
                    <span className="semi">{face.label}</span>
                    <div style={{ marginTop: 4 }}><span className="badge dot accent">{face.gender}</span></div>
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                      {face.templateCount ?? 0} template{face.templateCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <Switch checked={face.isActive} onChange={() => toggleFace(face.id)} />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn sm ghost" onClick={() => setEditingFace(face)}><Icon.Edit /></button>
                    <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'face', id: face.id, label: face.label })}><Icon.Trash /></button>
                  </div>
                </div>
              </div>
            ))}
            {filteredFaces.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>No faces found.</div>
            )}
          </div>
        </>
      )}

      {!loading && activeTab === 'subcategories' && subView.kind === 'list' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subcategory</th>
                <th>Gender</th>
                <th>Poses</th>
                <th>Templates</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {subcategories.map((sub) => (
                <tr key={sub.id} style={{ cursor: 'pointer' }}
                  onClick={() => { setFilterFace(''); setFilterBg(''); setFilterPose(''); setSubView({ kind: 'subcategory', sub }); }}>
                  <td>
                    <div>
                      <span className="semi">{sub.label}</span>
                      <span className="sub mono" style={{ display: 'block' }}>{sub.slug}</span>
                    </div>
                  </td>
                  <td><span className="badge dot accent">{sub.genderSlug}</span></td>
                  <td><span className="mono">{sub.poseCount ?? 0}</span></td>
                  <td><span className="mono">{sub.templateCount ?? 0} templates</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Switch checked={sub.isActive} onChange={async () => {
                      const next = !sub.isActive;
                      setSubcategories((prev) => prev.map((s) => s.id === sub.id ? { ...s, isActive: next } : s));
                      try {
                        await apiFetch(`/admin/assets/subcategories/${sub.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
                        toast({ title: `${sub.label} ${sub.isActive ? 'deactivated' : 'activated'}` });
                      } catch {
                        setSubcategories((prev) => prev.map((s) => s.id === sub.id ? { ...s, isActive: sub.isActive } : s));
                        toast({ kind: 'error', title: 'Failed to update subcategory' });
                      }
                    }} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'subcategory', id: sub.id, label: sub.label })}><Icon.Trash /></button>
                  </td>
                </tr>
              ))}
              {subcategories.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>No subcategories yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === 'subcategories' && subView.kind === 'subcategory' && (
        <>
          {/* Face × background × pose filter bar */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {poses.length} poses · {templateCount} templates set
            </span>
            <select className="select" style={{ minWidth: 150 }} value={filterFace}
              onChange={(e) => { setFilterFace(e.target.value); setFilterPose(''); }}>
              <option value="">All faces</option>
              {faces.map((f) => <option key={f.id} value={f.id}>[{f.gender}] {f.label}</option>)}
            </select>
            <select className="select" style={{ minWidth: 150 }} value={filterBg}
              onChange={(e) => { setFilterBg(e.target.value); setFilterPose(''); }}>
              <option value="">All backgrounds</option>
              {backgrounds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
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
                .slice().sort((a, b) => a.sortOrder - b.sortOrder)
                .map((p, i) => (
                  <option key={p.id} value={p.id}>#{i + 1} {p.label}</option>
                ))}
            </select>
            {(filterFace || filterBg || filterPose) && (
              <button className="btn sm ghost" onClick={() => { setFilterFace(''); setFilterBg(''); setFilterPose(''); }}>Clear</button>
            )}
          </div>

          {/* Pose grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {visiblePoses.map((pose) => {
              const faceName = faces.find((f) => f.id === pose.faceId)?.label ?? '?';
              const bgName = backgrounds.find((b) => b.id === pose.backgroundId)?.label ?? '?';
              return (
                <div key={pose.id} className="card" style={{
                  opacity: pose.isActive ? 1 : 0.6, padding: 14,
                  outline: pose.isTemplate ? '2px solid var(--accent, #2563eb)' : undefined,
                }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    {T(pose, 48, 64)}
                    <div style={{ marginTop: 4, minWidth: 0 }}>
                      <span className="semi" style={{ fontSize: 13 }}>{pose.label}</span>
                      <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        <span className="badge dot">{faceName}</span>
                        <span className="badge dot">{bgName}</span>
                        {pose.isTemplate && <span className="badge dot accent">Template</span>}
                        {pose.showsLower
                          ? <span className="badge dot accent">Lower</span>
                          : pose.showsShoes
                          ? <span className="badge dot warn">Shoes</span>
                          : <span className="badge dot">Upper</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    {!pose.isTemplate && (
                      <button
                        className="btn sm ghost"
                        style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
                        onClick={() => setAsTemplate(pose.id)}
                      >
                        Set as template
                      </button>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Switch checked={pose.isActive} onChange={() => togglePose(pose.id)} />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn sm ghost" onClick={() => setEditingPose(pose)}><Icon.Edit /></button>
                        <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'pose', id: pose.id, label: pose.label })}><Icon.Trash /></button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {visiblePoses.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
                {poses.length === 0 ? 'No poses yet. Upload poses to get started.' : 'No poses match current filters.'}
              </div>
            )}
          </div>
        </>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>Delete {confirmDelete.type}</h3></div>
            <div className="modal-body">
              <p>Delete <strong>{confirmDelete.label}</strong>? This cannot be undone.</p>
              {confirmDelete.type === 'subcategory' && (
                <p style={{ color: 'var(--danger)', marginTop: 8 }}>All related poses and templates will also be deleted.</p>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn danger" onClick={doDelete}><Icon.Trash /> Delete</button>
            </div>
          </div>
        </div>
      )}

      {showBgUpload && (
        <UploadModal
          title="Add background"
          presignPath="/admin/assets/backgrounds/presign"
          confirmPath="/admin/assets/backgrounds/confirm"
          fields={BG_FIELDS}
          onDone={(row) => { setShowBgUpload(false); setBackgrounds((prev) => [...prev, row as ModelBackground]); }}
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
          onDone={(row) => { setShowFaceUpload(false); setFaces((prev) => [...prev, row as ModelFace]); }}
          onClose={() => setShowFaceUpload(false)}
          toast={toast}
        />
      )}
      {showBatchPoseUpload && subView.kind === 'subcategory' && (
        <PoseUploadModal
          subcategoryId={subView.sub.id}
          subcategoryGenderSlug={subView.sub.genderSlug}
          faces={faces}
          backgrounds={backgrounds}
          onDone={(added) => { setShowBatchPoseUpload(false); setPoses((prev) => [...prev, added]); }}
          onClose={() => setShowBatchPoseUpload(false)}
          toast={toast}
        />
      )}
      {editingPose && (
        <EditPoseModal
          pose={editingPose}
          faces={faces}
          backgrounds={backgrounds}
          onSaved={(updated) => {
            setPoses((prev) => prev.map((p) => p.id === updated.id ? updated : p));
            setEditingPose(null);
          }}
          onClose={() => setEditingPose(null)}
          toast={toast}
        />
      )}
      {editingBackground && (
        <EditBackgroundModal
          background={editingBackground}
          onSaved={(updated) => {
            setBackgrounds((prev) => prev.map((b) => b.id === updated.id ? updated : b));
            setEditingBackground(null);
          }}
          onClose={() => setEditingBackground(null)}
          toast={toast}
        />
      )}
      {editingFace && (
        <EditFaceModal
          face={editingFace}
          onSaved={(updated) => {
            setFaces((prev) => prev.map((f) => f.id === updated.id ? updated : f));
            setEditingFace(null);
          }}
          onClose={() => setEditingFace(null)}
          toast={toast}
        />
      )}
      {showSubcatModal && (
        <div className="modal-overlay" onClick={subcatSaving ? undefined : () => setShowSubcatModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, calc(100vw - 80px))' }}>
            <div className="modal-head">
              <h3>Add subcategory</h3>
              <button className="btn sm ghost" onClick={() => setShowSubcatModal(false)} disabled={subcatSaving} style={{ marginLeft: 'auto' }}>
                <Icon.Close />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                  onChange={(e) => setSubcatForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                />
              </div>
              <div className="field">
                <label>Gender</label>
                <select
                  className="select"
                  value={subcatForm.genderSlug}
                  disabled={subcatSaving}
                  onChange={(e) => setSubcatForm((f) => ({ ...f, genderSlug: e.target.value as GenderSlug }))}
                >
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                  <option value="boys">Boys</option>
                  <option value="girls">Girls</option>
                </select>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setShowSubcatModal(false)} disabled={subcatSaving}>Cancel</button>
              <button
                className="btn primary"
                disabled={subcatSaving || !subcatForm.label.trim() || !subcatForm.slug.trim()}
                onClick={async () => {
                  setSubcatSaving(true);
                  try {
                    const row = await apiFetch<GarmentSubcategory>('/admin/assets/subcategories', {
                      method: 'POST',
                      body: JSON.stringify(subcatForm),
                    });
                    setSubcategories((prev) => [...prev, row]);
                    toast({ title: `${row.label} created` });
                    setShowSubcatModal(false);
                  } catch {
                    toast({ kind: 'error', title: 'Failed to create subcategory' });
                  } finally {
                    setSubcatSaving(false);
                  }
                }}
              >
                <Icon.Add /> Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
