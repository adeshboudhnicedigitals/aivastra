import { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type {
  GenderSlug,
  ModelBackground,
  ModelFace,
  ModelPoseAsset,
  WorkflowOption,
} from '../types';
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
        {displayUrl ? (
          // biome-ignore lint/performance/noImgElement: admin panel thumbnail
          <img
            src={displayUrl}
            alt=""
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

async function putFile(url: string, file: Blob): Promise<void> {
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

interface Props {
  asset: ModelPoseAsset;
  faces: ModelFace[];
  backgrounds: ModelBackground[];
  workflows: WorkflowOption[];
  onSaved: (updated: ModelPoseAsset) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export function EditPoseAssetModal({
  asset,
  faces,
  backgrounds,
  workflows,
  onSaved,
  onClose,
  toast,
}: Props) {
  const { storagePublicUrl } = useAuth();
  const [label, _setLabel] = useState(asset.label);
  const [displayName, setDisplayName] = useState(asset.displayName ?? '');
  const [genderSlug, setGenderSlug] = useState<GenderSlug>(
    (asset.genderSlug ?? 'men') as GenderSlug,
  );
  const [faceId, setFaceId] = useState(asset.faceId ?? '');
  const [backgroundId, setBackgroundId] = useState(asset.backgroundId ?? '');
  const [workflowTemplateId, setWorkflowTemplateId] = useState(asset.workflowTemplateId ?? '');
  const [prompt, setPrompt] = useState(
    asset.promptGarmentPhase ??
      workflows.find((w) => w.id === asset.workflowTemplateId)?.defaultGarmentPhasePrompt ??
      '',
  );
  const [poseFile, setPoseFile] = useState<File | null>(null);
  const [faceSideFile, setFaceSideFile] = useState<File | null>(null);
  const [bgComfyFile, setBgComfyFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedFace = faces.find((f) => f.id === faceId);
  const selectedBg = backgrounds.find((b) => b.id === backgroundId);

  // Derived fallback keys: use face/bg r2Key when explicit key is absent
  const faceSideCurrentUrl = storagePublicUrl
    ? asset.faceSideR2Key
      ? `${storagePublicUrl}/${asset.faceSideR2Key}`
      : selectedFace?.r2Key
        ? `${storagePublicUrl}/${selectedFace.r2Key}`
        : null
    : null;

  const bgComfyCurrentUrl = storagePublicUrl
    ? asset.bgComfyR2Key
      ? `${storagePublicUrl}/${asset.bgComfyR2Key}`
      : selectedBg?.r2Key
        ? `${storagePublicUrl}/${selectedBg.r2Key}`
        : null
    : null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        displayName: displayName.trim() || null,
        genderSlug,
        faceId: faceId || null,
        backgroundId: backgroundId || null,
        workflowTemplateId: workflowTemplateId || null,
        promptGarmentPhase: prompt.trim() || null,
      };

      // Auto-backfill faceSideR2Key from selected face if not set and no new file chosen
      if (!faceSideFile && !asset.faceSideR2Key && selectedFace?.r2Key) {
        patch.faceSideR2Key = selectedFace.r2Key;
      }
      // Auto-backfill bgComfyR2Key from selected background if not set and no new file chosen
      if (!bgComfyFile && !asset.bgComfyR2Key && selectedBg?.r2Key) {
        patch.bgComfyR2Key = selectedBg.r2Key;
      }

      if (poseFile) {
        const presign = await apiFetch<{
          r2Key: string;
          uploadUrl: string;
          thumbnailKey: string;
          thumbnailUploadUrl: string;
        }>(`/admin/assets/pose-assets/${asset.id}/presign-pose`, {
          method: 'POST',
          body: JSON.stringify({ contentType: poseFile.type }),
        });
        await Promise.all([
          putFile(presign.uploadUrl, poseFile),
          makeThumbnail(poseFile).then((t) => putFile(presign.thumbnailUploadUrl, t)),
        ]);
        patch.r2Key = presign.r2Key;
        patch.thumbnailKey = presign.thumbnailKey;
      }

      if (faceSideFile) {
        const presign = await apiFetch<{ r2Key: string; uploadUrl: string }>(
          `/admin/assets/pose-assets/${asset.id}/presign-faceside`,
          { method: 'POST', body: JSON.stringify({ contentType: faceSideFile.type }) },
        );
        await putFile(presign.uploadUrl, faceSideFile);
        patch.faceSideR2Key = presign.r2Key;
      }

      if (bgComfyFile) {
        const presign = await apiFetch<{ r2Key: string; uploadUrl: string }>(
          `/admin/assets/pose-assets/${asset.id}/presign-bgcomfy`,
          { method: 'POST', body: JSON.stringify({ contentType: bgComfyFile.type }) },
        );
        await putFile(presign.uploadUrl, bgComfyFile);
        patch.bgComfyR2Key = presign.r2Key;
      }

      const updated = await apiFetch<ModelPoseAsset>(`/admin/assets/pose-assets/${asset.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });

      onSaved(updated);
      toast({ title: `${label.trim()} updated` });
      onClose();
    } catch (err: unknown) {
      toast({
        kind: 'error',
        title: 'Failed to update pose asset',
        body: err instanceof Error ? err.message : String(err),
      });
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
          <h3>Edit pose asset</h3>
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
            <label>
              Label{' '}
              <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                (dedup key — do not rename)
              </span>
            </label>
            <input
              className="input"
              value={label}
              disabled
              readOnly
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
            />
          </div>

          <div className="field">
            <label>
              Display name{' '}
              <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                (optional human-readable name)
              </span>
            </label>
            <input
              className="input"
              value={displayName}
              disabled={saving}
              placeholder="e.g. Standing front view"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Gender</label>
            <select
              className="select"
              value={genderSlug}
              disabled={saving}
              onChange={(e) => setGenderSlug(e.target.value as GenderSlug)}
            >
              <option value="men">Men</option>
              <option value="women">Women</option>
              <option value="boys">Boys</option>
              <option value="girls">Girls</option>
            </select>
          </div>

          <div className="field">
            <label>Workflow template</label>
            <select
              className="select"
              value={workflowTemplateId}
              disabled={saving}
              onChange={(e) => {
                const newId = e.target.value;
                setWorkflowTemplateId(newId);
                // Auto-fill prompt with new workflow's default when prompt is empty or still default
                const prevDefault =
                  workflows.find((w) => w.id === workflowTemplateId)?.defaultGarmentPhasePrompt ??
                  '';
                if (!prompt || prompt === prevDefault) {
                  const nextDefault =
                    workflows.find((w) => w.id === newId)?.defaultGarmentPhasePrompt ?? '';
                  setPrompt(nextDefault);
                }
              }}
            >
              <option value="">— none —</option>
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.label}
                  {wf.lowerNodeId ? ' · lower' : ''}
                  {wf.shoeNodeId ? ' · shoes' : ''}
                  {!wf.isActive ? ' (inactive)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Model face (display &amp; filter)</label>
              {selectedFace && storagePublicUrl && selectedFace.thumbnailKey && (
                // biome-ignore lint/performance/noImgElement: admin panel
                <img
                  src={`${storagePublicUrl}/${selectedFace.thumbnailKey}`}
                  alt=""
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
              )}
              <select
                className="select"
                value={faceId}
                disabled={saving}
                onChange={(e) => setFaceId(e.target.value)}
              >
                <option value="">— none —</option>
                {faces.map((f) => (
                  <option key={f.id} value={f.id}>
                    [{f.gender}] {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Background (location)</label>
              {selectedBg && storagePublicUrl && selectedBg.thumbnailKey && (
                // biome-ignore lint/performance/noImgElement: admin panel
                <img
                  src={`${storagePublicUrl}/${selectedBg.thumbnailKey}`}
                  alt=""
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
              )}
              <select
                className="select"
                value={backgroundId}
                disabled={saving}
                onChange={(e) => setBackgroundId(e.target.value)}
              >
                <option value="">— none —</option>
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
              id="epa-pose-img"
              label="Pose image"
              hint="display + ComfyUI pose node"
              currentUrl={
                storagePublicUrl && asset.thumbnailKey
                  ? `${storagePublicUrl}/${asset.thumbnailKey}`
                  : null
              }
              file={poseFile}
              disabled={saving}
              onChange={setPoseFile}
              onClear={() => setPoseFile(null)}
            />
            <ImagePicker
              id="epa-faceside-img"
              label="Side / tilt face"
              hint="ComfyUI face node"
              currentUrl={faceSideCurrentUrl}
              file={faceSideFile}
              disabled={saving}
              onChange={setFaceSideFile}
              onClear={() => setFaceSideFile(null)}
            />
            <ImagePicker
              id="epa-bgcomfy-img"
              label="Background (ComfyUI)"
              hint="ComfyUI bg node"
              currentUrl={bgComfyCurrentUrl}
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
              value={prompt}
              disabled={saving}
              rows={4}
              onChange={(e) => setPrompt(e.target.value)}
              style={{ fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
            />
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn primary" onClick={handleSave} disabled={saving || !label.trim()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
