import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, UPLOAD_NETWORK_ERROR, uploadErrorMessage } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type { CatalogueTemplate, GenderSlug, ModelBackground, ModelPoseAsset } from '../types';
import { Icon } from './Icons';

async function putFile(url: string, file: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(uploadErrorMessage(xhr.status)));
    xhr.onerror = () => reject(new Error(UPLOAD_NETWORK_ERROR));
    xhr.send(file);
  });
}

interface LookRow {
  key: string; // stable React key — random per row, independent of the eventual saved id
  poseAssetId: string;
  backgroundId: string;
}

/** Click-to-upload tile — no picking from existing assets, every look uploads fresh. */
function UploadTile({
  label,
  thumbnailKey,
  previewUrl,
  storageBase,
  disabled,
  loading = false,
  w = 72,
  h = 90,
  onClick,
}: {
  label: string;
  thumbnailKey?: string;
  /** Local blob preview, for deferred (not-yet-uploaded) selections — takes priority. */
  previewUrl?: string | null;
  storageBase: string | null;
  disabled: boolean;
  loading?: boolean;
  w?: number;
  h?: number;
  onClick: () => void;
}) {
  const src = previewUrl ?? (thumbnailKey && storageBase ? `${storageBase}/${thumbnailKey}` : null);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: w,
        height: h,
        borderRadius: 'var(--r-lg)',
        border: `1.5px dashed ${src ? 'transparent' : 'var(--border-strong, var(--border))'}`,
        background: src ? 'transparent' : 'var(--surface-2)',
        padding: 0,
        overflow: 'hidden',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        flexShrink: 0,
      }}
    >
      {loading ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--muted)',
            textAlign: 'center',
          }}
        >
          Uploading…
        </div>
      ) : src ? (
        // biome-ignore lint/performance/noImgElement: admin panel thumbnail
        <img
          src={src}
          alt={label}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            color: 'var(--muted)',
          }}
        >
          <Icon.Add />
          <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
        </div>
      )}
      {src && !loading && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '2px 0',
            fontSize: 9,
            fontWeight: 600,
            textAlign: 'center',
            color: '#fff',
            background: 'rgba(0,0,0,0.55)',
          }}
        >
          Change
        </div>
      )}
    </button>
  );
}

