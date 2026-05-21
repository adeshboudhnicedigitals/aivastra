import { useState, useRef } from 'react';
import { Icon } from './Icons';
import { Switch } from './Switch';
import { apiFetch } from '../lib/data';
import type { ModelFace, ModelBackground, ModelPose } from '../types';

interface PresignResult {
  uploadUrl: string;
  r2Key: string;
  thumbnailUploadUrl: string;
  thumbnailKey: string;
}

type FileStatus = 'pending' | 'uploading' | 'done' | 'error';

interface FileEntry {
  file: File;
  label: string;
  status: FileStatus;
  error?: string;
}

interface Props {
  subcategoryId: string;
  faces: ModelFace[];
  backgrounds: ModelBackground[];
  onDone: (added: ModelPose[]) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

async function uploadFile(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2 ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(file);
  });
}

export function BatchPoseUploadModal({ subcategoryId, faces, backgrounds, onDone, onClose, toast }: Props) {
  const [faceId, setFaceId] = useState(faces[0]?.id ?? '');
  const [backgroundId, setBackgroundId] = useState(backgrounds[0]?.id ?? '');
  const [showsLower, setShowsLower] = useState(false);
  const [showsShoes, setShowsShoes] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = running;

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setEntries(files.map((f) => ({
      file: f,
      label: f.name.replace(/\.[^.]+$/, ''), // strip extension for default label
      status: 'pending',
    })));
    setDoneCount(0);
  };

  const updateEntry = (idx: number, patch: Partial<FileEntry>) =>
    setEntries((prev) => prev.map((e, i) => i === idx ? { ...e, ...patch } : e));

  const handleUpload = async () => {
    if (!faceId || !backgroundId || entries.length === 0) return;
    setRunning(true);
    setDoneCount(0);
    const added: ModelPose[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.status === 'done') { setDoneCount((n) => n + 1); continue; }
      updateEntry(i, { status: 'uploading', error: undefined });
      try {
        const presign = await apiFetch<PresignResult>('/admin/assets/poses/presign', {
          method: 'POST',
          body: JSON.stringify({ subcategoryId, faceId, backgroundId, contentType: entry.file.type }),
        });
        await uploadFile(presign.uploadUrl, entry.file);
        await uploadFile(presign.thumbnailUploadUrl, entry.file);
        const row = await apiFetch<ModelPose>('/admin/assets/poses/confirm', {
          method: 'POST',
          body: JSON.stringify({
            subcategoryId, faceId, backgroundId,
            label: entry.label.trim() || entry.file.name,
            r2Key: presign.r2Key,
            thumbnailKey: presign.thumbnailKey,
            showsLower,
            showsShoes,
            sortOrder: i,
          }),
        });
        added.push(row);
        updateEntry(i, { status: 'done' });
        setDoneCount((n) => n + 1);
      } catch (e) {
        updateEntry(i, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed' });
      }
    }

    setRunning(false);
    if (added.length > 0) {
      toast({ title: `${added.length} pose${added.length !== 1 ? 's' : ''} uploaded` });
      onDone(added);
    }
  };

  const allDone = entries.length > 0 && entries.every((e) => e.status === 'done');
  const hasErrors = entries.some((e) => e.status === 'error');
  const canUpload = !busy && faceId && backgroundId && entries.length > 0 && !allDone;

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(600px, calc(100vw - 40px))' }}>
        <div className="modal-head">
          <h3>Batch upload poses</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={busy} style={{ marginLeft: 'auto' }}>
            <Icon.Close />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Shared metadata */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Model face (in every image)</label>
              <select className="select" value={faceId} disabled={busy}
                onChange={(e) => setFaceId(e.target.value)}>
                {faces.map((f) => <option key={f.id} value={f.id}>[{f.gender}] {f.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Background (in every image)</label>
              <select className="select" value={backgroundId} disabled={busy}
                onChange={(e) => setBackgroundId(e.target.value)}>
                {backgrounds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 24 }}>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 0 }}>
              <Switch checked={showsLower} onChange={() => { if (!busy) setShowsLower((v) => !v); }} />
              <label style={{ margin: 0, cursor: 'pointer' }} onClick={() => { if (!busy) setShowsLower((v) => !v); }}>
                Shows lower garment
              </label>
            </div>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 0 }}>
              <Switch checked={showsShoes} onChange={() => { if (!busy) setShowsShoes((v) => !v); }} />
              <label style={{ margin: 0, cursor: 'pointer' }} onClick={() => { if (!busy) setShowsShoes((v) => !v); }}>
                Shows shoes
              </label>
            </div>
          </div>

          {/* File picker */}
          <div className="field">
            <label>Images (select multiple — label defaults to filename)</label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={handleFiles}
              style={{ fontSize: 13 }}
            />
          </div>

          {/* Progress summary */}
          {running && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Uploading {doneCount} / {entries.length}…
              <div className="bar-track" style={{ marginTop: 6 }}>
                <div className="bar-fill accent" style={{ width: `${entries.length ? (doneCount / entries.length) * 100 : 0}%` }} />
              </div>
            </div>
          )}

          {/* File list */}
          {entries.length > 0 && (
            <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entries.map((entry, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', borderRadius: 6,
                  background: entry.status === 'done' ? 'var(--success-soft)'
                    : entry.status === 'error' ? 'var(--danger-soft)'
                    : 'var(--subtle)',
                  border: `1px solid ${entry.status === 'done' ? 'var(--success-border)'
                    : entry.status === 'error' ? 'var(--danger-border)'
                    : 'var(--border)'}`,
                }}>
                  <span style={{ fontSize: 12, minWidth: 14, textAlign: 'center' }}>
                    {entry.status === 'done' ? '✓'
                      : entry.status === 'error' ? '✗'
                      : entry.status === 'uploading' ? '↑'
                      : `${i + 1}`}
                  </span>
                  <input
                    className="input"
                    value={entry.label}
                    disabled={busy}
                    onChange={(e) => updateEntry(i, { label: e.target.value })}
                    style={{ flex: 1, fontSize: 13, padding: '3px 8px' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {(entry.file.size / 1024).toFixed(0)} KB
                  </span>
                  {entry.error && (
                    <span style={{ fontSize: 11, color: 'var(--danger)' }}>{entry.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {allDone && (
            <div style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
              All {entries.length} poses uploaded successfully.
            </div>
          )}
          {hasErrors && !running && (
            <div style={{ fontSize: 13, color: 'var(--danger)' }}>
              Some uploads failed. Fix errors above and click Upload again to retry.
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {allDone ? 'Close' : 'Cancel'}
          </button>
          <button className="btn primary" onClick={handleUpload} disabled={!canUpload}>
            <Icon.Upload />
            {running ? `Uploading ${doneCount}/${entries.length}…` : `Upload ${entries.length || ''} poses`}
          </button>
        </div>
      </div>
    </div>
  );
}
