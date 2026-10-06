import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { EditDrawer } from '../../components/EditDrawer';
import { Icon } from '../../components/Icons';
import { Switch } from '../../components/Switch';
import { useCrumb } from '../../context/BreadcrumbContext';
import { useCloseOverlay } from '../../hooks/use-close-overlay';
import { useUrlStateMulti } from '../../hooks/use-url-state';
import {
  apiErrorMessage,
  apiFetch,
  UPLOAD_NETWORK_ERROR,
  uploadErrorMessage,
} from '../../lib/data';
import type { FabricGarmentType } from '../../types';
import { useAssetsContext } from './AssetsContext';

interface PresignResult {
  r2Key: string;
  uploadUrl: string;
}

type FabricGender = 'men' | 'women';

const GENDER_OPTIONS: { k: FabricGender; l: string }[] = [
  { k: 'men', l: 'Men' },
  { k: 'women', l: 'Women' },
];

const FABRIC_GENDER_TABS: { k: 'all' | FabricGender; l: string }[] = [
  { k: 'all', l: 'All' },
  { k: 'men', l: 'Men' },
  { k: 'women', l: 'Women' },
];

function putFile(url: string, file: File): Promise<void> {
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

function PresetModal({
  existing,
  onSaved,
  onClose,
  toast,
}: {
  existing: FabricGarmentType | null;
  onSaved: (preset: FabricGarmentType) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [genderSlug, setGenderSlug] = useState<FabricGender | null>(
    (existing?.genderSlug as FabricGender | null) ?? null,
  );
  const [prompt, setPrompt] = useState(existing?.prompt ?? '');
  const [negativePrompt, setNegativePrompt] = useState(existing?.negativePrompt ?? '');
  const [sortOrder, setSortOrder] = useState(existing?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const save = async () => {
    if (!label.trim() || !slug.trim() || !prompt.trim() || !genderSlug) return;
    setSaving(true);
    try {
      let thumbnailKey = existing?.thumbnailKey ?? undefined;
      if (file) {
        const presign = await apiFetch<PresignResult>(
          '/admin/assets/fabric-garment-types/presign',
          { method: 'POST', body: JSON.stringify({ contentType: file.type }) },
        );
        await putFile(presign.uploadUrl, file);
        thumbnailKey = presign.r2Key;
      }
      const body = {
        label: label.trim(),
        slug: slug.trim(),
        genderSlug,
        thumbnailKey,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || null,
        sortOrder,
        isActive,
      };
      const saved = existing
        ? await apiFetch<FabricGarmentType>(`/admin/assets/fabric-garment-types/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : await apiFetch<FabricGarmentType>('/admin/assets/fabric-garment-types', {
            method: 'POST',
            body: JSON.stringify(body),
          });
      toast({ title: existing ? 'Garment type updated' : 'Garment type created' });
      onSaved(saved);
      onClose();
    } catch (e) {
      toast({
        kind: 'error',
        title: existing ? 'Failed to update garment type' : 'Failed to create garment type',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditDrawer
      onClose={onClose}
      title={existing ? 'Edit garment type' : 'New garment type'}
      width="min(560px, calc(100vw - 40px))"
      saving={saving}
      onSave={() => void save()}
      saveDisabled={!label.trim() || !slug.trim() || !prompt.trim() || !genderSlug}
      saveLabel={existing ? 'Save' : 'Create'}
    >
      <div style={{ display: 'flex', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, flex: 1 }}>
          Label
          <input
            className="input"
            value={label}
            disabled={saving}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Kurti"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, flex: 1 }}>
          Slug
          <input
            className="input"
            value={slug}
            disabled={saving}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="kurti"
          />
        </label>
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'block' }}>
          Gender <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          {GENDER_OPTIONS.map((g) => (
            <button
              key={g.k}
              type="button"
              className={`btn sm ${genderSlug === g.k ? 'primary' : 'ghost'}`}
              disabled={saving}
              onClick={() => setGenderSlug(g.k)}
            >
              {g.l}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginTop: 4 }}>
          Determines which users see this garment type — the same slug can exist once per gender
          with its own prompt.
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {previewUrl ? (
          // biome-ignore lint/performance/noImgElement: admin panel
          <img
            src={previewUrl}
            alt=""
            style={{ width: 72, height: 92, objectFit: 'cover', borderRadius: 8 }}
          />
        ) : (
          <AssetThumb
            thumbnailUrl={existing?.thumbnailUrl}
            fullUrl={existing?.thumbnailUrl}
            label={label || 'Garment'}
            w={72}
            h={92}
          />
        )}
        <button
          type="button"
          className="btn sm"
          disabled={saving}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon.Upload /> {existing?.thumbnailKey || file ? 'Replace image' : 'Upload image'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        Prompt
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          Sent to the workflow's positive prompt node for every job that picks this garment type.
        </span>
        <textarea
          className="input"
          rows={6}
          value={prompt}
          disabled={saving}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Stitch the given fabric into a…"
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        Negative prompt (optional)
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          Leave blank to keep the workflow's own baked-in negative prompt.
        </span>
        <textarea
          className="input"
          rows={3}
          value={negativePrompt ?? ''}
          disabled={saving}
          onChange={(e) => setNegativePrompt(e.target.value)}
          placeholder="transparent mannequin, glass mannequin…"
        />
      </label>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          Sort order
          <input
            type="number"
            className="input"
            style={{ width: 90 }}
            value={sortOrder}
            disabled={saving}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          Active
          <Switch checked={isActive} onChange={setIsActive} />
        </label>
      </div>
    </EditDrawer>
  );
}

export function FabricGarmentTypesTab() {
  const { genderFilter, setGenderFilter, toast } = useAssetsContext();
  const [presets, setPresets] = useState<FabricGarmentType[]>([]);
  const [loading, setLoading] = useState(true);

  const tabHref = '/assets?tab=fabric-garment-types';
  const [{ modal: modalParam, editId }, setModalParams] = useUrlStateMulti(['modal', 'editId']);
  const closeModal = useCloseOverlay(['modal', 'editId']);
  const editing: FabricGarmentType | null =
    modalParam === 'edit-fabric-garment-type' && editId
      ? (presets.find((p) => p.id === editId) ?? null)
      : null;
  const showModal =
    modalParam === 'new-fabric-garment-type' ||
    (modalParam === 'edit-fabric-garment-type' && editing !== null);

  const [{ confirm: confirmParam, confirmId }, setConfirmParams] = useUrlStateMulti([
    'confirm',
    'confirmId',
  ]);
  const closeConfirm = useCloseOverlay(['confirm', 'confirmId']);
  const confirmDeleteId = confirmParam === 'delete-fabric-garment-type' ? confirmId : null;

  useCrumb(0, { label: 'Fabric Garment Types', href: tabHref });
  useCrumb(
    1,
    modalParam === 'new-fabric-garment-type'
      ? { label: 'New garment type', href: `${tabHref}&modal=new-fabric-garment-type` }
      : editing
        ? {
            label: 'Edit garment type',
            href: `${tabHref}&modal=edit-fabric-garment-type&editId=${encodeURIComponent(editing.id)}`,
          }
        : null,
  );
  useCrumb(
    2,
    confirmDeleteId
      ? {
          label: 'Delete garment type',
          href: `${tabHref}&confirm=delete-fabric-garment-type&confirmId=${encodeURIComponent(confirmDeleteId)}`,
        }
      : null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: FabricGarmentType[] }>(
        '/admin/assets/fabric-garment-types',
      );
      setPresets(res.items);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load fabric garment types',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (preset: FabricGarmentType) => {
    const next = !preset.isActive;
    setPresets((previous) =>
      previous.map((candidate) =>
        candidate.id === preset.id ? { ...candidate, isActive: next } : candidate,
      ),
    );
    try {
      await apiFetch(`/admin/assets/fabric-garment-types/${preset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
    } catch (e) {
      setPresets((previous) =>
        previous.map((candidate) => (candidate.id === preset.id ? preset : candidate)),
      );
      toast({
        kind: 'error',
        title: 'Failed to update garment type',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  const doDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    closeConfirm();
    try {
      await apiFetch(`/admin/assets/fabric-garment-types/${id}`, { method: 'DELETE' });
      setPresets((previous) => previous.filter((p) => p.id !== id));
      toast({ title: 'Garment type deleted' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to delete garment type',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  // Legacy rows created before gender scoping was added have genderSlug === null
  // ("show for every gender") — keep them visible under a specific tab too, since
  // they still apply until an admin edits them to pick one.
  const filteredPresets =
    genderFilter === 'men' || genderFilter === 'women'
      ? presets.filter((p) => p.genderSlug === genderFilter || p.genderSlug === null)
      : presets;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Fabric Garment Types</h1>
          <p className="lede">
            Garment-type presets shown to users on the Fabric to Garment page — each one's prompt is
            sent to the workflow when a job picks it.
          </p>
        </div>
        <div className="head-tools">
          <button
            className="btn"
            onClick={() => setModalParams({ modal: 'new-fabric-garment-type', editId: null })}
          >
            <Icon.Add /> New garment type
          </button>
        </div>
      </div>

      <div className="tabs" style={{ marginTop: -8 }}>
        {FABRIC_GENDER_TABS.map((t) => (
          <button
            key={t.k}
            className={`tab ${genderFilter === t.k ? 'active' : ''}`}
            onClick={() => setGenderFilter(t.k)}
          >
            {t.l}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', marginTop: 24 }}>Loading…</p>
      ) : filteredPresets.length === 0 ? (
        <p style={{ color: 'var(--muted)', marginTop: 24 }}>No fabric garment types yet.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
            marginTop: 12,
          }}
        >
          {filteredPresets.map((preset) => (
            <div
              key={preset.id}
              className="card"
              style={{ padding: 12, opacity: preset.isActive ? 1 : 0.55 }}
            >
              <AssetThumb
                thumbnailUrl={preset.thumbnailUrl}
                fullUrl={preset.thumbnailUrl}
                label={preset.label}
                w={160}
                h={200}
              />
              <p style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>{preset.label}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>{preset.slug}</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 8,
                    background: preset.genderSlug ? 'var(--subtle)' : 'rgba(217,119,6,0.12)',
                    color: preset.genderSlug ? 'var(--muted)' : '#b45309',
                  }}
                >
                  {preset.genderSlug === 'men'
                    ? 'Men'
                    : preset.genderSlug === 'women'
                      ? 'Women'
                      : 'Set gender'}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 8,
                  gap: 4,
                }}
              >
                <Switch checked={preset.isActive} onChange={() => void toggleActive(preset)} />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="btn ghost"
                    style={{ fontSize: 10, padding: '3px 8px' }}
                    onClick={() =>
                      setModalParams({ modal: 'edit-fabric-garment-type', editId: preset.id })
                    }
                  >
                    <Icon.Edit /> Edit
                  </button>
                  <button
                    className="btn ghost"
                    style={{ fontSize: 10, padding: '3px 8px', color: 'var(--danger)' }}
                    onClick={() =>
                      setConfirmParams({
                        confirm: 'delete-fabric-garment-type',
                        confirmId: preset.id,
                      })
                    }
                  >
                    <Icon.Trash />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <PresetModal
          existing={editing}
          onSaved={(saved) => {
            setPresets((previous) => {
              const exists = previous.some((preset) => preset.id === saved.id);
              return exists
                ? previous.map((preset) => (preset.id === saved.id ? saved : preset))
                : [...previous, saved];
            });
          }}
          onClose={closeModal}
          toast={toast}
        />
      )}

      {confirmDeleteId && (
        <div className="modal-overlay" onClick={closeConfirm}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <h3>Delete garment type?</h3>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                This can't be undone. Jobs already submitted with this preset keep their generated
                results — only future selections are affected.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={closeConfirm}>
                Cancel
              </button>
              <button className="btn danger" onClick={() => void doDelete()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
