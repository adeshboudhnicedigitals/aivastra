import { useState, useEffect, useCallback } from 'react';
import type { ModelFace, ModelBackground, ModelPose, GenderSlug } from '../types';
import { apiFetch } from '../lib/data';
import { Icon } from '../components/Icons';
import { Switch } from '../components/Switch';
import { UploadModal } from '../components/UploadModal';
import type { FieldDef } from '../components/UploadModal';

type GenderTab = 'all' | GenderSlug;
const GENDER_TABS: { k: GenderTab; l: string }[] = [
  { k: 'all', l: 'All' },
  { k: 'men', l: 'Men' },
  { k: 'women', l: 'Women' },
  { k: 'boys', l: 'Boys' },
  { k: 'girls', l: 'Girls' },
];

type View =
  | { kind: 'faces' }
  | { kind: 'backgrounds'; faceId: string; faceLabel: string }
  | { kind: 'poses'; faceId: string; faceLabel: string; backgroundId: string; backgroundLabel: string };

type ConfirmDelete =
  | { type: 'face'; id: string; label: string }
  | { type: 'background'; id: string; label: string }
  | { type: 'pose'; id: string; label: string };

type UploadTarget =
  | { kind: 'face' }
  | { kind: 'background'; faceId: string }
  | { kind: 'pose'; backgroundId: string };

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

const FACE_FIELDS: FieldDef[] = [
  { type: 'text', name: 'label', label: 'Label', required: true },
  {
    type: 'select', name: 'gender', label: 'Gender',
    options: [
      { value: 'men', label: 'Men' },
      { value: 'women', label: 'Women' },
      { value: 'boys', label: 'Boys' },
      { value: 'girls', label: 'Girls' },
    ],
  },
  { type: 'number', name: 'sortOrder', label: 'Sort order', min: 0, defaultValue: 0 },
];

const BG_FIELDS: FieldDef[] = [
  { type: 'text', name: 'label', label: 'Label', required: true },
  { type: 'number', name: 'sortOrder', label: 'Sort order', min: 0, defaultValue: 0 },
];

const POSE_FIELDS: FieldDef[] = [
  { type: 'text', name: 'label', label: 'Label', required: true },
  { type: 'toggle', name: 'showsLower', label: 'Shows lower garment' },
  { type: 'toggle', name: 'showsShoes', label: 'Shows shoes' },
  { type: 'number', name: 'sortOrder', label: 'Sort order', min: 0, defaultValue: 0 },
];

