import { useRef, useState } from 'react';
import { apiErrorMessage, apiFetch, UPLOAD_NETWORK_ERROR, uploadErrorMessage } from '../lib/data';
import type { BlouseCategory, GenderSlug } from '../types';
import { EditDrawer } from './EditDrawer';
import { Icon } from './Icons';
import { SearchableSelect } from './SearchableSelect';

interface Props {
  category: BlouseCategory | null;
  defaultGenderSlug: GenderSlug | 'all';
  onSaved: (c: BlouseCategory) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export function EditBlouseCategoryModal({
  category,
  defaultGenderSlug,
  onSaved,
  onClose,
  toast,
}: Props) {
  const isNew = category === null;
  const [label, setLabel] = useState(category?.label ?? '');
  const [genderSlug, setGenderSlug] = useState<GenderSlug | 'all'>(
    category?.genderSlug ?? defaultGenderSlug,
  );
  const [sortOrder, setSortOrder] = useState(category?.sortOrder ?? 0);
  const [saving, setSaving] = useState(false);
  const [thumbnailKey, setThumbnailKey] = useState<string | null>(category?.thumbnailKey ?? null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(category?.thumbnailUrl ?? null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
        '/admin/assets/blouse-categories/thumbnail/presign',
        { method: 'POST', body: JSON.stringify({ contentType: uploadFile.type }) },
      );
      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', presign.uploadUrl);
        xhr.setRequestHeader('Content-Type', uploadFile.type);
        xhr.onload = () =>
          xhr.status < 300 ? res() : rej(new Error(uploadErrorMessage(xhr.status)));
        xhr.onerror = () => rej(new Error(UPLOAD_NETWORK_ERROR));
        xhr.send(uploadFile);
      });
      setThumbnailKey(presign.thumbnailKey);
      setThumbnailUrl(URL.createObjectURL(uploadFile));
      setUploadFile(null);
      toast({ title: 'Thumbnail uploaded' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Thumbnail upload failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const genderSlugValue = genderSlug === 'all' ? null : genderSlug;
    try {
      if (isNew) {
        const created = await apiFetch<Omit<BlouseCategory, 'thumbnailUrl' | 'poseCount'>>(
          '/admin/assets/blouse-categories',
          {
            method: 'POST',
            body: JSON.stringify({
              genderSlug: genderSlugValue,
              label,
              thumbnailKey: thumbnailKey ?? undefined,
              sortOrder,
            }),
          },
        );
        onSaved({ ...created, thumbnailUrl, poseCount: 0 });
      } else {
        await apiFetch(`/admin/assets/blouse-categories/${category.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ label, thumbnailKey, sortOrder }),
        });
        onSaved({ ...category, label, thumbnailKey, thumbnailUrl, sortOrder });
      }
      onClose();
      toast({ title: `${label} ${isNew ? 'created' : 'updated'}` });
    } catch (e) {
      toast({
        kind: 'error',
        title: isNew ? 'Failed to create blouse category' : 'Failed to update blouse category',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditDrawer
      onClose={onClose}
      title={isNew ? 'New blouse category' : 'Edit blouse category'}
      width="min(420px, calc(100vw - 40px))"
      thumbnail={{ thumbnailUrl }}
      saving={saving || uploading}
      onSave={handleSave}
      saveDisabled={!label.trim()}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <label>Label</label>
          <input
            className="input"
            value={label}
            disabled={saving}
            placeholder="e.g. Elbow-length sleeve"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Gender</label>
          <SearchableSelect
            options={[
              { id: 'all', label: 'All genders' },
              { id: 'men', label: 'Men' },
              { id: 'women', label: 'Women' },
              { id: 'boys', label: 'Boys' },
              { id: 'girls', label: 'Girls' },
            ]}
            value={genderSlug}
            disabled={saving || !isNew}
            onChange={(v) => setGenderSlug(v as GenderSlug | 'all')}
          />
          {!isNew && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              Gender can't be changed after a blouse category is created.
            </span>
          )}
        </div>
        <div className="field">
          <label>Sort order</label>
          <input
            className="input"
            type="number"
            min={0}
            value={sortOrder}
            disabled={saving}
            style={{ width: 100 }}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Thumbnail</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {thumbnailUrl && (
              // biome-ignore lint/performance/noImgElement: admin panel thumbnail preview
              <img
                src={thumbnailUrl}
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
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploadFile(file);
                }}
              />
              <button
                type="button"
                className="btn sm ghost"
                disabled={saving || uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Icon.Image /> {uploadFile ? uploadFile.name : 'Pick image'}
              </button>
              {uploadFile && (
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={uploading}
                  onClick={handleUpload}
                >
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </EditDrawer>
  );
}
