import { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/data';
import type { ModelBackground, ModelFace, ModelPose, WorkflowOption } from '../types';
import { Icon } from './Icons';

function ImagePicker({
  id,
  label,
  hint,
  currentUrl,
  file,
  disabled,
  onChange,
  onClear,
}: {
  id: string;
  label: string;
  hint?: string;
  currentUrl?: string | null;
  file: File | null;
  disabled: boolean;
  onChange: (f: File | null) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = file ? URL.createObjectURL(file) : null;
  const displayUrl = file ? previewUrl : currentUrl;

  return (
    <div className="field">
      <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>{label}</span>
        {hint && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{hint}</span>
        )}
      </label>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px',
          border: `1.5px dashed ${file ? 'var(--success-border, #4caf50)' : 'var(--border-strong, var(--border))'}`,
          borderRadius: 8,
          background: file
            ? 'var(--success-soft, rgba(76,175,80,0.06))'
            : 'var(--surface-2, var(--subtle))',
          transition: 'border-color 120ms',
        }}
      >
        {/* Thumbnail */}
        {displayUrl ? (
          <img
            src={displayUrl}
            alt={label}
            style={{
              width: 48,
              height: 60,
              objectFit: 'cover',
              borderRadius: 5,
              flexShrink: 0,
              border: '1px solid var(--border)',
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            style={{
              width: 48,
              height: 60,
              borderRadius: 5,
              background: 'var(--subtle)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              flexShrink: 0,
            }}
          >
            <Icon.Image />
          </div>
        )}

        {/* Info + actions */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {file ? (
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--ink-1)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {file.name}
            </div>
          ) : currentUrl ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Current image</div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>No image set</div>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {file
              ? `${(file.size / 1024).toFixed(0)} KB · will replace on save`
              : 'JPEG, PNG or WebP'}
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {file && (
            <button
              type="button"
              className="btn sm ghost"
              disabled={disabled}
              onClick={() => {
                onClear();
                if (inputRef.current) inputRef.current.value = '';
              }}
              style={{ fontSize: 11 }}
            >
              ✕ Clear
            </button>
          )}
          <label
            htmlFor={id}
            className="btn sm ghost"
            style={{
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {file ? 'Change' : 'Choose'}
          </label>
        </div>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          style={{ display: 'none' }}
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
      </div>
    </div>
  );
}

interface Props {
  pose: ModelPose;
  faces: ModelFace[];
  backgrounds: ModelBackground[];
  workflows: WorkflowOption[];
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
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

export function EditPoseModal({
  pose,
  faces,
  backgrounds,
  workflows,
  onSaved,
  onClose,
  toast,
}: Props) {
  const { storagePublicUrl } = useAuth();
  const [form, setForm] = useState({
    label: pose.label,
    faceId: pose.faceId,
    backgroundId: pose.backgroundId,
    sortOrder: pose.sortOrder,
    workflowTemplateId: pose.workflowTemplateId,
    promptGarmentPhase: pose.promptGarmentPhase ?? '',
  });

  const [faceSideFile, setFaceSideFile] = useState<File | null>(null);
  const [poseFile, setPoseFile] = useState<File | null>(null);
  const [bgComfyFile, setBgComfyFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      let faceSideR2Key: string | undefined;
      let newR2Key: string | undefined;
      let newThumbnailKey: string | undefined;
      let newBgComfyR2Key: string | undefined;

      if (faceSideFile) {
        const presign = await apiFetch<{ uploadUrl: string; r2Key: string }>(
          `/admin/assets/poses/${pose.id}/presign-faceside`,
          { method: 'POST', body: JSON.stringify({ contentType: faceSideFile.type }) },
        );
        await putFile(presign.uploadUrl, faceSideFile);
        faceSideR2Key = presign.r2Key;
      }

      if (poseFile) {
        const presign = await apiFetch<{
          uploadUrl: string;
          r2Key: string;
          thumbnailUploadUrl: string;
          thumbnailKey: string;
        }>(`/admin/assets/poses/${pose.id}/presign-pose`, {
          method: 'POST',
          body: JSON.stringify({ contentType: poseFile.type }),
        });
        await Promise.all([
          putFile(presign.uploadUrl, poseFile),
          putFile(presign.thumbnailUploadUrl, poseFile),
        ]);
        newR2Key = presign.r2Key;
        newThumbnailKey = presign.thumbnailKey;
      }

      if (bgComfyFile) {
        const presign = await apiFetch<{ uploadUrl: string; r2Key: string }>(
          `/admin/assets/poses/${pose.id}/presign-bgcomfy`,
          { method: 'POST', body: JSON.stringify({ contentType: bgComfyFile.type }) },
        );
        await putFile(presign.uploadUrl, bgComfyFile);
        newBgComfyR2Key = presign.r2Key;
      }

      const patch: Record<string, unknown> = {
        ...form,
        promptGarmentPhase: form.promptGarmentPhase.trim() || undefined,
      };
      if (faceSideR2Key) patch.faceSideR2Key = faceSideR2Key;
      if (newR2Key) patch.r2Key = newR2Key;
      if (newThumbnailKey) patch.thumbnailKey = newThumbnailKey;
      if (newBgComfyR2Key) patch.bgComfyR2Key = newBgComfyR2Key;

      await apiFetch(`/admin/assets/poses/${pose.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });

      onSaved({
        ...pose,
        ...form,
        promptGarmentPhase: form.promptGarmentPhase.trim() || pose.promptGarmentPhase,
        ...(faceSideR2Key ? { faceSideR2Key } : {}),
        ...(newR2Key ? { r2Key: newR2Key } : {}),
        ...(newThumbnailKey ? { thumbnailKey: newThumbnailKey } : {}),
        ...(newBgComfyR2Key ? { bgComfyR2Key: newBgComfyR2Key } : {}),
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
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, calc(100vw - 40px))' }}
      >
        <div className="modal-head">
          <h3>Edit pose</h3>
          <button
            className="btn sm ghost"
            onClick={onClose}
            disabled={saving}
            style={{ marginLeft: 'auto' }}
          >
            <Icon.Close />
          </button>
        </div>

        <div
          className="modal-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            maxHeight: '72vh',
            overflowY: 'auto',
          }}
        >
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

          <div className="field">
            <label>Workflow template</label>
            <select
              className="select"
              value={form.workflowTemplateId}
              disabled={saving}
              onChange={(e) => setForm((f) => ({ ...f, workflowTemplateId: e.target.value }))}
            >
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.label}
                  {wf.lowerNodeId ? ' · lower' : ''}
                  {wf.shoeNodeId ? ' · shoes' : ''}
                  {!wf.isActive ? ' (inactive)' : ''}
                </option>
              ))}
              {workflows.length === 0 && (
                <option value={form.workflowTemplateId}>Current workflow</option>
              )}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Model face (display &amp; filter)</label>
              {(() => {
                const sel = faces.find((f) => f.id === form.faceId);
                return sel && storagePublicUrl && sel.thumbnailKey ? (
                  <img
                    src={`${storagePublicUrl}/${sel.thumbnailKey}`}
                    alt={sel.label}
                    style={{
                      width: 56,
                      height: 72,
                      objectFit: 'cover',
                      borderRadius: 6,
                      marginBottom: 6,
                      display: 'block',
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : null;
              })()}
              <select
                className="select"
                value={form.faceId}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, faceId: e.target.value }))}
              >
                {faces.map((face) => (
                  <option key={face.id} value={face.id}>
                    [{face.gender}] {face.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Background</label>
              {(() => {
                const sel = backgrounds.find((b) => b.id === form.backgroundId);
                return sel && storagePublicUrl && sel.thumbnailKey ? (
                  <img
                    src={`${storagePublicUrl}/${sel.thumbnailKey}`}
                    alt={sel.label}
                    style={{
                      width: 56,
                      height: 72,
                      objectFit: 'cover',
                      borderRadius: 6,
                      marginBottom: 6,
                      display: 'block',
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : null;
              })()}
              <select
                className="select"
                value={form.backgroundId}
                disabled={saving}
                onChange={(e) => setForm((f) => ({ ...f, backgroundId: e.target.value }))}
              >
                {backgrounds.map((bg) => (
                  <option key={bg.id} value={bg.id}>
                    {bg.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <ImagePicker
              id="edit-pose-img"
              label="Pose image"
              hint="display + ComfyUI pose node"
              currentUrl={
                storagePublicUrl && pose.thumbnailKey
                  ? `${storagePublicUrl}/${pose.thumbnailKey}`
                  : null
              }
              file={poseFile}
              disabled={saving}
              onChange={setPoseFile}
              onClear={() => setPoseFile(null)}
            />
            <ImagePicker
              id="edit-faceside-img"
              label="Side / tilt face"
              hint="ComfyUI face node"
              currentUrl={
                storagePublicUrl && pose.faceSideR2Key
                  ? `${storagePublicUrl}/${pose.faceSideR2Key}`
                  : null
              }
              file={faceSideFile}
              disabled={saving}
              onChange={setFaceSideFile}
              onClear={() => setFaceSideFile(null)}
            />
            <ImagePicker
              id="edit-bgcomfy-img"
              label="Background (ComfyUI)"
              hint="ComfyUI bg node"
              currentUrl={
                storagePublicUrl && pose.bgComfyR2Key
                  ? `${storagePublicUrl}/${pose.bgComfyR2Key}`
                  : null
              }
              file={bgComfyFile}
              disabled={saving}
              onChange={setBgComfyFile}
              onClear={() => setBgComfyFile(null)}
            />
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0' }} />

          <div className="field">
            <label>Positive prompt</label>
            <textarea
              className="input"
              value={form.promptGarmentPhase}
              disabled={saving}
              rows={4}
              onChange={(e) => setForm((f) => ({ ...f, promptGarmentPhase: e.target.value }))}
              style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
            />
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
              onChange={(e) => {
                const n = Number(e.target.value);
                setForm((f) => ({ ...f, sortOrder: Number.isNaN(n) ? 0 : n }));
              }}
            />
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
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
