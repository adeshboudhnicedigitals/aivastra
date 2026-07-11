import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/data';
import type { CatalogueTemplate, GenderSlug, ModelBackground, ModelPoseAsset } from '../types';
import { BackgroundUploadModal } from './BackgroundUploadModal';
import { Icon } from './Icons';
import { PoseUploadModal } from './PoseUploadModal';

const UPLOAD_NEW = '__upload_new__';

async function putFile(url: string, file: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

interface LookRow {
  key: string; // stable React key — random per row, independent of the eventual saved id
  poseAssetId: string;
  backgroundId: string;
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
  // the looks builder are added here immediately so they show up in the
  // dropdowns without waiting for the parent tab to refetch.
  const [localPoseAssets, setLocalPoseAssets] = useState(poseAssets);
  const [localBackgrounds, setLocalBackgrounds] = useState(backgrounds);
  useEffect(() => setLocalPoseAssets(poseAssets), [poseAssets]);
  useEffect(() => setLocalBackgrounds(backgrounds), [backgrounds]);

  // Which look row triggered an inline upload, if any — null means no upload modal open.
  const [uploadPoseForRow, setUploadPoseForRow] = useState<string | null>(null);
  const [uploadBackgroundForRow, setUploadBackgroundForRow] = useState<string | null>(null);

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

  const genderPoseAssets = localPoseAssets.filter(
    (p) => p.genderSlug === genderSlug || !p.genderSlug,
  );

  function addLookRow() {
    setLooks((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        poseAssetId: genderPoseAssets[0]?.id ?? '',
        backgroundId: localBackgrounds[0]?.id ?? '',
      },
    ]);
  }

  function updateLookRow(key: string, patch: Partial<LookRow>) {
    setLooks((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLookRow(key: string) {
    setLooks((prev) => prev.filter((l) => l.key !== key));
  }

  const handleSave = async () => {
    if (!label.trim()) return;
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

  return (
    <>
      <div className="modal-overlay" onClick={saving ? undefined : onClose}>
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          style={{ width: 'min(640px, calc(100vw - 40px))' }}
        >
          <div className="modal-head">
            <h3>{isEditing ? 'Edit catalogue template' : 'New catalogue template'}</h3>
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
            className="modal-body"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              maxHeight: '72vh',
              overflowY: 'auto',
            }}
          >
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

            <div className="field">
              <label>
                Gender{' '}
                {isEditing && (
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                    (locked after creation)
                  </span>
                )}
              </label>
              <select
                className="select"
                value={genderSlug}
                disabled={saving || isEditing}
                onChange={(e) => setGenderSlug(e.target.value as GenderSlug)}
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
                step={1}
                value={sortOrder}
                disabled={saving}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                style={{ width: 120 }}
              />
            </div>

            <div className="field">
              <label>Cover thumbnail</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {(thumbnailFile || template?.thumbnailUrl) && (
                  // biome-ignore lint/performance/noImgElement: admin panel thumbnail
                  <img
                    src={
                      thumbnailFile
                        ? URL.createObjectURL(thumbnailFile)
                        : (template?.thumbnailUrl ?? undefined)
                    }
                    alt=""
                    style={{
                      width: 48,
                      height: 60,
                      objectFit: 'cover',
                      borderRadius: 5,
                      border: '1px solid var(--border)',
                    }}
                  />
                )}
                <input
                  ref={thumbInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={saving}
                  onChange={(e) => setThumbnailFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>

            <div className="field">
              <label>
                Looks{' '}
                <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                  (pose + background pairs — falls back to the first look's pose thumbnail if no
                  cover is set)
                </span>
              </label>
              {!looksLoaded ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Loading looks…</p>
              ) : (
                <>
                  {looks.map((row) => (
                    <div
                      key={row.key}
                      style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}
                    >
                      <select
                        className="select"
                        style={{ flex: 1 }}
                        value={row.poseAssetId}
                        disabled={saving}
                        onChange={(e) => {
                          if (e.target.value === UPLOAD_NEW) {
                            setUploadPoseForRow(row.key);
                            return;
                          }
                          updateLookRow(row.key, { poseAssetId: e.target.value });
                        }}
                      >
                        <option value="" disabled>
                          — select pose —
                        </option>
                        {genderPoseAssets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName ?? p.label}
                          </option>
                        ))}
                        <option value={UPLOAD_NEW}>+ Upload new pose…</option>
                      </select>
                      <select
                        className="select"
                        style={{ flex: 1 }}
                        value={row.backgroundId}
                        disabled={saving}
                        onChange={(e) => {
                          if (e.target.value === UPLOAD_NEW) {
                            setUploadBackgroundForRow(row.key);
                            return;
                          }
                          updateLookRow(row.key, { backgroundId: e.target.value });
                        }}
                      >
                        <option value="" disabled>
                          — select background —
                        </option>
                        {localBackgrounds.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label}
                          </option>
                        ))}
                        <option value={UPLOAD_NEW}>+ Upload new background…</option>
                      </select>
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={saving}
                        onClick={() => removeLookRow(row.key)}
                      >
                        <Icon.Trash />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn sm ghost"
                    style={{ marginTop: 8 }}
                    disabled={saving}
                    onClick={addLookRow}
                  >
                    <Icon.Add /> Add look
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="modal-foot">
            <button className="btn ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn primary" onClick={handleSave} disabled={saving || !label.trim()}>
              {saving ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </div>
      </div>

      {uploadPoseForRow && (
        <PoseUploadModal
          garmentTypeGenderSlug={genderSlug}
          onDone={(added) => {
            setLocalPoseAssets((prev) => [...prev, added]);
            updateLookRow(uploadPoseForRow, { poseAssetId: added.id });
            setUploadPoseForRow(null);
          }}
          onClose={() => setUploadPoseForRow(null)}
          toast={toast}
        />
      )}

      {uploadBackgroundForRow && (
        <BackgroundUploadModal
          lockedGenderSlug={genderSlug}
          onDone={(rows) => {
            setLocalBackgrounds((prev) => [...prev, ...rows]);
            const first = rows[0];
            if (first) updateLookRow(uploadBackgroundForRow, { backgroundId: first.id });
            setUploadBackgroundForRow(null);
          }}
          onClose={() => setUploadBackgroundForRow(null)}
          toast={toast}
        />
      )}
    </>
  );
}
