import { useRef, useState } from 'react';
import { apiErrorMessage, apiFetch, UPLOAD_NETWORK_ERROR, uploadErrorMessage } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type { GenderSlug, ModelFace } from '../types';
import { Icon } from './Icons';
import { PublicApiSlugField } from './PublicApiSlugField';

interface Props {
  face: ModelFace;
  storagePublicUrl: string | null;
  onSaved: (updated: ModelFace) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export function EditFaceModal({ face, storagePublicUrl, onSaved, onClose, toast }: Props) {
  const [form, setForm] = useState({
    label: face.label,
    gender: face.gender,
    sortOrder: face.sortOrder,
    publicApiSlug: face.publicApiSlug ?? '',
    tagsInput: (face.tags ?? []).join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replacePreview, setReplacePreview] = useState<string | null>(null);
  const [replaceUploading, setReplaceUploading] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      const tags = form.tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const body = {
        label: form.label,
        gender: form.gender,
        sortOrder: form.sortOrder,
        publicApiSlug: form.publicApiSlug,
        tags,
      };
      await apiFetch(`/admin/assets/faces/${face.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onSaved({ ...face, ...body });
      toast({ title: `${form.label} updated` });
      onClose();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update face',
        body: apiErrorMessage(e, 'Please try again.'),
      });
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
      }>('/admin/assets/faces/presign', {
        method: 'POST',
        body: JSON.stringify({ contentType: replaceFile.type }),
      });
      const thumb = await makeThumbnail(replaceFile);
      await Promise.all(
        [
          [presign.uploadUrl, replaceFile as Blob],
          [presign.thumbnailUploadUrl, thumb],
        ].map(
          ([url, body]) =>
            new Promise<void>((res, rej) => {
              const xhr = new XMLHttpRequest();
              xhr.open('PUT', url as string);
              xhr.setRequestHeader('Content-Type', (body as Blob).type);
              xhr.onload = () =>
                xhr.status < 300 ? res() : rej(new Error(uploadErrorMessage(xhr.status)));
              xhr.onerror = () => rej(new Error(UPLOAD_NETWORK_ERROR));
              xhr.send(body as Blob);
            }),
        ),
      );
      await apiFetch(`/admin/assets/faces/${face.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ r2Key: presign.r2Key, thumbnailKey: presign.thumbnailKey }),
      });
      onSaved({ ...face, ...form, r2Key: presign.r2Key, thumbnailKey: presign.thumbnailKey });
      setReplaceFile(null);
      setReplacePreview(null);
      toast({ title: 'Image replaced' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Image replace failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
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
          <h3>Edit model face</h3>
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
              placeholder="e.g. Model 1 — Men"
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Gender</label>
            <select
              className="select"
              value={form.gender}
              disabled={saving}
              onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as GenderSlug }))}
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
              value={form.sortOrder}
              disabled={saving}
              style={{ width: 100 }}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
            />
          </div>
          <PublicApiSlugField
            value={form.publicApiSlug}
            disabled={saving}
            kind="model"
            onChange={(v) => setForm((f) => ({ ...f, publicApiSlug: v }))}
          />
          <div className="field">
            <label>
              Tags <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              className="input"
              value={form.tagsInput}
              disabled={saving}
              placeholder="e.g. warm tone, closeup, studio"
              onChange={(e) => setForm((f) => ({ ...f, tagsInput: e.target.value }))}
            />
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>
            Tags are comma-separated — lets you filter models in Studio (e.g. all "closeup" faces).
          </p>
          <div className="field">
            <label>Replace image</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {(replacePreview ??
                (storagePublicUrl && face.thumbnailKey
                  ? `${storagePublicUrl}/${face.thumbnailKey}`
                  : null)) && (
                // biome-ignore lint/performance/noImgElement: face thumbnail preview
                <img
                  src={replacePreview ?? `${storagePublicUrl}/${face.thumbnailKey}`}
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
