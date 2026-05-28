import { useState, useEffect } from 'react';
import { Icon } from './Icons';
import { Switch } from './Switch';
import { apiFetch } from '../lib/data';
import { useAuth } from '../context/AuthContext';
import type { ModelFace, ModelBackground, ModelPose, WorkflowOption } from '../types';

interface PresignResult {
  uploadUrl: string;
  r2Key: string;
  thumbnailUploadUrl: string;
  thumbnailKey: string;
  faceSideUploadUrl: string;
  faceSideR2Key: string;
  bgComfyUploadUrl: string;
  bgComfyR2Key: string;
  newFaceUploadUrl?: string;
  newFaceR2Key?: string;
  newFaceThumbnailUploadUrl?: string;
  newFaceThumbnailKey?: string;
  newBgUploadUrl?: string;
  newBgR2Key?: string;
  newBgThumbnailUploadUrl?: string;
  newBgThumbnailKey?: string;
}

interface Props {
  garmentTypeId: string;
  garmentTypeGenderSlug: string;
  faces: ModelFace[];
  backgrounds: ModelBackground[];
  onDone: (added: ModelPose) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

async function putFile(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

// ── Sub-components ───────────────────────────────────────────────

function UploadZone({ id, label, hint, badge, file, onChange, disabled }: {
  id: string;
  label: string;
  hint?: string;
  badge?: { text: string; color: 'warn' | 'info' };
  file: File | null;
  onChange: (f: File | null) => void;
  disabled: boolean;
}) {
  return (
    <label htmlFor={id} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 5, padding: '16px 10px', minHeight: 104,
      border: `1.5px dashed ${file ? 'var(--success-border)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--r-lg)',
      background: file ? 'var(--success-soft)' : 'var(--surface-2)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'border-color 120ms, background 120ms',
      textAlign: 'center', userSelect: 'none', flex: 1,
      opacity: disabled ? 0.7 : 1,
    }}>
      {file ? (
        <>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="10" stroke="var(--success)" strokeWidth="1.5" />
            <path d="M7 11.5l2.5 2.5 5.5-5.5" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file.name.length > 22 ? file.name.slice(0, 20) + '…' : file.name}
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{(file.size / 1024).toFixed(0)} KB</span>
        </>
      ) : (
        <>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 15V9M11 9L8 12M11 9l3 3" stroke="var(--muted-2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 16v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="var(--muted-2)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</span>
          {badge && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '1px 7px', borderRadius: 99,
              background: badge.color === 'warn' ? 'var(--warn-soft)' : 'var(--info-soft)',
              color: badge.color === 'warn' ? 'var(--warn-ink)' : 'var(--info-ink)',
              border: `1px solid ${badge.color === 'warn' ? 'var(--warn-border)' : 'var(--info-border)'}`,
            }}>
              {badge.text}
            </span>
          )}
          {hint && <span style={{ fontSize: 10, color: 'var(--muted)' }}>{hint}</span>}
          <span style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>Click to choose</span>
        </>
      )}
      <input id={id} type="file" accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }} disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  );
}

function Seg({ options, value, onChange, disabled }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 3, gap: 2 }}>
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled}
          onClick={() => onChange(o.value)}
          style={{
            padding: '4px 12px', fontSize: 12, fontWeight: 500,
            border: '1px solid transparent', borderRadius: 4,
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: value === o.value ? 'var(--surface)' : 'transparent',
            color: value === o.value ? 'var(--ink)' : 'var(--muted)',
            borderColor: value === o.value ? 'var(--border)' : 'transparent',
            boxShadow: value === o.value ? 'var(--shadow-sm)' : 'none',
            transition: 'all 80ms ease',
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export function PoseUploadModal({ garmentTypeId, garmentTypeGenderSlug, faces, backgrounds, onDone, onClose, toast }: Props) {
  const { storagePublicUrl } = useAuth();
  const filteredFaces = faces.filter((f) => f.gender === garmentTypeGenderSlug);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [workflowTemplateId, setWorkflowTemplateId] = useState<string>('');
  const [promptFacePhase, setPromptFacePhase] = useState('');
  const [promptGarmentPhase, setPromptGarmentPhase] = useState('');
  const [promptsOpen, setPromptsOpen] = useState(false);

  const [faceMode, setFaceMode] = useState<'existing' | 'new'>('existing');
  const [faceId, setFaceId] = useState(filteredFaces[0]?.id ?? '');
  const [newFaceFile, setNewFaceFile] = useState<File | null>(null);

  const [bgMode, setBgMode] = useState<'existing' | 'new'>('existing');
  const [bgId, setBgId] = useState(backgrounds[0]?.id ?? '');
  const [newBgFile, setNewBgFile] = useState<File | null>(null);

  const [poseFile, setPoseFile] = useState<File | null>(null);
  const [faceSideFile, setFaceSideFile] = useState<File | null>(null);
  const [bgComfyFile, setBgComfyFile] = useState<File | null>(null);

  const [label, setLabel] = useState('');
  const [showsLower, setShowsLower] = useState(true);
  const [showsShoes, setShowsShoes] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);
  const [isTemplate, setIsTemplate] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<WorkflowOption[]>('/admin/workflows').then((wfs) => {
      const active = wfs.filter((w) => w.isActive);
      setWorkflows(active);
      if (active.length > 0) {
        const first = active[0]!;
        setWorkflowTemplateId(first.id);
        setPromptFacePhase(first.defaultFacePhasePrompt);
        setPromptGarmentPhase(first.defaultGarmentPhasePrompt);
      }
    }).catch(() => toast({ kind: 'error', title: 'Failed to load workflow options' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWorkflowChange = (id: string) => {
    setWorkflowTemplateId(id);
    const wf = workflows.find((w) => w.id === id);
    if (wf) {
      setPromptFacePhase(wf.defaultFacePhasePrompt);
      setPromptGarmentPhase(wf.defaultGarmentPhasePrompt);
    }
  };

  const handleUpload = async () => {
    if (!poseFile) { setError('Pose image is required'); return; }
    if (!faceSideFile) { setError('Side / tilt face is required'); return; }
    if (!bgComfyFile) { setError('Background for ComfyUI is required'); return; }
    if (faceMode === 'existing' && !faceId) { setError('Select a model face'); return; }
    if (faceMode === 'new' && !newFaceFile) { setError('Upload a new face image'); return; }
    if (bgMode === 'existing' && !bgId) { setError('Select a background'); return; }
    if (bgMode === 'new' && !newBgFile) { setError('Upload a new background image'); return; }
    if (!promptFacePhase.trim() || !promptGarmentPhase.trim()) { setError('Both prompts are required'); return; }
    if (!label.trim()) { setError('Pose label is required'); return; }

    setUploading(true);
    setError(null);

    try {
      const presignBody: Record<string, unknown> = {
        garmentTypeId,
        contentType: poseFile.type,
        faceSideContentType: faceSideFile.type,
        bgComfyContentType: bgComfyFile.type,
      };
      if (faceMode === 'existing') presignBody['faceId'] = faceId;
      else presignBody['newFaceContentType'] = newFaceFile!.type;
      if (bgMode === 'existing') presignBody['backgroundId'] = bgId;
      else presignBody['newBgContentType'] = newBgFile!.type;

      const presign = await apiFetch<PresignResult>('/admin/assets/poses/presign', {
        method: 'POST',
        body: JSON.stringify(presignBody),
      });

      const uploads: Promise<void>[] = [
        putFile(presign.uploadUrl, poseFile),
        putFile(presign.thumbnailUploadUrl, poseFile),
        putFile(presign.faceSideUploadUrl, faceSideFile),
        putFile(presign.bgComfyUploadUrl, bgComfyFile),
      ];
      if (faceMode === 'new') {
        if (!presign.newFaceUploadUrl || !presign.newFaceThumbnailUploadUrl) throw new Error('Server did not return face upload URLs');
        uploads.push(putFile(presign.newFaceUploadUrl, newFaceFile!));
        uploads.push(putFile(presign.newFaceThumbnailUploadUrl, newFaceFile!));
      }
      if (bgMode === 'new') {
        if (!presign.newBgUploadUrl || !presign.newBgThumbnailUploadUrl) throw new Error('Server did not return background upload URLs');
        uploads.push(putFile(presign.newBgUploadUrl, newBgFile!));
        uploads.push(putFile(presign.newBgThumbnailUploadUrl, newBgFile!));
      }
      await Promise.all(uploads);

      const confirmBody: Record<string, unknown> = {
        garmentTypeId,
        label: label.trim(),
        r2Key: presign.r2Key,
        thumbnailKey: presign.thumbnailKey,
        faceSideR2Key: presign.faceSideR2Key,
        bgComfyR2Key: presign.bgComfyR2Key,
        workflowTemplateId,
        promptFacePhase: promptFacePhase.trim(),
        promptGarmentPhase: promptGarmentPhase.trim(),
        showsLower,
        showsShoes,
        isTemplate,
        sortOrder,
      };
      if (faceMode === 'existing') {
        confirmBody['faceId'] = faceId;
      } else {
        confirmBody['newFace'] = {
          r2Key: presign.newFaceR2Key,
          thumbnailKey: presign.newFaceThumbnailKey,
          filename: newFaceFile!.name,
        };
      }
      if (bgMode === 'existing') {
        confirmBody['backgroundId'] = bgId;
      } else {
        confirmBody['newBackground'] = {
          r2Key: presign.newBgR2Key,
          thumbnailKey: presign.newBgThumbnailKey,
          filename: newBgFile!.name,
        };
      }

      const pose = await apiFetch<ModelPose>('/admin/assets/poses/confirm', {
        method: 'POST',
        body: JSON.stringify(confirmBody),
      });

      toast({ title: `Pose "${pose.label}" uploaded` });
      onDone(pose);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const canSubmit = !uploading && poseFile && faceSideFile && bgComfyFile && label.trim() && workflowTemplateId &&
    (faceMode === 'existing' ? Boolean(faceId) : Boolean(newFaceFile)) &&
    (bgMode === 'existing' ? Boolean(bgId) : Boolean(newBgFile)) &&
    promptFacePhase.trim() && promptGarmentPhase.trim();

  const selectedFace = filteredFaces.find((f) => f.id === faceId) ?? null;
  const selectedBg = backgrounds.find((b) => b.id === bgId) ?? null;

  const faceOpts = [{ value: 'existing', label: 'Use existing' }, { value: 'new', label: 'Upload new' }];
  const bgOpts = [{ value: 'existing', label: 'Use existing' }, { value: 'new', label: 'Upload new' }];

  return (
    <div className="modal-overlay" onClick={uploading ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(700px, calc(100vw - 40px))' }}>

        {/* Header */}
        <div className="modal-head" style={{ padding: '14px 20px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>Upload pose</h3>
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
              Fill all required fields then click Upload pose.
            </p>
          </div>
          <button className="btn sm ghost" onClick={onClose} disabled={uploading} style={{ marginLeft: 'auto' }}>
            <Icon.Close />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxHeight: '70vh', overflowY: 'auto', padding: '20px 22px' }}>

          {/* ── Section 1: Required images ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SectionHead>Required images</SectionHead>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <UploadZone
                id="poseFile"
                label="Pose image"
                file={poseFile}
                disabled={uploading}
                onChange={(f) => { setPoseFile(f); if (f && !label) setLabel(f.name.replace(/\.[^.]+$/, '')); }}
              />
              <UploadZone
                id="faceSideFile"
                label="Side / tilt face"
                badge={{ text: 'ComfyUI face node', color: 'warn' }}
                file={faceSideFile}
                disabled={uploading}
                onChange={setFaceSideFile}
              />
              <UploadZone
                id="bgComfyFile"
                label="Background"
                badge={{ text: 'ComfyUI bg node', color: 'info' }}
                file={bgComfyFile}
                disabled={uploading}
                onChange={setBgComfyFile}
              />
            </div>
          </div>

          {/* ── Section 2: Model face & Background (display/filter) ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionHead>Display &amp; filter</SectionHead>

            {/* Model face */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Model face</span>
                <Seg options={faceOpts} value={faceMode} onChange={(v) => setFaceMode(v as 'existing' | 'new')} disabled={uploading} />
              </div>
              {faceMode === 'existing' ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {storagePublicUrl && selectedFace?.thumbnailKey ? (
                    <img
                      src={`${storagePublicUrl}/${selectedFace.thumbnailKey}`}
                      alt={selectedFace.label}
                      style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 'var(--r)', flexShrink: 0, border: '1px solid var(--border)', background: 'var(--surface-2)' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div style={{ width: 48, height: 64, borderRadius: 'var(--r)', flexShrink: 0, border: '1px dashed var(--border)', background: 'var(--surface-2)' }} />
                  )}
                  <select className="select" value={faceId} disabled={uploading}
                    onChange={(e) => setFaceId(e.target.value)}
                    style={{ width: '100%', alignSelf: 'center' }}>
                    {filteredFaces.length === 0
                      ? <option value="">No faces available — upload new</option>
                      : filteredFaces.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                </div>
              ) : (
                <UploadZone
                  id="newFaceFile"
                  label="Face image"
                  hint="Will be saved as a new model face"
                  file={newFaceFile}
                  disabled={uploading}
                  onChange={setNewFaceFile}
                />
              )}
            </div>

            {/* Background */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Background</span>
                <Seg options={bgOpts} value={bgMode} onChange={(v) => setBgMode(v as 'existing' | 'new')} disabled={uploading} />
              </div>
              {bgMode === 'existing' ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {storagePublicUrl && selectedBg?.thumbnailKey ? (
                    <img
                      src={`${storagePublicUrl}/${selectedBg.thumbnailKey}`}
                      alt={selectedBg.label}
                      style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 'var(--r)', flexShrink: 0, border: '1px solid var(--border)', background: 'var(--surface-2)' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div style={{ width: 48, height: 64, borderRadius: 'var(--r)', flexShrink: 0, border: '1px dashed var(--border)', background: 'var(--surface-2)' }} />
                  )}
                  <select className="select" value={bgId} disabled={uploading}
                    onChange={(e) => setBgId(e.target.value)}
                    style={{ width: '100%', alignSelf: 'center' }}>
                    {backgrounds.length === 0
                      ? <option value="">No backgrounds available — upload new</option>
                      : backgrounds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                </div>
              ) : (
                <UploadZone
                  id="newBgFile"
                  label="Background image"
                  hint="Will be saved as a new background"
                  file={newBgFile}
                  disabled={uploading}
                  onChange={setNewBgFile}
                />
              )}
            </div>
          </div>

          {/* ── Section 3: Workflow ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SectionHead>Workflow</SectionHead>

            <div className="field">
              <label>Template</label>
              <select className="select" value={workflowTemplateId} disabled={uploading || workflows.length === 0}
                onChange={(e) => handleWorkflowChange(e.target.value)}>
                {workflows.length === 0
                  ? <option value="">Loading…</option>
                  : workflows.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </div>

            {/* Collapsible prompts */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              <button type="button" disabled={uploading}
                onClick={() => setPromptsOpen((v) => !v)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', background: 'var(--surface-2)', border: 'none',
                  cursor: 'pointer', gap: 10,
                }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Prompts</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {!promptsOpen && promptFacePhase && (
                    <span style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {promptFacePhase.slice(0, 60)}{promptFacePhase.length > 60 ? '…' : ''}
                    </span>
                  )}
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                    style={{ color: 'var(--muted)', transform: promptsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>
                    <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
              {promptsOpen && (
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--border)' }}>
                  <div className="field">
                    <label>Face phase prompt</label>
                    <textarea className="input" value={promptFacePhase} disabled={uploading} rows={4}
                      onChange={(e) => setPromptFacePhase(e.target.value)}
                      style={{ fontSize: 12, fontFamily: 'var(--mono)', resize: 'vertical' }} />
                  </div>
                  <div className="field">
                    <label>Garment phase prompt</label>
                    <textarea className="input" value={promptGarmentPhase} disabled={uploading} rows={4}
                      onChange={(e) => setPromptGarmentPhase(e.target.value)}
                      style={{ fontSize: 12, fontFamily: 'var(--mono)', resize: 'vertical' }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Section 4: Details ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionHead>Details</SectionHead>

            <div className="field">
              <label>Pose label <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input" value={label} disabled={uploading}
                placeholder="e.g. Front view, Standing pose…"
                onChange={(e) => setLabel(e.target.value)} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
                <Switch checked={showsLower} onChange={() => { if (!uploading) setShowsLower((v) => !v); }} />
                <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 450 }}>Shows lower garment</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
                <Switch checked={showsShoes} onChange={() => { if (!uploading) setShowsShoes((v) => !v); }} />
                <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 450 }}>Shows shoes</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
              <div className="field">
                <label>Sort order</label>
                <input className="input" type="number" min={0} value={sortOrder} disabled={uploading}
                  onChange={(e) => { const n = Number(e.target.value); setSortOrder(Number.isNaN(n) ? 0 : n); }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', marginTop: 'auto' }}>
                <Switch checked={isTemplate} onChange={() => { if (!uploading) setIsTemplate((v) => !v); }} />
                <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 450 }}>Set as template for this cell</span>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 'var(--r-lg)', color: 'var(--danger-ink)', fontSize: 13 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 5v4M8 10.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-foot" style={{ position: 'relative', overflow: 'hidden' }}>
          {uploading && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: 'var(--border)',
            }}>
              <div style={{
                height: '100%', background: 'var(--accent)',
                animation: 'shimmer 1.4s linear infinite',
                backgroundImage: 'linear-gradient(90deg, var(--accent) 0%, var(--accent-soft) 50%, var(--accent) 100%)',
                backgroundSize: '200% 100%',
              }} />
            </div>
          )}
          <button className="btn ghost" onClick={onClose} disabled={uploading}>Cancel</button>
          <button className="btn primary" onClick={handleUpload} disabled={!canSubmit}>
            <Icon.Upload />
            {uploading ? 'Uploading…' : 'Upload pose'}
          </button>
        </div>

      </div>
    </div>
  );
}