interface Props {
  template: CatalogueTemplate | null; // null = creating a new template
  defaultGenderSlug: GenderSlug;
  poseAssets: ModelPoseAsset[];
  backgrounds: ModelBackground[];
  onSaved: () => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export function EditCatalogueTemplateModal({
  template,
  defaultGenderSlug,
  poseAssets,
  backgrounds,
  onSaved,
  onClose,
  toast,
}: Props) {
  const { storagePublicUrl } = useAuth();
  const isEditing = template !== null;
  const [label, setLabel] = useState(template?.label ?? '');
  const [genderSlug, setGenderSlug] = useState<GenderSlug>(
    template?.genderSlug ?? defaultGenderSlug,
  );
  const [sortOrder, setSortOrder] = useState(template?.sortOrder ?? 0);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [looks, setLooks] = useState<LookRow[]>([]);
  const [looksLoaded, setLooksLoaded] = useState(!isEditing);
  const [saving, setSaving] = useState(false);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  // Local, appendable copies — new pose/background rows uploaded from within
  // the looks builder are added here immediately so their thumbnails render
  // in the look tiles without waiting for the parent tab to refetch.
  const [localPoseAssets, setLocalPoseAssets] = useState(poseAssets);
  const [localBackgrounds, setLocalBackgrounds] = useState(backgrounds);
  useEffect(() => setLocalPoseAssets(poseAssets), [poseAssets]);
  useEffect(() => setLocalBackgrounds(backgrounds), [backgrounds]);

  // Which look row's pose tile is currently uploading, if any (disables that tile).
  const [uploadingPoseForRow, setUploadingPoseForRow] = useState<string | null>(null);
  const poseFileInputRef = useRef<HTMLInputElement>(null);
  const poseUploadRowKeyRef = useRef<string | null>(null);

  // Which look row's background tile is currently uploading, if any (disables that tile).
  const [uploadingBackgroundForRow, setUploadingBackgroundForRow] = useState<string | null>(null);
  const backgroundFileInputRef = useRef<HTMLInputElement>(null);
  const backgroundUploadRowKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isEditing || !template) return;
    apiFetch<{ items: { id: string; poseAssetId: string; backgroundId: string }[] }>(
      `/admin/assets/catalogue-templates/${template.id}/looks`,
    )
      .then((res) => {
        setLooks(
          (res.items ?? []).map((l) => ({
            key: l.id,
            poseAssetId: l.poseAssetId,
            backgroundId: l.backgroundId,
          })),
        );
      })
      .catch(() => setLooks([]))
      .finally(() => setLooksLoaded(true));
  }, [isEditing, template]);

  const poseAssetById = new Map(localPoseAssets.map((p) => [p.id, p]));
  const backgroundById = new Map(localBackgrounds.map((b) => [b.id, b]));

  function addLookRow() {
    setLooks((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        poseAssetId: '',
        backgroundId: '',
      },
    ]);
  }

  function updateLookRow(key: string, patch: Partial<LookRow>) {
    setLooks((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLookRow(key: string) {
    setLooks((prev) => prev.filter((l) => l.key !== key));
  }

  function openPoseUpload(rowKey: string) {
    poseUploadRowKeyRef.current = rowKey;
    poseFileInputRef.current?.click();
  }

  async function handlePoseFileSelected(file: File) {
    const rowKey = poseUploadRowKeyRef.current;
    if (!rowKey) return;
    setUploadingPoseForRow(rowKey);
    try {
      const presign = await apiFetch<{
        r2Key: string;
        uploadUrl: string;
        thumbnailKey: string;
        thumbnailUploadUrl: string;
      }>('/admin/assets/pose-assets/presign', {
        method: 'POST',
        body: JSON.stringify({ contentType: file.type }),
      });
      await Promise.all([
        putFile(presign.uploadUrl, file),
        makeThumbnail(file).then((t) => putFile(presign.thumbnailUploadUrl, t)),
      ]);
      const created = await apiFetch<ModelPoseAsset>('/admin/assets/pose-assets', {
        method: 'POST',
        body: JSON.stringify({
          label: file.name.replace(/\.[^.]+$/, ''),
          r2Key: presign.r2Key,
          thumbnailKey: presign.thumbnailKey,
          genderSlug,
          scope: 'template',
        }),
      });
      setLocalPoseAssets((prev) => [...prev, created]);
      updateLookRow(rowKey, { poseAssetId: created.id });
    } catch (err: unknown) {
      toast({
        kind: 'error',
        title: 'Pose upload failed',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadingPoseForRow(null);
      poseUploadRowKeyRef.current = null;
    }
  }

  function openBackgroundUpload(rowKey: string) {
    backgroundUploadRowKeyRef.current = rowKey;
    backgroundFileInputRef.current?.click();
  }

  async function handleBackgroundFileSelected(file: File) {
    const rowKey = backgroundUploadRowKeyRef.current;
    if (!rowKey) return;
    setUploadingBackgroundForRow(rowKey);
    try {
      const presign = await apiFetch<{ r2Key: string; uploadUrl: string }>(
        '/admin/assets/backgrounds/presign',
        { method: 'POST', body: JSON.stringify({ contentType: file.type }) },
      );
      await putFile(presign.uploadUrl, file);
      const created = await apiFetch<ModelBackground>('/admin/assets/backgrounds/confirm', {
        method: 'POST',
        body: JSON.stringify({
          label: file.name.replace(/\.[^.]+$/, ''),
          r2Key: presign.r2Key,
          sortOrder: 0,
          genderSlug,
          scope: 'template',
        }),
      });
      setLocalBackgrounds((prev) => [...prev, created]);
      updateLookRow(rowKey, { backgroundId: created.id });
    } catch (err: unknown) {
      toast({
        kind: 'error',
        title: 'Background upload failed',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadingBackgroundForRow(null);
      backgroundUploadRowKeyRef.current = null;
    }
  }

  const uploadInFlight = uploadingPoseForRow !== null || uploadingBackgroundForRow !== null;

  const handleSave = async () => {
    if (!label.trim()) return;
    if (uploadInFlight) {
      toast({
        kind: 'error',
        title: 'Still uploading',
        body: 'Wait for the pose/background upload to finish before saving.',
      });
      return;
    }
    const dedupe = new Set(looks.map((l) => `${l.poseAssetId}::${l.backgroundId}`));
    if (dedupe.size !== looks.length) {
      toast({
        kind: 'error',
        title: 'Duplicate look',
        body: 'Remove the duplicate pose+background pair.',
      });
      return;
    }
    setSaving(true);
    try {
      let thumbnailKey: string | undefined;
      if (thumbnailFile) {
        const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
          '/admin/assets/catalogue-templates/thumbnail/presign',
          { method: 'POST', body: JSON.stringify({ contentType: thumbnailFile.type }) },
        );
        await putFile(presign.uploadUrl, thumbnailFile);
        thumbnailKey = presign.thumbnailKey;
      }

      let templateId: string;
      if (isEditing && template) {
        templateId = template.id;
        await apiFetch(`/admin/assets/catalogue-templates/${templateId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            label: label.trim(),
            sortOrder,
            ...(thumbnailKey ? { thumbnailKey } : {}),
          }),
        });
      } else {
        const created = await apiFetch<{ id: string }>('/admin/assets/catalogue-templates', {
          method: 'POST',
          body: JSON.stringify({
            genderSlug,
            label: label.trim(),
            sortOrder,
            ...(thumbnailKey ? { thumbnailKey } : {}),
          }),
        });
        templateId = created.id;
      }

      await apiFetch(`/admin/assets/catalogue-templates/${templateId}/looks`, {
        method: 'PUT',
        body: JSON.stringify({
          looks: looks
            .filter((l) => l.poseAssetId && l.backgroundId)
            .map((l) => ({ poseAssetId: l.poseAssetId, backgroundId: l.backgroundId })),
        }),
      });

      toast({ title: `${label.trim()} saved` });
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast({
        kind: 'error',
        title: 'Failed to save template',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const validLooks = looks.filter((l) => l.poseAssetId && l.backgroundId);
  const coverPreviewUrl = thumbnailFile ? URL.createObjectURL(thumbnailFile) : undefined;

  return (
    <>
      <div className="modal-overlay" onClick={saving ? undefined : onClose}>
        <div
          className="drawer"
          onClick={(e) => e.stopPropagation()}
          style={{ width: 'min(720px, calc(100vw - 60px))' }}
        >
          <div className="drawer-head">
            <h2>{isEditing ? 'Edit Catalogue Template' : 'New Catalogue Template'}</h2>
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
            className="drawer-body"
            style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            <div className="card">
              <div className="card-head">
                <h3>Template Info</h3>
              </div>
              <div className="card-body" style={{ display: 'flex', gap: 16 }}>
                <UploadTile
                  label="Cover"
                  previewUrl={coverPreviewUrl}
                  thumbnailKey={!thumbnailFile ? (template?.thumbnailKey ?? undefined) : undefined}
                  storageBase={storagePublicUrl}
                  disabled={saving}
                  w={96}
                  h={120}
                  onClick={() => thumbInputRef.current?.click()}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
                  <div className="field">
                    <label>Label</label>
                    <input
                      className="input"
                      value={label}
                      disabled={saving}
                      placeholder="e.g. Autumn Collection"
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>
                        Gender
                        {isEditing && (
                          <span style={{ fontWeight: 400, color: 'var(--muted)' }}> (locked)</span>
                        )}
                      </label>
                      {isEditing ? (
                        <span className="badge dot accent" style={{ marginTop: 2 }}>
                          {genderSlug}
                        </span>
                      ) : (
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
                      )}
                    </div>
                    <div className="field">
                      <label>Sort order</label>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step={1}
                        value={sortOrder}
                        disabled={saving}
                        onChange={(e) => setSortOrder(Number(e.target.value))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Looks</h3>
                <span className="sub">{validLooks.length} ready</span>
                <button
                  type="button"
                  className="btn sm ghost"
                  style={{ marginLeft: 'auto' }}
                  disabled={saving}
                  onClick={addLookRow}
                >
                  <Icon.Add /> Add look
                </button>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {!looksLoaded ? (
                  <div className="empty">Loading looks…</div>
                ) : looks.length === 0 ? (
                  <div className="empty">
                    No looks yet. Each look uploads a fresh pose + background photo.
                  </div>
                ) : (
                  looks.map((row, i) => (
                    <div
                      key={row.key}
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'center',
                        padding: '14px 18px',
                        borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                      }}
                    >
                      <UploadTile
                        label="Pose"
                        thumbnailKey={poseAssetById.get(row.poseAssetId)?.thumbnailKey}
                        storageBase={storagePublicUrl}
                        disabled={saving || uploadingPoseForRow === row.key}
                        loading={uploadingPoseForRow === row.key}
                        onClick={() => openPoseUpload(row.key)}
                      />
                      <UploadTile
                        label="Background"
                        thumbnailKey={backgroundById.get(row.backgroundId)?.thumbnailKey}
                        storageBase={storagePublicUrl}
                        disabled={saving || uploadingBackgroundForRow === row.key}
                        loading={uploadingBackgroundForRow === row.key}
                        onClick={() => openBackgroundUpload(row.key)}
                      />
                      <button
                        type="button"
                        className="iconbtn"
                        disabled={saving}
                        onClick={() => removeLookRow(row.key)}
                        title="Remove look"
                      >
                        <Icon.Trash />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="drawer-foot">
            <button className="btn ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={handleSave}
              disabled={saving || !label.trim() || uploadInFlight}
              title={uploadInFlight ? 'Wait for uploads to finish' : undefined}
            >
              {saving ? 'Saving…' : uploadInFlight ? 'Uploading…' : 'Save template'}
            </button>
          </div>
        </div>
      </div>

      <input
        ref={thumbInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) setThumbnailFile(file);
        }}
      />

      <input
        ref={poseFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handlePoseFileSelected(file);
        }}
      />

      <input
        ref={backgroundFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleBackgroundFileSelected(file);
        }}
      />
    </>
  );
}
