import { useState, useRef } from 'react';
import { Icon } from './Icons';
import { Switch } from './Switch';
import { apiFetch } from '../lib/data';
import type { ModelFace, ModelBackground, ModelPose, WorkflowTemplate } from '../types';

const WORKFLOW_OPTIONS: { value: WorkflowTemplate; label: string }[] = [
  { value: 'twopiece', label: 'Two-Piece (Upper + Lower)' },
  { value: 'onepiece', label: 'One-Piece / Full Outfit' },
  { value: 'hijab', label: 'Hijab / Head Cover' },
];

interface Props {
  pose: ModelPose;
  faces: ModelFace[];
  backgrounds: ModelBackground[];
  onSaved: (updated: ModelPose) => void;
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

export function EditPoseModal({ pose, faces, backgrounds, onSaved, onClose, toast }: Props) {
  const [form, setForm] = useState({
    label: pose.label,
    faceId: pose.faceId,
    backgroundId: pose.backgroundId,
    showsLower: pose.showsLower,
    showsShoes: pose.showsShoes,
    sortOrder: pose.sortOrder,
    workflowTemplate: pose.workflowTemplate,
    promptFacePhase: pose.promptFacePhase ?? '',
    promptGarmentPhase: pose.promptGarmentPhase ?? '',
  });
  const [faceSideFile, setFaceSideFile] = useState<File | null>(null);
  const faceSideRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      let faceSideR2Key: string | undefined;

      // If a new side face was selected, presign → upload → capture key
      if (faceSideFile) {
        const presign = await apiFetch<{ uploadUrl: string; r2Key: string }>(
          `/admin/assets/poses/${pose.id}/presign-faceside`,
          { method: 'POST', body: JSON.stringify({ contentType: faceSideFile.type }) },
        );
        await putFile(presign.uploadUrl, faceSideFile);
        faceSideR2Key = presign.r2Key;
      }

      const patch: Record<string, unknown> = {
        ...form,
        promptFacePhase: form.promptFacePhase.trim() || undefined,
        promptGarmentPhase: form.promptGarmentPhase.trim() || undefined,
      };
      if (faceSideR2Key) patch['faceSideR2Key'] = faceSideR2Key;

      await apiFetch(`/admin/assets/poses/${pose.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });

      onSaved({
        ...pose,
        ...form,
        promptFacePhase: form.promptFacePhase.trim() || pose.promptFacePhase,
        promptGarmentPhase: form.promptGarmentPhase.trim() || pose.promptGarmentPhase,
        ...(faceSideR2Key ? { faceSideR2Key } : {}),
      });
      toast({ title: `${form.label} updated` });
      onClose();
    } catch {
      toast({ kind: 'error', title: 'Failed to update pose' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, calc(100vw - 40px))' }}>
        <div className="modal-head">
          <h3>Edit pose</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={saving} style={{ marginLeft: 'auto' }}>
            <Icon.Close />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '72vh', overflowY: 'auto' }}>
          <div className="field">
            <label>Label</label>
            <input
              className="input"
              value={form.label}
              disabled={saving}
              placeholder="e.g. m1bg1p1"
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Model face (display &amp; filter)</label>
              <select
                className="select"
                value={form.faceId}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, faceId: e.target.value }))}
              >
                {faces.map((face) => (
                  <option key={face.id} value={face.id}>[{face.gender}] {face.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Background</label>
              <select
                className="select"
                value={form.backgroundId}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, backgroundId: e.target.value }))}
              >
                {backgrounds.map((bg) => (
                  <option key={bg.id} value={bg.id}>{bg.label}</option>
                ))}
              </select>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0' }} />

          {/* Side face replacement */}
          <div className="field">
            <label>
              Side / tilt face
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>(backend only — sent to ComfyUI face node)</span>
            </label>
            {pose.faceSideR2Key && !faceSideFile && (
              <span style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, display: 'block' }}>
                Current: <code style={{ fontSize: 11 }}>{pose.faceSideR2Key}</code>
              </span>
            )}
            <input
              ref={faceSideRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={saving}
              onChange={(e) => setFaceSideFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: 13 }}
            />
            {faceSideFile && (
              <span style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--accent)' }}>↑</span>
                {faceSideFile.name} — will replace on save
                <button className="btn sm ghost" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => { setFaceSideFile(null); if (faceSideRef.current) faceSideRef.current.value = ''; }}>
                  ✕
                </button>
              </span>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0' }} />

          {/* Workflow */}
          <div className="field">
            <label>Workflow template</label>
            <select
              className="select"
              value={form.workflowTemplate}
              disabled={saving}
              onChange={(e) => setForm((f) => ({ ...f, workflowTemplate: e.target.value as WorkflowTemplate }))}
            >
              {WORKFLOW_OPTIONS.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Face phase prompt (positive)</label>
            <textarea
              className="input"
              value={form.promptFacePhase}
              disabled={saving}
              rows={4}
              onChange={(e) => setForm((f) => ({ ...f, promptFacePhase: e.target.value }))}
              style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
            />
          </div>
          <div className="field">
            <label>Garment phase prompt (positive)</label>
            <textarea
              className="input"
              value={form.promptGarmentPhase}
              disabled={saving}
              rows={4}
              onChange={(e) => setForm((f) => ({ ...f, promptGarmentPhase: e.target.value }))}
              style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
            />
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0' }} />

          <div style={{ display: 'flex', gap: 24 }}>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 0 }}>
              <Switch checked={form.showsLower} onChange={() => { if (!saving) setForm((f) => ({ ...f, showsLower: !f.showsLower })); }} />
              <label style={{ margin: 0, cursor: 'pointer' }} onClick={() => { if (!saving) setForm((f) => ({ ...f, showsLower: !f.showsLower })); }}>
                Shows lower garment
              </label>
            </div>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 0 }}>
              <Switch checked={form.showsShoes} onChange={() => { if (!saving) setForm((f) => ({ ...f, showsShoes: !f.showsShoes })); }} />
              <label style={{ margin: 0, cursor: 'pointer' }} onClick={() => { if (!saving) setForm((f) => ({ ...f, showsShoes: !f.showsShoes })); }}>
                Shows shoes
              </label>
            </div>
          </div>

          <div className="field">
            <label>Sort order</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.sortOrder}
              disabled={saving}
              style={{ width: 100 }}
              onChange={(e) => { const n = Number(e.target.value); setForm((f) => ({ ...f, sortOrder: Number.isNaN(n) ? 0 : n })); }}
            />
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={saving || !form.label.trim() || !form.faceId || !form.backgroundId}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
