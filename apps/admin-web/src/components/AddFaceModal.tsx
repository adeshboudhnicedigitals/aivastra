import { useRef, useState } from 'react';
import { apiFetch, UPLOAD_NETWORK_ERROR, uploadErrorMessage } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type { GenderSlug, ModelFace } from '../types';
import { Icon } from './Icons';

interface Props {
  onDone: (face: ModelFace) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

function uploadWithProgress(
  url: string,
  file: Blob,
  onProgress: (p: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(uploadErrorMessage(xhr.status)));
    xhr.onerror = () => reject(new Error(UPLOAD_NETWORK_ERROR));
    xhr.send(file);
  });
}

function PhotoDropzone({
  label,
  required,
  file,
  onPick,
  disabled,
}: {
  label: string;
  required?: boolean;
  file: File | null;
  onPick: (f: File) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = file ? URL.createObjectURL(file) : null;

  return (
    <button
      type="button"
      onClick={() => !disabled && inputRef.current?.click()}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        aspectRatio: '3 / 4',
        borderRadius: 'var(--r-lg)',
        border: `1.5px dashed ${preview ? 'transparent' : 'var(--border-strong)'}`,
        background: preview ? 'transparent' : 'var(--surface-2)',
        padding: 0,
        overflow: 'hidden',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
      {preview ? (
        // biome-ignore lint/performance/noImgElement: admin panel preview
        <img
          src={preview}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--muted)',
          }}
        >
          <Icon.Image />
          <span style={{ fontSize: 12.5, fontWeight: 500, textAlign: 'center', padding: '0 12px' }}>
            {label}
            {required && <span style={{ color: 'var(--danger)' }}> *</span>}
          </span>
        </div>
      )}
      {preview && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '6px 0',
            fontSize: 11,
            fontWeight: 600,
            textAlign: 'center',
            color: '#fff',
            background: 'rgba(0,0,0,0.6)',
          }}
        >
          Replace
        </div>
      )}
    </button>
  );
}

export function AddFaceModal({ onDone, onClose, toast }: Props) {
  const [label, setLabel] = useState('');
  const [gender, setGender] = useState<GenderSlug>('men');
  const [sortOrder, setSortOrder] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [sideFile, setSideFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'confirming'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = status !== 'idle';

  const handleSubmit = async () => {
    if (!label.trim()) {
      setError('Label is required');
      return;
    }
    if (!file) {
      setError('Display image is required');
      return;
    }
    setError(null);
    setStatus('uploading');
    setProgress(0);

    const hasSide = !!sideFile;
    const mainBudget = hasSide ? 50 : 65;
    const thumbBudget = hasSide ? 20 : 25;

    try {
      const presign = await apiFetch<{
        uploadUrl: string;
        r2Key: string;
        thumbnailUploadUrl: string;
        thumbnailKey: string;
        faceSideUploadUrl: string;
        faceSideR2Key: string;
      }>('/admin/assets/faces/presign', {
        method: 'POST',
        body: JSON.stringify({ contentType: file.type }),
      });
      await uploadWithProgress(presign.uploadUrl, file, (p) =>
        setProgress(Math.round(p * mainBudget)),
      );
      const thumb = await makeThumbnail(file);
      await uploadWithProgress(presign.thumbnailUploadUrl, thumb, (p) =>
        setProgress(mainBudget + Math.round(p * thumbBudget)),
      );

      const confirmBody: Record<string, unknown> = {
        label: label.trim(),
        gender,
        sortOrder,
        r2Key: presign.r2Key,
        thumbnailKey: presign.thumbnailKey,
      };
      if (sideFile) {
        await uploadWithProgress(presign.faceSideUploadUrl, sideFile, (p) =>
          setProgress(mainBudget + thumbBudget + Math.round(p * 20)),
        );
        confirmBody.faceSideR2Key = presign.faceSideR2Key;
      }

      setStatus('confirming');
      setProgress(92);
      const row = await apiFetch<ModelFace>('/admin/assets/faces/confirm', {
        method: 'POST',
        body: JSON.stringify(confirmBody),
      });
      setProgress(100);
      toast({ title: `${row.label} added` });
      onDone(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setStatus('idle');
      setProgress(0);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, calc(100vw - 60px))' }}
      >
        <div className="modal-head">
          <h3>Add Model Face</h3>
          <button
            className="btn sm ghost"
            onClick={onClose}
            disabled={busy}
            style={{ marginLeft: 'auto' }}
          >
            <Icon.Close />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <div
              style={{
                color: 'var(--danger)',
                fontSize: 13,
                padding: '8px 12px',
                borderRadius: 'var(--r)',
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger-border)',
              }}
            >
              {error}
            </div>
          )}

          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <PhotoDropzone
                label="Display Image"
                required
                file={file}
                onPick={setFile}
                disabled={busy}
              />
              <PhotoDropzone
                label="ComfyUI Face Image"
                file={sideFile}
                onPick={setSideFile}
                disabled={busy}
              />
            </div>
            <span className="hint" style={{ display: 'block', marginTop: 8 }}>
              ComfyUI face image is optional and can be added later.
            </span>
          </div>

          <div className="field">
            <label>Label</label>
            <input
              className="input"
              value={label}
              disabled={busy}
              placeholder="e.g. Model 1 — Men"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Gender</label>
              <select
                className="select"
                value={gender}
                disabled={busy}
                onChange={(e) => setGender(e.target.value as GenderSlug)}
              >
                <option value="men">Men</option>
                <option value="women">Women</option>
                <option value="boys">Boys</option>
                <option value="girls">Girls</option>
              </select>
            </div>
            <div className="field">
              <label>Sort order</label>
              <input
                className="input"
                type="number"
                min={0}
                value={sortOrder}
                disabled={busy}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>

          {busy && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {status === 'uploading' ? `Uploading… ${progress}%` : 'Saving…'}
              </div>
              <div className="bar-track">
                <div className="bar-fill accent" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => void handleSubmit()}
            disabled={busy || !file || !label.trim()}
          >
            <Icon.Upload /> {busy ? 'Uploading…' : 'Add face'}
          </button>
        </div>
      </div>
    </div>
  );
}