export default function ModelsPage({ onNav: _onNav, toast }: Props) {
  const [faces, setFaces] = useState<ModelFace[]>([]);
  const [backgrounds, setBackgrounds] = useState<ModelBackground[]>([]);
  const [poses, setPoses] = useState<ModelPose[]>([]);
  const [view, setView] = useState<View>({ kind: 'faces' });
  const [genderTab, setGenderTab] = useState<GenderTab>('all');
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete | null>(null);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null);
  const [loading, setLoading] = useState(false);

  const loadFaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ModelFace[] }>('/admin/models/faces');
      setFaces(res.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load faces' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadBackgrounds = useCallback(async (faceId: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ModelBackground[] }>(`/admin/models/backgrounds?faceId=${faceId}`);
      setBackgrounds(res.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load backgrounds' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadPoses = useCallback(async (backgroundId: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ModelPose[] }>(`/admin/models/poses?backgroundId=${backgroundId}`);
      setPoses(res.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load poses' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (view.kind === 'faces') loadFaces();
    else if (view.kind === 'backgrounds') loadBackgrounds(view.faceId);
    else loadPoses(view.backgroundId);
  }, [view, loadFaces, loadBackgrounds, loadPoses]);

  // ── Toggle handlers ──────────────────────────────────────────────────────

  const toggleFaceActive = async (id: string) => {
    const face = faces.find((f) => f.id === id);
    if (!face) return;
    const next = !face.isActive;
    setFaces((prev) => prev.map((f) => f.id === id ? { ...f, isActive: next } : f));
    try {
      await apiFetch(`/admin/models/faces/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
      toast({ title: `${face.label} ${face.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setFaces((prev) => prev.map((f) => f.id === id ? { ...f, isActive: face.isActive } : f));
      toast({ kind: 'error', title: 'Failed to update face' });
    }
  };

  const toggleBackgroundActive = async (id: string) => {
    const bg = backgrounds.find((b) => b.id === id);
    if (!bg) return;
    const next = !bg.isActive;
    setBackgrounds((prev) => prev.map((b) => b.id === id ? { ...b, isActive: next } : b));
    try {
      await apiFetch(`/admin/models/backgrounds/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
      toast({ title: `${bg.label} ${bg.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setBackgrounds((prev) => prev.map((b) => b.id === id ? { ...b, isActive: bg.isActive } : b));
      toast({ kind: 'error', title: 'Failed to update background' });
    }
  };

  const togglePoseActive = async (id: string) => {
    const pose = poses.find((p) => p.id === id);
    if (!pose) return;
    const next = !pose.isActive;
    setPoses((prev) => prev.map((p) => p.id === id ? { ...p, isActive: next } : p));
    try {
      await apiFetch(`/admin/models/poses/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
      toast({ title: `${pose.label} ${pose.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setPoses((prev) => prev.map((p) => p.id === id ? { ...p, isActive: pose.isActive } : p));
      toast({ kind: 'error', title: 'Failed to update pose' });
    }
  };

  // ── Delete handler ────────────────────────────────────────────────────────

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { type, id, label } = confirmDelete;
    setConfirmDelete(null);
    try {
      await apiFetch(`/admin/models/${type === 'face' ? 'faces' : type === 'background' ? 'backgrounds' : 'poses'}/${id}`, { method: 'DELETE' });
      if (type === 'face') setFaces((prev) => prev.filter((f) => f.id !== id));
      else if (type === 'background') setBackgrounds((prev) => prev.filter((b) => b.id !== id));
      else setPoses((prev) => prev.filter((p) => p.id !== id));
      toast({ title: `${label} deleted` });
    } catch {
      toast({ kind: 'error', title: `Failed to delete ${type}` });
    }
  };

  // ── Upload modal config ───────────────────────────────────────────────────

  const uploadConfig = uploadTarget === null ? null : (() => {
    if (uploadTarget.kind === 'face') {
      return {
        title: 'Add face',
        presignPath: '/admin/models/faces/presign',
        confirmPath: '/admin/models/faces/confirm',
        fields: FACE_FIELDS,
        presignExtra: undefined as Record<string, unknown> | undefined,
        confirmExtra: undefined as Record<string, unknown> | undefined,
      };
    }
    if (uploadTarget.kind === 'background') {
      return {
        title: 'Add background',
        presignPath: '/admin/models/backgrounds/presign',
        confirmPath: '/admin/models/backgrounds/confirm',
        fields: BG_FIELDS,
        presignExtra: { faceId: uploadTarget.faceId },
        confirmExtra: { faceId: uploadTarget.faceId },
      };
    }
    return {
      title: 'Add pose',
      presignPath: '/admin/models/poses/presign',
      confirmPath: '/admin/models/poses/confirm',
      fields: POSE_FIELDS,
      presignExtra: { backgroundId: uploadTarget.backgroundId },
      confirmExtra: { backgroundId: uploadTarget.backgroundId },
    };
  })();

  // ── Header helpers ────────────────────────────────────────────────────────

  const pageTitle = view.kind === 'faces'
    ? 'Models'
    : view.kind === 'backgrounds'
      ? view.faceLabel
      : view.backgroundLabel;

  const pageLede = view.kind === 'faces'
    ? 'Manage model faces. Click a face to configure backgrounds and poses.'
    : view.kind === 'backgrounds'
      ? `Backgrounds for ${view.faceLabel}. Click a background to manage poses.`
      : `Poses for ${view.backgroundLabel}.`;

  const addLabel = view.kind === 'faces'
    ? 'Add face'
    : view.kind === 'backgrounds'
      ? 'Add background'
      : 'Add pose';

  const handleAddClick = () => {
    if (view.kind === 'faces') setUploadTarget({ kind: 'face' });
    else if (view.kind === 'backgrounds') setUploadTarget({ kind: 'background', faceId: view.faceId });
    else setUploadTarget({ kind: 'pose', backgroundId: view.backgroundId });
  };

  // ── Filtered data ─────────────────────────────────────────────────────────

  const filteredFaces = faces.filter((f) => genderTab === 'all' || f.gender === genderTab);
  const filteredBackgrounds = (view.kind === 'backgrounds' || view.kind === 'poses')
    ? backgrounds.filter((b) => b.faceId === view.faceId)
    : [];
  const filteredPoses = view.kind === 'poses'
    ? poses.filter((p) => p.backgroundId === view.backgroundId)
    : [];

  // ── Thumb placeholder ─────────────────────────────────────────────────────

  const renderThumb = (label: string) => (
    <div style={{
      width: 48, height: 64, borderRadius: 6,
      background: 'var(--subtle)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, color: 'var(--muted)', fontSize: 12, fontWeight: 600,
    }}>
      {label.slice(0, 2).toUpperCase()}
    </div>
  );

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="page-head">
        <div>
          {view.kind !== 'faces' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 13, color: 'var(--muted)' }}>
              <button className="btn sm ghost" onClick={() => setView({ kind: 'faces' })} style={{ padding: '2px 8px', fontSize: 13 }}>
                Models
              </button>
              <Icon.Chevron />
              {view.kind === 'poses' && (
                <>
                  <button className="btn sm ghost" onClick={() => setView({ kind: 'backgrounds', faceId: view.faceId, faceLabel: view.faceLabel })} style={{ padding: '2px 8px', fontSize: 13 }}>
                    {view.faceLabel}
                  </button>
                  <Icon.Chevron />
                </>
              )}
              <span>{pageTitle}</span>
            </div>
          )}
          <h1>{pageTitle}</h1>
          <p className="lede">{pageLede}</p>
        </div>
        <div className="head-tools">
          <button className="btn" onClick={handleAddClick}>
            <Icon.Add /> {addLabel}
          </button>
        </div>
      </div>

      {/* ── Loading ─────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>Loading…</div>
      )}

      {/* ── Gender tabs ─────────────────────────────────────────────────── */}
      {!loading && view.kind === 'faces' && (
        <div className="tabs">
          {GENDER_TABS.map((t) => (
            <button key={t.k} className={`tab ${genderTab === t.k ? 'active' : ''}`} onClick={() => setGenderTab(t.k)}>
              {t.l}
            </button>
          ))}
        </div>
      )}

      {/* ── Faces grid ─────────────────────────────────────────────────── */}
      {!loading && view.kind === 'faces' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {filteredFaces.map((face) => (
            <div key={face.id} className="card" style={{ opacity: face.isActive ? 1 : 0.6, padding: 14 }}>
              <div style={{ cursor: 'pointer' }} onClick={() => setView({ kind: 'backgrounds', faceId: face.id, faceLabel: face.label })}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {renderThumb(face.label)}
                  <div style={{ marginTop: 4 }}>
                    <span className="semi">{face.label}</span>
                    <div style={{ marginTop: 4 }}>
                      <span className="badge dot accent">{face.gender}</span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                      {face.backgroundCount ?? 0} background{face.backgroundCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <Switch checked={face.isActive} onChange={() => toggleFaceActive(face.id)} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn sm ghost"><Icon.Edit /></button>
                  <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'face', id: face.id, label: face.label })}><Icon.Trash /></button>
                </div>
              </div>
            </div>
          ))}
          {filteredFaces.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>No faces found.</div>
          )}
        </div>
      )}

      {/* ── Backgrounds grid ───────────────────────────────────────────── */}
      {!loading && view.kind === 'backgrounds' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {filteredBackgrounds.map((bg) => (
            <div key={bg.id} className="card" style={{ opacity: bg.isActive ? 1 : 0.6, padding: 14 }}>
              <div style={{ cursor: 'pointer' }} onClick={() => setView({ kind: 'poses', faceId: view.faceId, faceLabel: view.faceLabel, backgroundId: bg.id, backgroundLabel: bg.label })}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {renderThumb(bg.label)}
                  <div style={{ marginTop: 4 }}>
                    <span className="semi">{bg.label}</span>
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                      {bg.poseCount ?? 0} pose{bg.poseCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <Switch checked={bg.isActive} onChange={() => toggleBackgroundActive(bg.id)} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn sm ghost"><Icon.Edit /></button>
                  <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'background', id: bg.id, label: bg.label })}><Icon.Trash /></button>
                </div>
              </div>
            </div>
          ))}
          {filteredBackgrounds.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>No backgrounds found for this face.</div>
          )}
        </div>
      )}

      {/* ── Poses grid ─────────────────────────────────────────────────── */}
      {!loading && view.kind === 'poses' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {filteredPoses.map((pose) => (
            <div key={pose.id} className="card" style={{ opacity: pose.isActive ? 1 : 0.6, padding: 14 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {renderThumb(pose.label)}
                <div style={{ marginTop: 4 }}>
                  <span className="semi">{pose.label}</span>
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {pose.showsLower && <span className="badge dot accent">Shows lower</span>}
                    {pose.showsShoes && <span className="badge dot warn">Shows shoes</span>}
                    {!pose.showsLower && !pose.showsShoes && <span className="badge dot">Upper only</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <Switch checked={pose.isActive} onChange={() => togglePoseActive(pose.id)} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn sm ghost"><Icon.Edit /></button>
                  <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'pose', id: pose.id, label: pose.label })}><Icon.Trash /></button>
                </div>
              </div>
            </div>
          ))}
          {filteredPoses.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>No poses found for this background.</div>
          )}
        </div>
      )}

      {/* ── Delete confirm modal ────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete {confirmDelete.type}</h3>
            </div>
            <div className="modal-body">
              <p>Delete <strong>{confirmDelete.label}</strong>? This cannot be undone.</p>
              {confirmDelete.type === 'face' && (
                <p style={{ color: 'var(--danger)', marginTop: 8 }}>All related backgrounds and poses will also be deleted.</p>
              )}
              {confirmDelete.type === 'background' && (
                <p style={{ color: 'var(--danger)', marginTop: 8 }}>All related poses will also be deleted.</p>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn danger" onClick={doDelete}><Icon.Trash /> Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Upload modal ────────────────────────────────────────────────── */}
      {uploadTarget && uploadConfig && (
        <UploadModal
          title={uploadConfig.title}
          presignPath={uploadConfig.presignPath}
          presignExtra={uploadConfig.presignExtra}
          confirmPath={uploadConfig.confirmPath}
          confirmExtra={uploadConfig.confirmExtra}
          fields={uploadConfig.fields}
          onDone={(row) => {
            setUploadTarget(null);
            if (view.kind === 'faces') setFaces((prev) => [...prev, row as ModelFace]);
            else if (view.kind === 'backgrounds') setBackgrounds((prev) => [...prev, row as ModelBackground]);
            else setPoses((prev) => [...prev, row as ModelPose]);
          }}
          onClose={() => setUploadTarget(null)}
          toast={toast}
        />
      )}
    </>
  );
}
