import { useRef, useState } from 'react';
import { apiFetch, UPLOAD_NETWORK_ERROR, uploadErrorMessage } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type { GenderSlug, ModelFace } from '../types';
import { EditDrawer } from './EditDrawer';
import { Icon } from './Icons';

interface Props {
  onDone: (faces: ModelFace[]) => void;
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

interface PickedFile {
  id: string;
  file: File;
  label: string;
}

function labelFromFilename(name: string): string {
  return name
    .replace(/\.[^./]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function MultiPhotoDropzone({
  files,
  onFilesChange,
  disabled,
}: {
  files: PickedFile[];
  onFilesChange: (f: PickedFile[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
          gap: 10,
        }}
      >
        {files.map((pf) => (
          <div key={pf.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div
              style={{
                position: 'relative',
                aspectRatio: '3 / 4',
                borderRadius: 'var(--r-lg)',
                overflow: 'hidden',
                border: '1px solid var(--border)',
              }}
            >
              {/* biome-ignore lint/performance/noImgElement: admin panel preview */}
              <img
                src={URL.createObjectURL(pf.file)}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onFilesChange(files.filter((f) => f.id !== pf.id))}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  fontSize: 12,
                  lineHeight: 1,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                ×
              </button>
            </div>
            <input
              className="input"
              style={{ fontSize: 11.5, padding: '4px 6px' }}
              value={pf.label}
              disabled={disabled}
              placeholder="Label"
              onChange={(e) =>
                onFilesChange(
                  files.map((f) => (f.id === pf.id ? { ...f, label: e.target.value } : f)),
                )
              }
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => !disabled && inputRef.current?.click()}
          disabled={disabled}
          style={{
            aspectRatio: '3 / 4',
            borderRadius: 'var(--r-lg)',
            border: '1.5px dashed var(--border-strong)',
            background: 'var(--surface-2)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: 'var(--muted)',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <Icon.Add />
          <span style={{ fontSize: 11, fontWeight: 500 }}>
            {files.length > 0 ? 'Add more' : 'Add image'}
          </span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        disabled={disabled}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).map((file) => ({
            id: crypto.randomUUID(),
            file,
            label: labelFromFilename(file.name),
          }));
          if (picked.length) onFilesChange([...files, ...picked]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function AddFaceModal({ onDone, onClose, toast }: Props) {
  const [gender, setGender] = useState<GenderSlug>('men');
  const [sortOrder, setSortOrder] = useState(0);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'confirming'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = status !== 'idle';
  const multi = files.length > 1;
  const allLabeled = files.every((f) => f.label.trim());

  const handleSubmit = async () => {
    if (files.length === 0) {
      setError('At least one face image is required');
      return;
    }
    if (!allLabeled) {
      setError('Every image needs a label');
      return;
    }
    setError(null);
    setStatus('uploading');
    setProgress(0);

    const created: ModelFace[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const { file, label } = files[i];
        const presign = await apiFetch<{
          uploadUrl: string;
          r2Key: string;
          thumbnailUploadUrl: string;
          thumbnailKey: string;
        }>('/admin/assets/faces/presign', {
          method: 'POST',
          body: JSON.stringify({ contentType: file.type }),
        });
        await uploadWithProgress(presign.uploadUrl, file, (p) =>
          setProgress(Math.round(((i + p * 0.75) / files.length) * 100)),
        );
        const thumb = await makeThumbnail(file);
        await uploadWithProgress(presign.thumbnailUploadUrl, thumb, (p) =>
          setProgress(Math.round(((i + 0.75 + p * 0.25) / files.length) * 100)),
        );

        setStatus('confirming');
        const row = await apiFetch<ModelFace>('/admin/assets/faces/confirm', {
          method: 'POST',
          body: JSON.stringify({
            label: label.trim(),
            gender,
            sortOrder: sortOrder + i,
            r2Key: presign.r2Key,
            thumbnailKey: presign.thumbnailKey,
          }),
        });
        created.push(row);
        setStatus('uploading');
      }
      setProgress(100);
      toast({ title: `${created.length} face${created.length !== 1 ? 's' : ''} added` });
      onDone(created);
    } catch (e) {
      if (created.length > 0) onDone(created);
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setError(
        created.length > 0
          ? `${created.length} of ${files.length} uploaded, then failed: ${msg}`
          : msg,
      );
      setStatus('idle');
      setProgress(0);
    }
  };

  return (
    <EditDrawer
      onClose={onClose}
      title="Add Model Face"
      width="min(640px, calc(100vw - 60px))"
      saving={busy}
      onSave={() => void handleSubmit()}
      saveLabel={busy ? 'Uploading…' : `Add face${multi ? `s (${files.length})` : ''}`}
      saveDisabled={files.length === 0 || !allLabeled}
    >
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
        <MultiPhotoDropzone files={files} onFilesChange={setFiles} disabled={busy} />
        <span className="hint" style={{ display: 'block', marginTop: 8 }}>
          Label defaults to the file name — edit any of them before uploading.
        </span>
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
    </EditDrawer>
  );
}
