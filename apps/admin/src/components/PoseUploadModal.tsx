import { useState, useEffect, useRef } from 'react';
import { Icon } from './Icons';
import { Switch } from './Switch';
import { apiFetch } from '../lib/data';
import type { ModelFace, ModelBackground, ModelPose, WorkflowOption } from '../types';

interface PresignResult {
  uploadUrl: string;
  r2Key: string;
  thumbnailUploadUrl: string;
  thumbnailKey: string;
  faceSideUploadUrl: string;
  faceSideR2Key: string;
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

export function PoseUploadModal({ garmentTypeId, garmentTypeGenderSlug, faces, backgrounds, onDone, onClose, toast }: Props) {
  const filteredFaces = faces.filter((f) => f.gender === garmentTypeGenderSlug);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [workflowTemplateId, setWorkflowTemplateId] = useState<string>('');
  const [promptFacePhase, setPromptFacePhase] = useState('');
  const [promptGarmentPhase, setPromptGarmentPhase] = useState('');

  const [faceMode, setFaceMode] = useState<'existing' | 'new'>('existing');
  const [faceId, setFaceId] = useState(filteredFaces[0]?.id ?? '');
  const [newFaceFile, setNewFaceFile] = useState<File | null>(null);
  const newFaceRef = useRef<HTMLInputElement>(null);

  const [bgMode, setBgMode] = useState<'existing' | 'new'>('existing');
  const [bgId, setBgId] = useState(backgrounds[0]?.id ?? '');
  const [newBgFile, setNewBgFile] = useState<File | null>(null);
  const newBgRef = useRef<HTMLInputElement>(null);

  const [poseFile, setPoseFile] = useState<File | null>(null);
  const [faceSideFile, setFaceSideFile] = useState<File | null>(null);

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
    if (!poseFile || !faceSideFile) { setError('Pose image and side face are required'); return; }
    if (faceMode === 'existing' && !faceId) { setError('Select a model face'); return; }
    if (faceMode === 'new' && !newFaceFile) { setError('Upload a new face image'); return; }
    if (bgMode === 'existing' && !bgId) { setError('Select a background'); return; }
    if (bgMode === 'new' && !newBgFile) { setError('Upload a new background image'); return; }
    if (!promptFacePhase.trim() || !promptGarmentPhase.trim()) { setError('Both prompts are required'); return; }
    if (!label.trim()) { setError('Label is required'); return; }

    setUploading(true);
    setError(null);

    try {
      const presignBody: Record<string, unknown> = {
        garmentTypeId,
        contentType: poseFile.type,
        faceSideContentType: faceSideFile.type,
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

  const canSubmit = !uploading && poseFile && faceSideFile && label.trim() && workflowTemplateId &&
    (faceMode === 'existing' ? Boolean(faceId) : Boolean(newFaceFile)) &&
    (bgMode === 'existing' ? Boolean(bgId) : Boolean(newBgFile)) &&
    promptFacePhase.trim() && promptGarmentPhase.trim();

  return (
    <div className="modal-overlay" onClick={uploading ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, calc(100vw - 40px))' }}>
        <div className="modal-head">
          <h3>Upload pose</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={uploading} style={{ marginLeft: 'auto' }}>
            <Icon.Close />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '72vh', overflowY: 'auto' }}>

          {/* Pose image */}
          <div className="field">
            <label>Pose image <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0] ?? null; setPoseFile(f); if (f && !label) setLabel(f.name.replace(/\.[^.]+$/, '')); }}
              style={{ fontSize: 13 }} />
            {poseFile && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{poseFile.name} ({(poseFile.size / 1024).toFixed(0)} KB)</span>}
          </div>

          {/* Side / tilt face */}
          <div className="field">
            <label>
              Side / tilt face <span style={{ color: 'var(--danger)' }}>*</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>(backend only — sent to ComfyUI face node)</span>
            </label>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
              onChange={(e) => setFaceSideFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: 13 }} />
            {faceSideFile && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{faceSideFile.name} ({(faceSideFile.size / 1024).toFixed(0)} KB)</span>}
          </div>

          {/* Model face (display / filter) */}
          <div className="field">
            <label>Model face (display &amp; filter)</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className={`btn sm ${faceMode === 'existing' ? 'primary' : 'ghost'}`} disabled={uploading} onClick={() => setFaceMode('existing')}>Use existing</button>
              <button className={`btn sm ${faceMode === 'new' ? 'primary' : 'ghost'}`} disabled={uploading} onClick={() => setFaceMode('new')}>Upload new</button>
            </div>
            {faceMode === 'existing' ? (
              <select className="select" value={faceId} disabled={uploading} onChange={(e) => setFaceId(e.target.value)}>
                {filteredFaces.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            ) : (
              <>
                <input ref={newFaceRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
                  onChange={(e) => setNewFaceFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
                {newFaceFile && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{newFaceFile.name}</span>}
              </>
            )}
          </div>

          {/* Background */}
          <div className="field">
            <label>Background</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className={`btn sm ${bgMode === 'existing' ? 'primary' : 'ghost'}`} disabled={uploading} onClick={() => setBgMode('existing')}>Use existing</button>
              <button className={`btn sm ${bgMode === 'new' ? 'primary' : 'ghost'}`} disabled={uploading} onClick={() => setBgMode('new')}>Upload new</button>
            </div>
            {bgMode === 'existing' ? (
              <select className="select" value={bgId} disabled={uploading} onChange={(e) => setBgId(e.target.value)}>
                {backgrounds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            ) : (
              <>
                <input ref={newBgRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
                  onChange={(e) => setNewBgFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
                {newBgFile && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{newBgFile.name}</span>}
              </>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          {/* Workflow */}
          <div className="field">
            <label>Workflow template</label>
            <select className="select" value={workflowTemplateId} disabled={uploading || workflows.length === 0}
              onChange={(e) => handleWorkflowChange(e.target.value)}>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              {workflows.length === 0 && <option value="">Loading…</option>}
            </select>
          </div>

          {/* Prompts */}
          <div className="field">
            <label>Face phase prompt (positive)</label>
            <textarea
              className="input"
              value={promptFacePhase}
              disabled={uploading}
              rows={5}
              onChange={(e) => setPromptFacePhase(e.target.value)}
              style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
            />
          </div>
          <div className="field">
            <label>Garment phase prompt (positive)</label>
            <textarea
              className="input"
              value={promptGarmentPhase}
              disabled={uploading}
              rows={5}
              onChange={(e) => setPromptGarmentPhase(e.target.value)}
              style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
            />
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          {/* Label + toggles */}
          <div className="field">
            <label>Pose label <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input className="input" value={label} disabled={uploading} placeholder="e.g. Front view, Standing pose…"
              onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 0 }}>
              <Switch checked={showsLower} onChange={() => { if (!uploading) setShowsLower((v) => !v); }} />
              <label style={{ margin: 0 }}>Shows lower garment</label>
            </div>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 0 }}>
              <Switch checked={showsShoes} onChange={() => { if (!uploading) setShowsShoes((v) => !v); }} />
              <label style={{ margin: 0 }}>Shows shoes</label>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Sort order</label>
              <input className="input" type="number" min={0} value={sortOrder} disabled={uploading}
                onChange={(e) => { const n = Number(e.target.value); setSortOrder(Number.isNaN(n) ? 0 : n); }} style={{ width: 100 }} />
            </div>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 'auto 0 0' }}>
              <input type="checkbox" id="isTemplate" checked={isTemplate} disabled={uploading}
                onChange={(e) => setIsTemplate(e.target.checked)} />
              <label htmlFor="isTemplate" style={{ margin: 0 }}>Set as template for this cell</label>
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 13, color: 'var(--danger)', padding: '8px 12px', background: 'var(--danger-soft)', borderRadius: 6 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-foot">
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
