import { useState, useEffect, useCallback } from 'react';
import type {
  ModelFace, ModelBackground, GarmentSubcategory, ModelPose, SubcategoryTemplate, GenderSlug,
} from '../types';
import { apiFetch } from '../lib/data';
import { Icon } from '../components/Icons';
import { Switch } from '../components/Switch';
import { UploadModal } from '../components/UploadModal';
import type { FieldDef } from '../components/UploadModal';
import { BatchPoseUploadModal } from '../components/BatchPoseUploadModal';

type AssetTab = 'backgrounds' | 'faces' | 'subcategories';
type GenderFilter = 'all' | GenderSlug;

type SubView =
  | { kind: 'list' }
  | { kind: 'subcategory'; sub: GarmentSubcategory; subTab: 'poses' | 'templates' };

type ConfirmDelete =
  | { type: 'background'; id: string; label: string }
  | { type: 'face'; id: string; label: string }
  | { type: 'subcategory'; id: string; label: string }
  | { type: 'pose'; id: string; label: string }
  | { type: 'template'; id: string; label: string };

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

export default function AssetsPage({ onNav: _onNav, toast }: Props) {
  const [activeTab, setActiveTab] = useState<AssetTab>('backgrounds');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [subView, setSubView] = useState<SubView>({ kind: 'list' });

  const [backgrounds, setBackgrounds] = useState<ModelBackground[]>([]);
  const [faces, setFaces] = useState<ModelFace[]>([]);
  const [subcategories, setSubcategories] = useState<GarmentSubcategory[]>([]);
  const [poses, setPoses] = useState<ModelPose[]>([]);
  const [templates, setTemplates] = useState<SubcategoryTemplate[]>([]);
  const [poseFilterFace, setPoseFilterFace] = useState('');
  const [poseFilterBg, setPoseFilterBg] = useState('');
  const [showSubcatModal, setShowSubcatModal] = useState(false);
  const [subcatForm, setSubcatForm] = useState({ slug: '', label: '', genderSlug: 'men' as GenderSlug });
  const [subcatSaving, setSubcatSaving] = useState(false);

  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete | null>(null);

  const [showBgUpload, setShowBgUpload] = useState(false);
  const [showFaceUpload, setShowFaceUpload] = useState(false);
  const [showPoseUpload, setShowPoseUpload] = useState(false);
  const [showBatchPoseUpload, setShowBatchPoseUpload] = useState(false);
  const [showTmplUpload, setShowTmplUpload] = useState(false);

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

  const loadPoses = useCallback(async (subcategoryId: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ModelPose[] }>(`/admin/assets/poses?subcategoryId=${subcategoryId}`);
      setPoses(res.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load poses' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadTemplates = useCallback(async (subcategoryId: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: SubcategoryTemplate[] }>(`/admin/assets/templates?subcategoryId=${subcategoryId}`);
      setTemplates(res.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load templates' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeTab === 'backgrounds') loadBackgrounds();
    else if (activeTab === 'faces') loadFaces();
    else if (activeTab === 'subcategories') {
      if (subView.kind === 'list') loadSubcategories();
      else if (subView.subTab === 'poses') loadPoses(subView.sub.id);
      else loadTemplates(subView.sub.id);
    }
  }, [activeTab, subView, loadBackgrounds, loadFaces, loadSubcategories, loadPoses, loadTemplates]);

  // Preload faces + backgrounds silently so pose upload selects + filters are populated
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

  const toggleTemplate = async (id: string) => {
    const item = templates.find((t) => t.id === id);
    if (!item) return;
    const next = !item.isActive;
    setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, isActive: next } : t));
    try {
      await apiFetch(`/admin/assets/templates/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
      toast({ title: `Template ${item.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, isActive: item.isActive } : t));
      toast({ kind: 'error', title: 'Failed to update template' });
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
      template: `/admin/assets/templates/${id}`,
    };
    try {
      await apiFetch(paths[type], { method: 'DELETE' });
      if (type === 'background') setBackgrounds((prev) => prev.filter((b) => b.id !== id));
      else if (type === 'face') setFaces((prev) => prev.filter((f) => f.id !== id));
      else if (type === 'subcategory') {
        setSubcategories((prev) => prev.filter((s) => s.id !== id));
        setSubView({ kind: 'list' });
      } else if (type === 'pose') setPoses((prev) => prev.filter((p) => p.id !== id));
      else if (type === 'template') setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast({ title: `${label} deleted` });
    } catch {
      toast({ kind: 'error', title: `Failed to delete ${type}` });
    }
  };

  const thumb = (label: string, w = 64, h = 64) => (
    <div style={{
      width: w, height: h, borderRadius: 6,
      background: 'var(--subtle)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, color: 'var(--muted)', fontSize: 11, fontWeight: 600,
    }}>
      {label.slice(0, 2).toUpperCase()}
    </div>
  );

  const poseFields: FieldDef[] = [
    { type: 'text', name: 'label', label: 'Label', required: true, placeholder: 'e.g. m1bg1p1' },
    {
      type: 'select', name: 'faceId', label: 'Model face (which model is in this image)',
      options: faces.map((f) => ({ value: f.id, label: `[${f.gender}] ${f.label}` })),
    },
    {
      type: 'select', name: 'backgroundId', label: 'Background (which background is in this image)',
      options: backgrounds.map((b) => ({ value: b.id, label: b.label })),
    },
    { type: 'toggle', name: 'showsLower', label: 'Shows lower garment (legs/trousers visible)' },
    { type: 'toggle', name: 'showsShoes', label: 'Shows shoes (feet visible)' },
    { type: 'number', name: 'sortOrder', label: 'Sort order (lower = first)', min: 0, defaultValue: 0 },
  ];

  const tmplFields: FieldDef[] = [
    {
      type: 'select', name: 'faceId', label: 'Model face (pre-rendered with this face)',
      options: faces.map((f) => ({ value: f.id, label: `[${f.gender}] ${f.label}` })),
    },
    {
      type: 'select', name: 'backgroundId', label: 'Background (pre-rendered with this background)',
      options: backgrounds.map((b) => ({ value: b.id, label: b.label })),
    },
    { type: 'number', name: 'sortOrder', label: 'Sort order (lower = first)', min: 0, defaultValue: 0 },
  ];

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
            {activeTab === 'subcategories' && subView.kind === 'list' && 'Garment subcategories. Click to manage poses and templates.'}
            {activeTab === 'subcategories' && subView.kind === 'subcategory' && `Poses and templates for ${subView.sub.genderSlug} / ${subView.sub.slug}.`}
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
          {activeTab === 'subcategories' && subView.kind === 'subcategory' && subView.subTab === 'poses' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" onClick={() => setShowPoseUpload(true)}><Icon.Add /> Single</button>
              <button className="btn" onClick={() => setShowBatchPoseUpload(true)}><Icon.Upload /> Batch upload</button>
            </div>
          )}
          {activeTab === 'subcategories' && subView.kind === 'subcategory' && subView.subTab === 'templates' && (
            <button className="btn" onClick={() => {
              if (faces.length === 0 || backgrounds.length === 0) {
                toast({ kind: 'error', title: 'Load faces and backgrounds first (visit those tabs)' });
                return;
              }
              setShowTmplUpload(true);
            }}><Icon.Add /> Add template</button>
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
                {thumb(bg.label, 64, 48)}
                <div style={{ marginTop: 4 }}>
                  <span className="semi">{bg.label}</span>
                  <span className="sub mono" style={{ display: 'block', marginTop: 2 }}>{bg.id.slice(0, 8)}…</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <Switch checked={bg.isActive} onChange={() => toggleBg(bg.id)} />
                <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'background', id: bg.id, label: bg.label })}><Icon.Trash /></button>
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
                  {thumb(face.label, 48, 64)}
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
                  <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'face', id: face.id, label: face.label })}><Icon.Trash /></button>
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
                  onClick={() => setSubView({ kind: 'subcategory', sub, subTab: 'poses' })}>
                  <td>
                    <div>
                      <span className="semi">{sub.label}</span>
                      <span className="sub mono" style={{ display: 'block' }}>{sub.slug}</span>
                    </div>
                  </td>
                  <td><span className="badge dot accent">{sub.genderSlug}</span></td>
                  <td><span className="mono">{sub.poseCount ?? 0}</span></td>
                  <td><span className="mono">{sub.templateCount ?? 0} / 16</span></td>
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
          <div className="tabs" style={{ marginTop: -8 }}>
            {(['poses', 'templates'] as const).map((t) => (
              <button key={t} className={`tab ${subView.subTab === t ? 'active' : ''}`}
                onClick={() => setSubView({ ...subView, subTab: t })}>
                {t === 'poses' ? 'Poses' : 'Templates'}
              </button>
            ))}
          </div>

          {subView.subTab === 'poses' && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, marginBottom: 4, flexWrap: 'wrap' }}>
                <select
                  className="select"
                  style={{ minWidth: 160 }}
                  value={poseFilterFace}
                  onChange={(e) => setPoseFilterFace(e.target.value)}
                >
                  <option value="">All faces</option>
                  {faces.map((f) => <option key={f.id} value={f.id}>[{f.gender}] {f.label}</option>)}
                </select>
                <select
                  className="select"
                  style={{ minWidth: 160 }}
                  value={poseFilterBg}
                  onChange={(e) => setPoseFilterBg(e.target.value)}
                >
                  <option value="">All backgrounds</option>
                  {backgrounds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
                {(poseFilterFace || poseFilterBg) && (
                  <button className="btn sm ghost" onClick={() => { setPoseFilterFace(''); setPoseFilterBg(''); }}>
                    Clear filter
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginTop: 10 }}>
                {poses
                  .filter((p) =>
                    (!poseFilterFace || p.faceId === poseFilterFace) &&
                    (!poseFilterBg || p.backgroundId === poseFilterBg)
                  )
                  .map((pose) => {
                    const faceName = faces.find((f) => f.id === pose.faceId)?.label ?? '?';
                    const bgName = backgrounds.find((b) => b.id === pose.backgroundId)?.label ?? '?';
                    return (
                      <div key={pose.id} className="card" style={{ opacity: pose.isActive ? 1 : 0.6, padding: 14 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          {thumb(pose.label, 48, 64)}
                          <div style={{ marginTop: 4 }}>
                            <span className="semi">{pose.label}</span>
                            <span className="sub mono" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
                              {faceName} × {bgName}
                            </span>
                            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {pose.showsLower && <span className="badge dot accent">Lower</span>}
                              {pose.showsShoes && <span className="badge dot warn">Shoes</span>}
                              {!pose.showsLower && !pose.showsShoes && <span className="badge dot">Upper</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                          <Switch checked={pose.isActive} onChange={() => togglePose(pose.id)} />
                          <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'pose', id: pose.id, label: pose.label })}><Icon.Trash /></button>
                        </div>
                      </div>
                    );
                  })}
                {poses.filter((p) =>
                  (!poseFilterFace || p.faceId === poseFilterFace) &&
                  (!poseFilterBg || p.backgroundId === poseFilterBg)
                ).length === 0 && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
                    {poses.length === 0 ? 'No poses yet.' : 'No poses match filter.'}
                  </div>
                )}
              </div>
            </>
          )}

          {subView.subTab === 'templates' && (
            <>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8, marginBottom: 14 }}>
                {templates.length} / 16 templates uploaded (4 model faces × 4 backgrounds).
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
                {templates.map((tmpl) => (
                  <div key={tmpl.id} className="card" style={{ opacity: tmpl.isActive ? 1 : 0.6, padding: 14 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      {thumb(tmpl.faceLabel ?? '??', 48, 64)}
                      <div style={{ marginTop: 4 }}>
                        <span className="semi" style={{ fontSize: 12 }}>{tmpl.faceLabel}</span>
                        <span className="sub mono" style={{ display: 'block', marginTop: 2, fontSize: 11 }}>× {tmpl.backgroundLabel}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                      <Switch checked={tmpl.isActive} onChange={() => toggleTemplate(tmpl.id)} />
                      <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'template', id: tmpl.id, label: `${tmpl.faceLabel} × ${tmpl.backgroundLabel}` })}><Icon.Trash /></button>
                    </div>
                  </div>
                ))}
                {templates.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>No templates yet.</div>
                )}
              </div>
            </>
          )}
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
      {showPoseUpload && subView.kind === 'subcategory' && (
        <UploadModal
          title="Add pose"
          presignPath="/admin/assets/poses/presign"
          presignExtra={{ subcategoryId: subView.sub.id }}
          confirmPath="/admin/assets/poses/confirm"
          confirmExtra={{ subcategoryId: subView.sub.id }}
          fields={poseFields}
          onDone={(row) => { setShowPoseUpload(false); setPoses((prev) => [...prev, row as ModelPose]); }}
          onClose={() => setShowPoseUpload(false)}
          toast={toast}
        />
      )}
      {showBatchPoseUpload && subView.kind === 'subcategory' && (
        <BatchPoseUploadModal
          subcategoryId={subView.sub.id}
          faces={faces}
          backgrounds={backgrounds}
          onDone={(added) => { setShowBatchPoseUpload(false); setPoses((prev) => [...prev, ...added]); }}
          onClose={() => setShowBatchPoseUpload(false)}
          toast={toast}
        />
      )}
      {showTmplUpload && subView.kind === 'subcategory' && (
        <UploadModal
          title="Add template"
          presignPath="/admin/assets/templates/presign"
          presignExtra={{ subcategoryId: subView.sub.id }}
          confirmPath="/admin/assets/templates/confirm"
          confirmExtra={{ subcategoryId: subView.sub.id }}
          fields={tmplFields}
          onDone={(row) => { setShowTmplUpload(false); setTemplates((prev) => [...prev, row as SubcategoryTemplate]); }}
          onClose={() => setShowTmplUpload(false)}
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
