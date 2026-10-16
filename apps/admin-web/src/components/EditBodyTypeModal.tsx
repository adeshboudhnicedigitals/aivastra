import { useRef, useState } from 'react';
import { apiErrorMessage, apiFetch, UPLOAD_NETWORK_ERROR, uploadErrorMessage } from '../lib/data';
import type { BodyType, GenderSlug } from '../types';
import { EditDrawer } from './EditDrawer';
import { Icon } from './Icons';
import { SearchableSelect } from './SearchableSelect';

interface Props {
  bodyType: BodyType | null;
  defaultGenderSlug: GenderSlug;
  onSaved: (t: BodyType) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export function EditBodyTypeModal({ bodyType, defaultGenderSlug, onSaved, onClose, toast }: Props) {
  const isNew = bodyType === null;
  const [label, setLabel] = useState(bodyType?.label ?? '');
  const [genderSlug, setGenderSlug] = useState<GenderSlug>(
    bodyType?.genderSlug ?? defaultGenderSlug,
  );
  const [sortOrder, setSortOrder] = useState(bodyType?.sortOrder ?? 0);
  const [saving, setSaving] = useState(false);
  const [thumbnailKey, setThumbnailKey] = useState<string | null>(bodyType?.thumbnailKey ?? null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(bodyType?.thumbnailUrl ?? null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [seedFromGarmentTypes, setSeedFromGarmentTypes] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const seedMappedAssets = async (bodyTypeId: string) => {
    const { faceIds, poseAssetIds } = await apiFetch<{
      faceIds: string[];
      poseAssetIds: string[];
    }>(`/admin/assets/body-types/garment-mapped-assets?genderSlug=${genderSlug}`);
    await Promise.all([
      ...faceIds.map((faceId) =>
        apiFetch(`/admin/assets/body-types/${bodyTypeId}/faces/${faceId}`, {
          method: 'PUT',
          body: JSON.stringify({ mapped: true }),
        }),
      ),
      ...poseAssetIds.map((poseAssetId) =>
        apiFetch(`/admin/assets/body-types/${bodyTypeId}/poses/${poseAssetId}`, {
          method: 'PUT',
          body: JSON.stringify({ mapped: true }),
        }),
      ),
    ]);
    return { faceCount: faceIds.length, poseCount: poseAssetIds.length };
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
        '/admin/assets/body-types/thumbnail/presign',
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
    try {
      let savedId: string;
      if (isNew) {
        const created = await apiFetch<BodyType>('/admin/assets/body-types', {
          method: 'POST',
          body: JSON.stringify({
            genderSlug,
            label,
            thumbnailKey: thumbnailKey ?? undefined,
            sortOrder,
          }),
        });
        savedId = created.id;
        onSaved(created);
      } else {
        await apiFetch(`/admin/assets/body-types/${bodyType.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ label, thumbnailKey, sortOrder }),
        });
        savedId = bodyType.id;
        onSaved({ ...bodyType, label, thumbnailKey, thumbnailUrl, sortOrder });
      }
      onClose();
      if (!seedFromGarmentTypes) {
        toast({ title: `${label} ${isNew ? 'created' : 'updated'}` });
        return;
      }
      try {
        const { faceCount, poseCount } = await seedMappedAssets(savedId);
        toast({
          title: `${label} ${isNew ? 'created' : 'updated'}`,
          body: `Seeded ${faceCount} face${faceCount !== 1 ? 's' : ''} and ${poseCount} pose${poseCount !== 1 ? 's' : ''} already mapped to garment types.`,
        });
      } catch (e) {
        toast({
          kind: 'error',
          title: `${label} ${isNew ? 'created' : 'updated'}, but seeding failed`,
          body: apiErrorMessage(e, 'Map faces/poses manually from their own tabs.'),
        });
      }
    } catch (e) {
      toast({
        kind: 'error',
        title: isNew ? 'Failed to create body type' : 'Failed to update body type',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditDrawer
      onClose={onClose}
      title={isNew ? 'New body type' : 'Edit body type'}
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
            placeholder="e.g. Slim"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Gender</label>
          <SearchableSelect
            options={[
              { id: 'men', label: 'Men' },
              { id: 'women', label: 'Women' },
              { id: 'boys', label: 'Boys' },
              { id: 'girls', label: 'Girls' },
            ]}
            value={genderSlug}
            disabled={saving || !isNew}
            onChange={(v) => setGenderSlug(v as GenderSlug)}
          />
          {!isNew && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              Gender can't be changed after a body type is created.
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
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={seedFromGarmentTypes}
              disabled={saving}
              onChange={(e) => setSeedFromGarmentTypes(e.target.checked)}
              style={{ marginTop: 2, accentColor: 'var(--accent)' }}
            />
            <span>
              Seed with garment-type-mapped assets
              <br />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                On save, maps every face and pose already assigned to any {genderSlug} garment type
                onto this body type.
              </span>
            </span>
          </label>
        </div>
      </div>
    </EditDrawer>
  );
}
