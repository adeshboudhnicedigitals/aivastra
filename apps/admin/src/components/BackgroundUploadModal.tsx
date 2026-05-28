import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/data';
import type { ModelBackground } from '../types';
import { Icon } from './Icons';

interface PresignResult {
  uploadUrl: string;
  r2Key: string;
  thumbnailUploadUrl: string;
  thumbnailKey: string;
}

interface Props {
  onDone: (row: ModelBackground) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  defaultGenderSlug?: string;
}

function uploadFile(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
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
        : reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

export function BackgroundUploadModal({ onDone, onClose, toast, defaultGenderSlug = '' }: Props) {
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [mainPreview, setMainPreview] = useState<string | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [genderSlug, setGenderSlug] = useState(defaultGenderSlug);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'confirming'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (mainPreview) URL.revokeObjectURL(mainPreview);
      if (thumbPreview) URL.revokeObjectURL(thumbPreview);
    };
  }, [mainPreview, thumbPreview]);

  const busy = status !== 'idle';

  const handleMainFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (mainPreview) URL.revokeObjectURL(mainPreview);
    setMainFile(f);
    setMainPreview(f ? URL.createObjectURL(f) : null);
    if (f && !label) setLabel(f.name.replace(/\.[^.]+$/, ''));
  };

  const handleThumbFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (thumbPreview) URL.revokeObjectURL(thumbPreview);
    setThumbFile(f);
    setThumbPreview(f ? URL.createObjectURL(f) : null);
  };

  const handleSubmit = async () => {
    if (!mainFile) {
      setError('Select a main background image');
      return;
    }
    if (!thumbFile) {
      setError('Select a thumbnail image');
      return;
    }
    if (!label.trim()) {
      setError('Label is required');
      return;
    }

    setError(null);
    setStatus('uploading');
    setProgress(0);

    try {
      const presign = await apiFetch<PresignResult>('/admin/assets/backgrounds/presign', {
        method: 'POST',
        body: JSON.stringify({ contentType: mainFile.type, thumbnailContentType: thumbFile.type }),
      });

      await uploadFile(presign.uploadUrl, mainFile, (p) => setProgress(Math.round(p * 50)));
      await uploadFile(presign.thumbnailUploadUrl, thumbFile, (p) =>
        setProgress(50 + Math.round(p * 40)),
      );

      setStatus('confirming');
      setProgress(92);

      const row = await apiFetch<ModelBackground>('/admin/assets/backgrounds/confirm', {
        method: 'POST',
        body: JSON.stringify({
          label: label.trim(),
          r2Key: presign.r2Key,
          thumbnailKey: presign.thumbnailKey,
          sortOrder,
          genderSlug: genderSlug || undefined,
        }),
      });

      setProgress(100);
      toast({ title: 'Background added' });
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
        style={{ width: 'min(520px, calc(100vw - 80px))' }}
      >
        <div className="modal-head">
          <h3>Add background</h3>
          <button
            className="btn sm ghost"
            onClick={onClose}
            disabled={busy}
            style={{ marginLeft: 'auto' }}
          >
            <Icon.Close />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div
              style={{
                color: 'var(--danger)',
                fontSize: 13,
                padding: '8px 12px',
                borderRadius: 6,
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger-border)',
              }}
            >
              {error}
            </div>
          )}

          <div className="field">
            <label>
              Main image <span style={{ color: 'var(--danger)' }}>*</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>
                (sent to ComfyUI)
              </span>
            </label>
            {mainPreview && (
              <img
                src={mainPreview}
                alt="main preview"
                style={{
                  width: 120,
                  height: 80,
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  marginBottom: 8,
                  display: 'block',
                }}
              />
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={handleMainFile}
              style={{ fontSize: 13 }}
            />
            {mainFile && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {mainFile.name} ({(mainFile.size / 1024).toFixed(0)} KB)
              </span>
            )}
          </div>

          <div className="field">
            <label>
              Thumbnail <span style={{ color: 'var(--danger)' }}>*</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>
                (shown in UI card)
              </span>
            </label>
            {thumbPreview && (
              <img
                src={thumbPreview}
                alt="thumbnail preview"
                style={{
                  width: 120,
                  height: 80,
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  marginBottom: 8,
                  display: 'block',
                }}
              />
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={handleThumbFile}
              style={{ fontSize: 13 }}
            />
            {thumbFile && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {thumbFile.name} ({(thumbFile.size / 1024).toFixed(0)} KB)
              </span>
            )}
          </div>

          <div className="field">
            <label>
              Label <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              className="input"
              value={label}
              disabled={busy}
              placeholder="e.g. Studio White"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Sort order (lower = first)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={sortOrder}
              disabled={busy}
              style={{ width: 100 }}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
          </div>

          <div className="field">
            <label>Gender</label>
            <select
              className="select"
              value={genderSlug}
              disabled={busy}
              onChange={(e) => setGenderSlug(e.target.value)}
            >
              <option value="">All genders</option>
              <option value="men">Men</option>
              <option value="women">Women</option>
              <option value="boys">Boys</option>
              <option value="girls">Girls</option>
            </select>
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
            onClick={handleSubmit}
            disabled={busy || !mainFile || !thumbFile || !label.trim()}
          >
            <Icon.Upload /> Upload
          </button>
        </div>
      </div>
    </div>
  );
}
