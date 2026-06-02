import { useRef, useState } from 'react';
import { apiFetch } from '../lib/data';
import type { ModelBackground } from '../types';
import { Icon } from './Icons';

interface Props {
  background: ModelBackground;
  storagePublicUrl: string | null;
  onSaved: (updated: ModelBackground) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export function EditBackgroundModal({
  background,
  storagePublicUrl,
  onSaved,
  onClose,
  toast,
}: Props) {
  const [form, setForm] = useState({
    label: background.label,
    sortOrder: background.sortOrder,
    genderSlug: background.genderSlug ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replacePreview, setReplacePreview] = useState<string | null>(null);
  const [replaceUploading, setReplaceUploading] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        label: form.label,
        sortOrder: form.sortOrder,
        genderSlug: form.genderSlug || null,
      };
      await apiFetch(`/admin/assets/backgrounds/${background.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const updated: ModelBackground = {
        ...background,
        label: form.label,
        sortOrder: form.sortOrder,
        genderSlug: form.genderSlug || null,
      };
      onSaved(updated);
      toast({ title: `${form.label} updated` });
      onClose();
    } catch {
      toast({ kind: 'error', title: 'Failed to update background' });
    } finally {
      setSaving(false);
    }
  };

  const handleReplaceImage = async () => {
    if (!replaceFile) return;
    setReplaceUploading(true);
    try {
      const presign = await apiFetch<{
        uploadUrl: string;
        r2Key: string;
        thumbnailUploadUrl: string;
        thumbnailKey: string;
      }>('/admin/assets/backgrounds/presign', {
        method: 'POST',
        body: JSON.stringify({ contentType: replaceFile.type }),
      });
      await Promise.all(
        [presign.uploadUrl, presign.thumbnailUploadUrl].map(
          (url) =>
            new Promise<void>((res, rej) => {
              const xhr = new XMLHttpRequest();
              xhr.open('PUT', url);
              xhr.setRequestHeader('Content-Type', replaceFile.type);
              xhr.onload = () => (xhr.status < 300 ? res() : rej(new Error(`${xhr.status}`)));
              xhr.onerror = () => rej(new Error('Network error'));
              xhr.send(replaceFile);
            }),
        ),
      );
      await apiFetch(`/admin/assets/backgrounds/${background.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ r2Key: presign.r2Key, thumbnailKey: presign.thumbnailKey }),
      });
      onSaved({
        ...background,
        ...form,
        r2Key: presign.r2Key,
        thumbnailKey: presign.thumbnailKey,
      });
      setReplaceFile(null);
      setReplacePreview(null);
      toast({ title: 'Image replaced' });
    } catch {
      toast({ kind: 'error', title: 'Image replace failed' });
    } finally {
      setReplaceUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={saving || replaceUploading ? undefined : onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(400px, calc(100vw - 40px))' }}
      >
        <div className="modal-head">
          <h3>Edit background</h3>
          <button
            className="btn sm ghost"
            onClick={onClose}
            disabled={saving || replaceUploading}
            style={{ marginLeft: 'auto' }}
          >
            <Icon.Close />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field">
            <label>Label</label>
            <input
              className="input"
              value={form.label}
              disabled={saving}
              placeholder="e.g. Studio White"
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
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
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
            />
          </div>
          <div className="field">
            <label>Gender</label>
            <select
              className="select"
              value={form.genderSlug}
              disabled={saving}
              onChange={(e) => setForm((f) => ({ ...f, genderSlug: e.target.value }))}
            >
              <option value="">All genders</option>
              <option value="men">Men</option>
              <option value="women">Women</option>
              <option value="boys">Boys</option>
              <option value="girls">Girls</option>
            </select>
          </div>
          <div className="field">
            <label>Replace image</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {(replacePreview ??
                (storagePublicUrl && background.thumbnailKey
                  ? `${storagePublicUrl}/${background.thumbnailKey}`
                  : null)) && (
                <img
                  src={replacePreview ?? `${storagePublicUrl}/${background.thumbnailKey}`}
                  alt=""
                  style={{
                    width: 56,
                    height: 56,
                    objectFit: 'cover',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  ref={replaceRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setReplaceFile(file);
                    setReplacePreview(URL.createObjectURL(file));
                  }}
                />
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={saving || replaceUploading}
                  onClick={() => replaceRef.current?.click()}
                >
                  <Icon.Image /> {replaceFile ? replaceFile.name : 'Pick new image'}
                </button>
                {replaceFile && (
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={replaceUploading}
                    onClick={handleReplaceImage}
                  >
                    {replaceUploading ? 'Uploading…' : 'Upload & replace'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving || replaceUploading}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={saving || replaceUploading || !form.label.trim()}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
