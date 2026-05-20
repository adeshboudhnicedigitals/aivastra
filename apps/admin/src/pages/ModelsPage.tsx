import { useState } from 'react';
import type { ModelFace, ModelBackground, ModelPose, GenderSlug } from '../types';
import { MOCK_FACES, MOCK_BACKGROUNDS, MOCK_POSES } from '../lib/data';
import { Icon } from '../components/Icons';
import { Switch } from '../components/Switch';

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
  | { type: 'face'; id: string }
  | { type: 'background'; id: string }
  | { type: 'pose'; id: string };

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function ModelsPage({ onNav: _onNav, toast }: Props) {
  const [faces, setFaces] = useState<ModelFace[]>(MOCK_FACES);
  const [backgrounds, setBackgrounds] = useState<ModelBackground[]>(MOCK_BACKGROUNDS);
  const [poses, setPoses] = useState<ModelPose[]>(MOCK_POSES);
  const [view, setView] = useState<View>({ kind: 'faces' });
  const [genderTab, setGenderTab] = useState<GenderTab>('all');
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete | null>(null);

  // ── Toggle handlers ──────────────────────────────────────────────────────

  const toggleFaceActive = (id: string) => {
    const face = faces.find((f) => f.id === id);
    setFaces((prev) => prev.map((f) => f.id === id ? { ...f, isActive: !f.isActive } : f));
    if (face) toast({ title: `${face.label} ${face.isActive ? 'deactivated' : 'activated'}` });
  };

  const toggleBackgroundActive = (id: string) => {
    const bg = backgrounds.find((b) => b.id === id);
    setBackgrounds((prev) => prev.map((b) => b.id === id ? { ...b, isActive: !b.isActive } : b));
    if (bg) toast({ title: `${bg.label} ${bg.isActive ? 'deactivated' : 'activated'}` });
  };

  const togglePoseActive = (id: string) => {
    const pose = poses.find((p) => p.id === id);
    setPoses((prev) => prev.map((p) => p.id === id ? { ...p, isActive: !p.isActive } : p));
    if (pose) toast({ title: `${pose.label} ${pose.isActive ? 'deactivated' : 'activated'}` });
  };

  // ── Delete handlers ──────────────────────────────────────────────────────

  const doDelete = () => {
    if (!confirmDelete) return;

    if (confirmDelete.type === 'face') {
      const face = faces.find((f) => f.id === confirmDelete.id);
      const relatedBgIds = backgrounds.filter((b) => b.faceId === confirmDelete.id).map((b) => b.id);
      setFaces((prev) => prev.filter((f) => f.id !== confirmDelete.id));
      setBackgrounds((prev) => prev.filter((b) => b.faceId !== confirmDelete.id));
      setPoses((prev) => prev.filter((p) => !relatedBgIds.includes(p.backgroundId)));
      toast({ title: `${face?.label ?? confirmDelete.id} deleted` });
    } else if (confirmDelete.type === 'background') {
      const bg = backgrounds.find((b) => b.id === confirmDelete.id);
      setBackgrounds((prev) => prev.filter((b) => b.id !== confirmDelete.id));
      setPoses((prev) => prev.filter((p) => p.backgroundId !== confirmDelete.id));
      toast({ title: `${bg?.label ?? confirmDelete.id} deleted` });
    } else {
      const pose = poses.find((p) => p.id === confirmDelete.id);
      setPoses((prev) => prev.filter((p) => p.id !== confirmDelete.id));
      toast({ title: `${pose?.label ?? confirmDelete.id} deleted` });
    }

    setConfirmDelete(null);
  };

  // ── Header helpers ───────────────────────────────────────────────────────

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

  // ── Filtered data ────────────────────────────────────────────────────────

  const filteredFaces = faces.filter((f) => genderTab === 'all' || f.gender === genderTab);

  const filteredBackgrounds = view.kind === 'backgrounds' || view.kind === 'poses'
    ? backgrounds.filter((b) => b.faceId === (view.kind === 'backgrounds' ? view.faceId : view.faceId))
    : [];

  const filteredPoses = view.kind === 'poses'
    ? poses.filter((p) => p.backgroundId === view.backgroundId)
    : [];

  // ── Inline thumb placeholder renderer ───────────────────────────────────

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

  // ── Delete modal label helper ─────────────────────────────────────────

  const deleteLabel = (() => {
    if (!confirmDelete) return '';
    if (confirmDelete.type === 'face') return faces.find((f) => f.id === confirmDelete.id)?.label ?? confirmDelete.id;
    if (confirmDelete.type === 'background') return backgrounds.find((b) => b.id === confirmDelete.id)?.label ?? confirmDelete.id;
    return poses.find((p) => p.id === confirmDelete.id)?.label ?? confirmDelete.id;
  })();

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="page-head">
        <div>
          {/* Breadcrumb */}
          {view.kind !== 'faces' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 13, color: 'var(--muted)' }}>
              <button
                className="btn sm ghost"
                onClick={() => setView({ kind: 'faces' })}
                style={{ padding: '2px 8px', fontSize: 13 }}
              >
                Models
              </button>
              <Icon.Chevron />
              {view.kind === 'poses' && (
                <>
                  <button
                    className="btn sm ghost"
                    onClick={() => setView({ kind: 'backgrounds', faceId: view.faceId, faceLabel: view.faceLabel })}
                    style={{ padding: '2px 8px', fontSize: 13 }}
                  >
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
          <button className="btn">
            <Icon.Add /> {addLabel}
          </button>
        </div>
      </div>

      {/* ── Gender tabs (faces view only) ──────────────────────────────── */}
      {view.kind === 'faces' && (
        <div className="tabs">
          {GENDER_TABS.map((t) => (
            <button
              key={t.k}
              className={`tab ${genderTab === t.k ? 'active' : ''}`}
              onClick={() => setGenderTab(t.k)}
            >
              {t.l}
            </button>
          ))}
        </div>
      )}

      {/* ── Faces grid ─────────────────────────────────────────────────── */}
      {view.kind === 'faces' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {filteredFaces.map((face) => (
            <div key={face.id} className="card" style={{ opacity: face.isActive ? 1 : 0.6 }}>
              <div
                style={{ cursor: 'pointer' }}
                onClick={() => setView({ kind: 'backgrounds', faceId: face.id, faceLabel: face.label })}
              >
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
                  <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'face', id: face.id })}><Icon.Trash /></button>
                </div>
              </div>
            </div>
          ))}
          {filteredFaces.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
              No faces found.
            </div>
          )}
        </div>
      )}

      {/* ── Backgrounds grid ───────────────────────────────────────────── */}
      {view.kind === 'backgrounds' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {filteredBackgrounds.map((bg) => (
            <div key={bg.id} className="card" style={{ opacity: bg.isActive ? 1 : 0.6 }}>
              <div
                style={{ cursor: 'pointer' }}
                onClick={() => setView({ kind: 'poses', faceId: view.faceId, faceLabel: view.faceLabel, backgroundId: bg.id, backgroundLabel: bg.label })}
              >
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
                  <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'background', id: bg.id })}><Icon.Trash /></button>
                </div>
              </div>
            </div>
          ))}
          {filteredBackgrounds.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
              No backgrounds found for this face.
            </div>
          )}
        </div>
      )}

      {/* ── Poses grid ─────────────────────────────────────────────────── */}
      {view.kind === 'poses' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {filteredPoses.map((pose) => (
            <div key={pose.id} className="card" style={{ opacity: pose.isActive ? 1 : 0.6 }}>
              <div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {renderThumb(pose.label)}
                  <div style={{ marginTop: 4 }}>
                    <span className="semi">{pose.label}</span>
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {pose.showsLower && (
                        <span className="badge dot accent">Shows lower</span>
                      )}
                      {pose.showsShoes && (
                        <span className="badge dot warn">Shows shoes</span>
                      )}
                      {!pose.showsLower && !pose.showsShoes && (
                        <span className="badge dot">Upper only</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <Switch checked={pose.isActive} onChange={() => togglePoseActive(pose.id)} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn sm ghost"><Icon.Edit /></button>
                  <button className="btn sm ghost" onClick={() => setConfirmDelete({ type: 'pose', id: pose.id })}><Icon.Trash /></button>
                </div>
              </div>
            </div>
          ))}
          {filteredPoses.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
              No poses found for this background.
            </div>
          )}
        </div>
      )}

      {/* ── Delete confirm modal ────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                Delete {confirmDelete.type === 'face' ? 'face' : confirmDelete.type === 'background' ? 'background' : 'pose'}
              </h3>
            </div>
            <div className="modal-body">
              <p>
                Delete <strong>{deleteLabel}</strong>? This cannot be undone.
              </p>
              {confirmDelete.type === 'face' && (
                <p style={{ color: 'var(--danger)', marginTop: 8 }}>
                  All related backgrounds and poses will also be deleted.
                </p>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn danger" onClick={doDelete}><Icon.Trash /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
