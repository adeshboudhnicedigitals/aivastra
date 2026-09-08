import { useRef, useState } from 'react';
import { slugifyContinent } from '../lib/continents';
import { apiErrorMessage, apiFetch, UPLOAD_NETWORK_ERROR, uploadErrorMessage } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type { Continent, GenderSlug, ModelFace } from '../types';
import { EditDrawer } from './EditDrawer';
import { Icon } from './Icons';
import { PublicApiSlugField } from './PublicApiSlugField';
import { SearchableSelect } from './SearchableSelect';

const ADD_NEW = '__add_new__';

interface Props {
  face: ModelFace;
  knownContinents: { value: Continent; label: string }[];
  onSaved: (updated: ModelFace) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export function EditFaceModal({ face, knownContinents, onSaved, onClose, toast }: Props) {
  const [form, setForm] = useState({
    label: face.label,
    gender: face.gender,
    continent: (face.continent ?? '') as Continent | '',
    sortOrder: face.sortOrder,
    publicApiSlug: face.publicApiSlug ?? '',
    tagsInput: (face.tags ?? []).join(', '),
  });
  const [addingContinent, setAddingContinent] = useState(false);
  const [newContinentLabel, setNewContinentLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replacePreview, setReplacePreview] = useState<string | null>(null);
  const [replaceUploading, setReplaceUploading] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    if (addingContinent && !newContinentLabel.trim()) {
      toast({ kind: 'error', title: 'Enter a name for the new continent, or cancel' });
      return;
    }
    setSaving(true);
    const resolvedContinent = addingContinent
      ? slugifyContinent(newContinentLabel) || null
      : form.continent || null;
    try {
      const tags = form.tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const body = {
        label: form.label,
        gender: form.gender,
        continent: resolvedContinent,
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
    <EditDrawer
      onClose={onClose}
      title="Edit model face"
      width="min(480px, calc(100vw - 40px))"
      thumbnail={{ thumbnailUrl: face.thumbnailUrl }}
      saving={saving || replaceUploading}
      onSave={handleSave}
      saveDisabled={!form.label.trim()}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
        <PublicApiSlugField
          value={form.publicApiSlug}
          disabled={saving}
          kind="model"
          onChange={(v) => setForm((f) => ({ ...f, publicApiSlug: v }))}
        />
        <div className="field">
          <label>Gender</label>
          <SearchableSelect
            options={[
              { id: 'men', label: 'Men' },
              { id: 'women', label: 'Women' },
              { id: 'boys', label: 'Boys' },
              { id: 'girls', label: 'Girls' },
            ]}
            value={form.gender}
            disabled={saving}
            onChange={(v) => setForm((f) => ({ ...f, gender: v as GenderSlug }))}
          />
        </div>
        <div className="field">
          <label>Continent</label>
          {addingContinent ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                placeholder="e.g. Middle East"
                value={newContinentLabel}
                disabled={saving}
                onChange={(e) => setNewContinentLabel(e.target.value)}
              />
              <button
                type="button"
                className="btn sm ghost"
                disabled={saving}
                onClick={() => {
                  setAddingContinent(false);
                  setNewContinentLabel('');
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <SearchableSelect
              options={[
                ...knownContinents.map((c) => ({ id: c.value, label: c.label })),
                { id: ADD_NEW, label: '+ Add new continent…' },
              ]}
              value={form.continent}
              disabled={saving}
              emptyLabel='Unassigned (shown as "Global" in studio)'
              onChange={(v) => {
                if (v === ADD_NEW) {
                  setAddingContinent(true);
                  return;
                }
                setForm((f) => ({ ...f, continent: v as Continent | '' }));
              }}
            />
          )}
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
            {(replacePreview ?? face.thumbnailUrl) && (
              // biome-ignore lint/performance/noImgElement: face thumbnail preview
              <img
                src={replacePreview ?? (face.thumbnailUrl as string)}
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
    </EditDrawer>
  );
}
