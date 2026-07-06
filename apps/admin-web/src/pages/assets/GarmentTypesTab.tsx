import { useCallback, useEffect, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { Icon } from '../../components/Icons';
import { Switch } from '../../components/Switch';
import { apiFetch } from '../../lib/data';
import { makeThumbnail } from '../../lib/thumbnail';
import type {
  GarmentType,
  GenderSlug,
  PoseGarmentConfig,
  TryonCategory,
  WorkflowOption,
} from '../../types';
import { useAssetsContext } from './AssetsContext';

type SubView = { kind: 'list' } | { kind: 'configs'; sub: GarmentType };
type ConfirmDeleteGT = { type: 'garment-type'; id: string; label: string };

const GENDER_TABS = [
  { k: 'all' as const, l: 'All' },
  { k: 'men' as const, l: 'Men' },
  { k: 'women' as const, l: 'Women' },
  { k: 'boys' as const, l: 'Boys' },
  { k: 'girls' as const, l: 'Girls' },
];

export function GarmentTypesTab() {
  const {
    genderFilter,
    setGenderFilter,
    garmentTypes,
    setGarmentTypes,
    loadGarmentTypes,
    workflows,
    setWorkflows,
    catalogItems,
    loading,
    storagePublicUrl,
    toast,
  } = useAssetsContext();

  const [subView, setSubView] = useState<SubView>({ kind: 'list' });
  const [poseConfigs, setPoseConfigs] = useState<PoseGarmentConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [savingConfigId, setSavingConfigId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteGT | null>(null);
  const [tryonCategories, setTryonCategories] = useState<TryonCategory[]>([]);

  // Add garment type modal
  const [showSubcatModal, setShowSubcatModal] = useState(false);
  const [subcatForm, setSubcatForm] = useState({
    slug: '',
    label: '',
    genderSlug: 'men' as GenderSlug,
    requiresLowerUpload: false,
  });
  const [subcatSaving, setSubcatSaving] = useState(false);
  const [subcatImageFile, setSubcatImageFile] = useState<File | null>(null);

  // Edit garment type modal
  const [editingSubcat, setEditingSubcat] = useState<GarmentType | null>(null);
  const [editSubcatImageFile, setEditSubcatImageFile] = useState<File | null>(null);
  const [editSubcatSaving, setEditSubcatSaving] = useState(false);
  const [editSubcatLabel, setEditSubcatLabel] = useState('');
  const [editSubcatRequiresLowerUpload, setEditSubcatRequiresLowerUpload] = useState(false);
  const [editSubcatDefaultLowerId, setEditSubcatDefaultLowerId] = useState<string>('');
  const [editSubcatDefaultShoeId, setEditSubcatDefaultShoeId] = useState<string>('');
  const [editSubcatTryonCategoryId, setEditSubcatTryonCategoryId] = useState<string>('');
  const [editSubcatInstructionFile, setEditSubcatInstructionFile] = useState<File | null>(null);
  const [editRemoveInstructionImage, setEditRemoveInstructionImage] = useState(false);

  const loadPoseConfigs = useCallback(
    async (garmentTypeId: string) => {
      setConfigsLoading(true);
      try {
        const res = await apiFetch<{ items: PoseGarmentConfig[] }>(
          `/admin/assets/garment-types/${garmentTypeId}/pose-configs`,
        );
        setPoseConfigs(res.items);
      } catch {
        toast({ kind: 'error', title: 'Failed to load pose configs' });
      } finally {
        setConfigsLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (subView.kind === 'list') {
      void loadGarmentTypes();
    } else {
      void loadPoseConfigs(subView.sub.id);
      if (workflows.length === 0) {
        void apiFetch<WorkflowOption[]>('/admin/workflows')
          .then(setWorkflows)
          .catch(() => {});
      }
    }
  }, [subView, loadGarmentTypes, loadPoseConfigs, workflows.length, setWorkflows]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (subView.kind === 'list') void loadGarmentTypes();
      else void loadPoseConfigs(subView.sub.id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [subView, loadGarmentTypes, loadPoseConfigs]);

  useEffect(() => {
    apiFetch<TryonCategory[]>('/admin/tryon-categories')
      .then(setTryonCategories)
      .catch(() => {});
  }, []);

  const saveConfig = async (
    garmentTypeId: string,
    poseAssetId: string,
    patch: {
      workflowTemplateId: string | null;
      promptGarmentPhase: string | null;
      promptFacePhase: string | null;
    },
  ) => {
    setSavingConfigId(poseAssetId);
    try {
      await apiFetch(`/admin/assets/garment-types/${garmentTypeId}/pose-configs/${poseAssetId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setPoseConfigs((prev) =>
        prev.map((p) =>
          p.id === poseAssetId
            ? {
                ...p,
                config:
                  patch.workflowTemplateId || patch.promptGarmentPhase || patch.promptFacePhase
                    ? patch
                    : null,
              }
            : p,
        ),
      );
      toast({ title: 'Config saved' });
    } catch {
      toast({ kind: 'error', title: 'Failed to save config' });
    } finally {
      setSavingConfigId(null);
    }
  };

  const togglePoseActive = async (poseAssetId: string, isActive: boolean) => {
    setPoseConfigs((prev) => prev.map((p) => (p.id === poseAssetId ? { ...p, isActive } : p)));
    try {
      await apiFetch(`/admin/assets/pose-assets/${poseAssetId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      });
    } catch {
      setPoseConfigs((prev) =>
        prev.map((p) => (p.id === poseAssetId ? { ...p, isActive: !isActive } : p)),
      );
      toast({ kind: 'error', title: 'Failed to update pose' });
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id, label } = confirmDelete;
    setConfirmDelete(null);
    try {
      await apiFetch(`/admin/assets/garment-types/${id}`, { method: 'DELETE' });
      setGarmentTypes((prev) => prev.filter((s) => s.id !== id));
      toast({ title: `${label} deleted` });
    } catch {
      toast({ kind: 'error', title: 'Failed to delete garment type' });
    }
  };

  const filteredGarmentTypes = garmentTypes.filter(
    (s) => genderFilter === 'all' || s.genderSlug === genderFilter,
  );

  return (
    <>
      <div className="page-head">
        <div>
          {subView.kind === 'configs' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                fontSize: 13,
                color: 'var(--muted)',
              }}
            >
              <button
                className="btn sm ghost"
                onClick={() => setSubView({ kind: 'list' })}
                style={{ padding: '2px 8px', fontSize: 13 }}
              >
                Garment Types
              </button>
              <Icon.Chevron />
              <span>{subView.sub.label}</span>
            </div>
          )}
          <h1>
            {subView.kind === 'configs' ? `${subView.sub.label} — Pose Configs` : 'Garment Types'}
          </h1>
          <p className="lede">
            {subView.kind === 'configs'
              ? `Override workflow and prompts per pose for ${subView.sub.genderSlug} / ${subView.sub.slug}.`
              : 'Garment types used to classify uploads.'}
          </p>
        </div>
        {subView.kind === 'list' && (
          <div className="head-tools">
            <button
              className="btn"
              onClick={() => {
                setSubcatForm({
                  slug: '',
                  label: '',
                  genderSlug: 'men',
                  requiresLowerUpload: false,
                });
                setShowSubcatModal(true);
              }}
            >
              <Icon.Add /> Add garment type
            </button>
          </div>
        )}
      </div>

      {/* Pose configs subview */}
      {subView.kind === 'configs' && (
        <PoseConfigsPanel
          sub={subView.sub}
          items={poseConfigs}
          loading={configsLoading}
          savingId={savingConfigId}
          workflows={workflows}
          storagePublicUrl={storagePublicUrl}
          onBack={() => setSubView({ kind: 'list' })}
          onSave={saveConfig}
          onToggleActive={togglePoseActive}
        />
      )}

      {subView.kind === 'list' && !loading && (
        <>
          <div className="tabs" style={{ marginTop: -8 }}>
            {GENDER_TABS.map((t) => (
              <button
                key={t.k}
                className={`tab ${genderFilter === t.k ? 'active' : ''}`}
                onClick={() => setGenderFilter(t.k)}
              >
                {t.l}
              </button>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Garment Type</th>
                  <th>Gender</th>
                  <th>Default Lower</th>
                  <th>Default Shoe</th>
                  <th>Tryon Category</th>
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredGarmentTypes.map((sub) => (
                  <tr
                    key={sub.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSubView({ kind: 'configs', sub })}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <AssetThumb
                          thumbnailKey={sub.thumbnailKey ?? undefined}
                          label={sub.label}
                          w={40}
                          h={40}
                          storageBase={storagePublicUrl}
                        />
                        <div>
                          <span className="semi">{sub.label}</span>
                          <span className="sub mono" style={{ display: 'block' }}>
                            {sub.slug}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge dot accent">{sub.genderSlug}</span>
                    </td>
                    <td>
                      {(() => {
                        const item = catalogItems.find((c) => c.id === sub.defaultLowerCatalogId);
                        return item ? (
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            title={item.label}
                          >
                            <AssetThumb
                              thumbnailKey={item.thumbnailKey}
                              label={item.label}
                              w={32}
                              h={32}
                              storageBase={storagePublicUrl}
                            />
                            <span
                              style={{
                                fontSize: 12,
                                color: 'var(--muted)',
                                maxWidth: 100,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {item.label}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                        );
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const item = catalogItems.find((c) => c.id === sub.defaultShoeCatalogId);
                        return item ? (
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            title={item.label}
                          >
                            <AssetThumb
                              thumbnailKey={item.thumbnailKey}
                              label={item.label}
                              w={32}
                              h={32}
                              storageBase={storagePublicUrl}
                            />
                            <span
                              style={{
                                fontSize: 12,
                                color: 'var(--muted)',
                                maxWidth: 100,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {item.label}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                        );
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const cat = tryonCategories.find((c) => c.id === sub.tryonCategoryId);
                        return cat ? (
                          <span className="badge dot accent">{cat.name}</span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                        );
                      })()}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={sub.isActive}
                        onChange={async () => {
                          const next = !sub.isActive;
                          setGarmentTypes((prev) =>
                            prev.map((s) => (s.id === sub.id ? { ...s, isActive: next } : s)),
                          );
                          try {
                            await apiFetch(`/admin/assets/garment-types/${sub.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ isActive: next }),
                            });
                            toast({
                              title: `${sub.label} ${sub.isActive ? 'deactivated' : 'activated'}`,
                            });
                          } catch {
                            setGarmentTypes((prev) =>
                              prev.map((s) =>
                                s.id === sub.id ? { ...s, isActive: sub.isActive } : s,
                              ),
                            );
                            toast({ kind: 'error', title: 'Failed to update garment type' });
                          }
                        }}
                      />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn sm ghost"
                          onClick={() => {
                            setEditingSubcat(sub);
                            setEditSubcatLabel(sub.label);
                            setEditSubcatRequiresLowerUpload(sub.requiresLowerUpload);
                            setEditSubcatDefaultLowerId(sub.defaultLowerCatalogId ?? '');
                            setEditSubcatDefaultShoeId(sub.defaultShoeCatalogId ?? '');
                            setEditSubcatTryonCategoryId(sub.tryonCategoryId ?? '');
                            setEditSubcatImageFile(null);
                            setEditSubcatInstructionFile(null);
                            setEditRemoveInstructionImage(false);
                          }}
                        >
                          <Icon.Edit />
                        </button>
                        <button
                          className="btn sm ghost"
                          onClick={() =>
                            setConfirmDelete({ type: 'garment-type', id: sub.id, label: sub.label })
                          }
                        >
                          <Icon.Trash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredGarmentTypes.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                    >
                      No garment types found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Modals ── */}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete garment type</h3>
            </div>
            <div className="modal-body">
              <p>
                Delete <strong>{confirmDelete.label}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="btn danger" onClick={doDelete}>
                <Icon.Trash /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add garment type */}
      {showSubcatModal && (
        <div
          className="modal-overlay"
          onClick={
            subcatSaving
              ? undefined
              : () => {
                  setShowSubcatModal(false);
                  setSubcatImageFile(null);
                }
          }
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(440px, calc(100vw - 80px))' }}
          >
            <div className="modal-head">
              <h3>Add garment type</h3>
              <button
                className="btn sm ghost"
                onClick={() => {
                  setShowSubcatModal(false);
                  setSubcatImageFile(null);
                }}
                disabled={subcatSaving}
                style={{ marginLeft: 'auto' }}
              >
                <Icon.Close />
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div className="field">
                <label>Label</label>
                <input
                  className="input"
                  placeholder="Full Sleeve Shirt"
                  value={subcatForm.label}
                  disabled={subcatSaving}
                  onChange={(e) => setSubcatForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Slug</label>
                <input
                  className="input"
                  placeholder="fullsleeveshirt"
                  value={subcatForm.slug}
                  disabled={subcatSaving}
                  onChange={(e) =>
                    setSubcatForm((f) => ({
                      ...f,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                    }))
                  }
                />
              </div>
              <div className="field">
                <label>Gender</label>
                <select
                  className="select"
                  value={subcatForm.genderSlug}
                  disabled={subcatSaving}
                  onChange={(e) =>
                    setSubcatForm((f) => ({ ...f, genderSlug: e.target.value as GenderSlug }))
                  }
                >
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                  <option value="boys">Boys</option>
                  <option value="girls">Girls</option>
                </select>
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={subcatForm.requiresLowerUpload}
                    disabled={subcatSaving}
                    onChange={(e) =>
                      setSubcatForm((f) => ({ ...f, requiresLowerUpload: e.target.checked }))
                    }
                  />
                  Requires lower garment upload
                  <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>
                    (user uploads bottom wear separately)
                  </span>
                </label>
              </div>
              <div className="field">
                <label>
                  Thumbnail image{' '}
                  <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {subcatImageFile ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={URL.createObjectURL(subcatImageFile)}
                      alt="preview"
                      style={{
                        width: 48,
                        height: 48,
                        objectFit: 'cover',
                        borderRadius: 6,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 6,
                        background: 'var(--subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon.Image />
                    </div>
                  )}
                  <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
                    {subcatImageFile ? 'Change image' : 'Upload image'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setSubcatImageFile(f);
                      }}
                    />
                  </label>
                  {subcatImageFile && (
                    <button className="btn sm ghost" onClick={() => setSubcatImageFile(null)}>
                      <Icon.Close />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => {
                  setShowSubcatModal(false);
                  setSubcatImageFile(null);
                }}
                disabled={subcatSaving}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={subcatSaving || !subcatForm.label.trim() || !subcatForm.slug.trim()}
                onClick={async () => {
                  setSubcatSaving(true);
                  try {
                    let thumbnailKey: string | undefined;
                    if (subcatImageFile) {
                      const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
                        '/admin/assets/garment-types/presign',
                        {
                          method: 'POST',
                          body: JSON.stringify({ contentType: subcatImageFile.type }),
                        },
                      );
                      const thumb = await makeThumbnail(subcatImageFile);
                      await fetch(presign.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': thumb.type },
                        body: thumb,
                      });
                      thumbnailKey = presign.thumbnailKey;
                    }
                    const row = await apiFetch<GarmentType>('/admin/assets/garment-types', {
                      method: 'POST',
                      body: JSON.stringify({ ...subcatForm, thumbnailKey }),
                    });
                    setGarmentTypes((prev) => [...prev, row]);
                    toast({ title: `${row.label} created` });
                    setShowSubcatModal(false);
                    setSubcatImageFile(null);
                  } catch {
                    toast({ kind: 'error', title: 'Failed to create garment type' });
                  } finally {
                    setSubcatSaving(false);
                  }
                }}
              >
                <Icon.Add /> {subcatSaving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit garment type */}
      {editingSubcat && (
        <div
          className="modal-overlay"
          onClick={
            editSubcatSaving
              ? undefined
              : () => {
                  setEditingSubcat(null);
                  setEditSubcatImageFile(null);
                  setEditSubcatInstructionFile(null);
                  setEditRemoveInstructionImage(false);
                  setEditSubcatLabel('');
                  setEditSubcatRequiresLowerUpload(false);
                }
          }
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(440px, calc(100vw - 80px))' }}
          >
            <div className="modal-head">
              <h3>Edit garment type</h3>
              <button
                className="btn sm ghost"
                onClick={() => {
                  setEditingSubcat(null);
                  setEditSubcatImageFile(null);
                  setEditSubcatInstructionFile(null);
                  setEditRemoveInstructionImage(false);
                  setEditSubcatLabel('');
                  setEditSubcatRequiresLowerUpload(false);
                  setEditSubcatDefaultLowerId('');
                  setEditSubcatDefaultShoeId('');
                  setEditSubcatTryonCategoryId('');
                }}
                disabled={editSubcatSaving}
                style={{ marginLeft: 'auto' }}
              >
                <Icon.Close />
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div className="field">
                <label>Label</label>
                <input
                  className="input"
                  value={editSubcatLabel}
                  disabled={editSubcatSaving}
                  onChange={(e) => setEditSubcatLabel(e.target.value)}
                />
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editSubcatRequiresLowerUpload}
                    disabled={editSubcatSaving}
                    onChange={(e) => setEditSubcatRequiresLowerUpload(e.target.checked)}
                  />
                  Requires lower garment upload
                  <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>
                    (user uploads bottom wear separately)
                  </span>
                </label>
              </div>
              <div className="field">
                <label>Tryon Category</label>
                <select
                  className="select"
                  value={editSubcatTryonCategoryId}
                  disabled={editSubcatSaving}
                  onChange={(e) => setEditSubcatTryonCategoryId(e.target.value)}
                >
                  <option value="">— none —</option>
                  {tryonCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>
                  Maps this garment type to a tryon workflow for the "Browse from Catalog" picker on
                  the tryon page.
                </span>
              </div>
              <div className="field">
                <label>Default lower garment</label>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    maxHeight: 180,
                    overflowY: 'auto',
                    padding: '2px 0',
                    opacity: editSubcatSaving ? 0.5 : 1,
                    pointerEvents: editSubcatSaving ? 'none' : undefined,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setEditSubcatDefaultLowerId('')}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 3,
                      background: 'none',
                      border: `2px solid ${editSubcatDefaultLowerId === '' ? 'var(--pink)' : 'var(--border)'}`,
                      borderRadius: 6,
                      padding: 3,
                      cursor: 'pointer',
                      width: 62,
                    }}
                  >
                    <div
                      style={{
                        width: 54,
                        height: 54,
                        borderRadius: 4,
                        background: 'var(--subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--muted)',
                        fontSize: 18,
                      }}
                    >
                      —
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1 }}>None</span>
                  </button>
                  {catalogItems
                    .filter(
                      (c) =>
                        c.type === 'lower' &&
                        c.isActive &&
                        (!c.genderSlug || c.genderSlug === editingSubcat.genderSlug),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        title={c.label}
                        onClick={() =>
                          setEditSubcatDefaultLowerId(c.id === editSubcatDefaultLowerId ? '' : c.id)
                        }
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 3,
                          background: 'none',
                          border: `2px solid ${editSubcatDefaultLowerId === c.id ? 'var(--pink)' : 'var(--border)'}`,
                          borderRadius: 6,
                          padding: 3,
                          cursor: 'pointer',
                          width: 62,
                        }}
                      >
                        <AssetThumb
                          thumbnailKey={c.thumbnailKey}
                          label={c.label}
                          w={54}
                          h={54}
                          storageBase={storagePublicUrl}
                        />
                        <span
                          style={{
                            fontSize: 10,
                            color: 'var(--muted)',
                            lineHeight: 1,
                            maxWidth: 54,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.label}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
              <div className="field">
                <label>Default shoe</label>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    maxHeight: 180,
                    overflowY: 'auto',
                    padding: '2px 0',
                    opacity: editSubcatSaving ? 0.5 : 1,
                    pointerEvents: editSubcatSaving ? 'none' : undefined,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setEditSubcatDefaultShoeId('')}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 3,
                      background: 'none',
                      border: `2px solid ${editSubcatDefaultShoeId === '' ? 'var(--pink)' : 'var(--border)'}`,
                      borderRadius: 6,
                      padding: 3,
                      cursor: 'pointer',
                      width: 62,
                    }}
                  >
                    <div
                      style={{
                        width: 54,
                        height: 54,
                        borderRadius: 4,
                        background: 'var(--subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--muted)',
                        fontSize: 18,
                      }}
                    >
                      —
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1 }}>None</span>
                  </button>
                  {catalogItems
                    .filter(
                      (c) =>
                        c.type === 'shoe' &&
                        c.isActive &&
                        (!c.genderSlug || c.genderSlug === editingSubcat.genderSlug),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        title={c.label}
                        onClick={() =>
                          setEditSubcatDefaultShoeId(c.id === editSubcatDefaultShoeId ? '' : c.id)
                        }
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 3,
                          background: 'none',
                          border: `2px solid ${editSubcatDefaultShoeId === c.id ? 'var(--pink)' : 'var(--border)'}`,
                          borderRadius: 6,
                          padding: 3,
                          cursor: 'pointer',
                          width: 62,
                        }}
                      >
                        <AssetThumb
                          thumbnailKey={c.thumbnailKey}
                          label={c.label}
                          w={54}
                          h={54}
                          storageBase={storagePublicUrl}
                        />
                        <span
                          style={{
                            fontSize: 10,
                            color: 'var(--muted)',
                            lineHeight: 1,
                            maxWidth: 54,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.label}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
              <div className="field">
                <label>Thumbnail image</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {editSubcatImageFile ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={URL.createObjectURL(editSubcatImageFile)}
                      alt="preview"
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: 'cover',
                        borderRadius: 6,
                        flexShrink: 0,
                      }}
                    />
                  ) : editingSubcat.thumbnailKey && storagePublicUrl ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={`${storagePublicUrl}/${editingSubcat.thumbnailKey}`}
                      alt={editingSubcat.label}
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: 'cover',
                        borderRadius: 6,
                        flexShrink: 0,
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 6,
                        background: 'var(--subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: 'var(--muted)',
                        fontSize: 12,
                      }}
                    >
                      No image
                    </div>
                  )}
                  <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
                    {editSubcatImageFile || editingSubcat.thumbnailKey
                      ? 'Replace image'
                      : 'Upload image'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setEditSubcatImageFile(f);
                      }}
                    />
                  </label>
                  {editSubcatImageFile && (
                    <button className="btn sm ghost" onClick={() => setEditSubcatImageFile(null)}>
                      <Icon.Close />
                    </button>
                  )}
                </div>
              </div>
              <div className="field">
                <label>Instruction image</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {editSubcatInstructionFile ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={URL.createObjectURL(editSubcatInstructionFile)}
                      alt="preview"
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: 'cover',
                        borderRadius: 6,
                        flexShrink: 0,
                      }}
                    />
                  ) : editingSubcat.instructionImageUrl ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={editingSubcat.instructionImageUrl}
                      alt="Instruction"
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: 'cover',
                        borderRadius: 6,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 6,
                        background: 'var(--subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: 'var(--muted)',
                        fontSize: 12,
                      }}
                    >
                      No image
                    </div>
                  )}
                  <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
                    {editSubcatInstructionFile || editingSubcat.instructionImageUrl
                      ? 'Replace image'
                      : 'Upload image'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setEditSubcatInstructionFile(f);
                      }}
                    />
                  </label>
                  {editSubcatInstructionFile && (
                    <button
                      className="btn sm ghost"
                      onClick={() => setEditSubcatInstructionFile(null)}
                    >
                      <Icon.Close />
                    </button>
                  )}
                  {!editSubcatInstructionFile && editingSubcat.instructionImageUrl && (
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        setEditRemoveInstructionImage(true);
                      }}
                    >
                      <Icon.Close />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => {
                  setEditingSubcat(null);
                  setEditSubcatImageFile(null);
                  setEditSubcatInstructionFile(null);
                  setEditRemoveInstructionImage(false);
                  setEditSubcatLabel('');
                  setEditSubcatRequiresLowerUpload(false);
                  setEditSubcatDefaultLowerId('');
                  setEditSubcatDefaultShoeId('');
                  setEditSubcatTryonCategoryId('');
                }}
                disabled={editSubcatSaving}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={
                  editSubcatSaving ||
                  (!editSubcatImageFile &&
                    !editSubcatInstructionFile &&
                    !editRemoveInstructionImage &&
                    editSubcatLabel.trim() === editingSubcat.label.trim() &&
                    editSubcatRequiresLowerUpload === editingSubcat.requiresLowerUpload &&
                    editSubcatDefaultLowerId === (editingSubcat.defaultLowerCatalogId ?? '') &&
                    editSubcatDefaultShoeId === (editingSubcat.defaultShoeCatalogId ?? '') &&
                    editSubcatTryonCategoryId === (editingSubcat.tryonCategoryId ?? ''))
                }
                onClick={async () => {
                  setEditSubcatSaving(true);
                  try {
                    const patchBody: {
                      thumbnailKey?: string;
                      instructionImageKey?: string | null;
                      label?: string;
                      requiresLowerUpload?: boolean;
                      defaultLowerCatalogId?: string | null;
                      defaultShoeCatalogId?: string | null;
                      tryonCategoryId?: string | null;
                    } = {};
                    if (editSubcatImageFile) {
                      const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
                        '/admin/assets/garment-types/presign',
                        {
                          method: 'POST',
                          body: JSON.stringify({ contentType: editSubcatImageFile.type }),
                        },
                      );
                      const thumb = await makeThumbnail(editSubcatImageFile);
                      await fetch(presign.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': thumb.type },
                        body: thumb,
                      });
                      patchBody.thumbnailKey = presign.thumbnailKey;
                    }
                    // ─── INSTRUCTION IMAGE UPLOAD ───
                    if (editSubcatInstructionFile) {
                      const presign = await apiFetch<{
                        uploadUrl: string;
                        instructionImageKey: string;
                      }>('/admin/assets/garment-types/instruction/presign', {
                        method: 'POST',
                        body: JSON.stringify({ contentType: editSubcatInstructionFile.type }),
                      });
                      await fetch(presign.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': editSubcatInstructionFile.type },
                        body: editSubcatInstructionFile,
                      });
                      patchBody.instructionImageKey = presign.instructionImageKey;
                    } else if (editRemoveInstructionImage) {
                      patchBody.instructionImageKey = null;
                    }
                    // ─── end instruction image upload ───
                    if (editSubcatLabel.trim() !== editingSubcat.label.trim()) {
                      patchBody.label = editSubcatLabel.trim();
                    }
                    if (editSubcatRequiresLowerUpload !== editingSubcat.requiresLowerUpload) {
                      patchBody.requiresLowerUpload = editSubcatRequiresLowerUpload;
                    }
                    if (editSubcatDefaultLowerId !== (editingSubcat.defaultLowerCatalogId ?? '')) {
                      patchBody.defaultLowerCatalogId = editSubcatDefaultLowerId || null;
                    }
                    if (editSubcatDefaultShoeId !== (editingSubcat.defaultShoeCatalogId ?? '')) {
                      patchBody.defaultShoeCatalogId = editSubcatDefaultShoeId || null;
                    }
                    if (editSubcatTryonCategoryId !== (editingSubcat.tryonCategoryId ?? '')) {
                      patchBody.tryonCategoryId = editSubcatTryonCategoryId || null;
                    }
                    if (Object.keys(patchBody).length > 0) {
                      await apiFetch(`/admin/assets/garment-types/${editingSubcat.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify(patchBody),
                      });
                      setGarmentTypes((prev) =>
                        prev.map((s) => (s.id === editingSubcat.id ? { ...s, ...patchBody } : s)),
                      );
                    }
                    toast({ title: `${patchBody.label ?? editingSubcat.label} updated` });
                    setEditingSubcat(null);
                    setEditSubcatImageFile(null);
                    setEditSubcatInstructionFile(null);
                    setEditRemoveInstructionImage(false);
                    setEditSubcatLabel('');
                    setEditSubcatRequiresLowerUpload(false);
                    setEditSubcatDefaultLowerId('');
                    setEditSubcatDefaultShoeId('');
                    setEditSubcatTryonCategoryId('');
                  } catch {
                    toast({ kind: 'error', title: 'Failed to save' });
                  } finally {
                    setEditSubcatSaving(false);
                  }
                }}
              >
                {editSubcatSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── PoseConfigsPanel ──────────────────────────────────────────────────────────

interface PoseConfigsPanelProps {
  sub: GarmentType;
  items: PoseGarmentConfig[];
  loading: boolean;
  savingId: string | null;
  workflows: WorkflowOption[];
  storagePublicUrl: string | null;
  onBack: () => void;
  onSave: (
    garmentTypeId: string,
    poseAssetId: string,
    patch: {
      workflowTemplateId: string | null;
      promptGarmentPhase: string | null;
      promptFacePhase: string | null;
    },
  ) => Promise<void>;
  onToggleActive: (poseAssetId: string, isActive: boolean) => Promise<void>;
}

function PoseConfigsPanel({
  sub,
  items,
  loading,
  savingId,
  workflows,
  storagePublicUrl,
  onBack,
  onSave,
  onToggleActive,
}: PoseConfigsPanelProps) {
  const [editing, setEditing] = useState<PoseGarmentConfig | null>(null);
  const [editWorkflow, setEditWorkflow] = useState('');
  const [editGarmentPrompt, setEditGarmentPrompt] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkWorkflow, setBulkWorkflow] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectAll = () => setSelectedIds(items.map((i) => i.id));
  const clearSelection = () => setSelectedIds([]);

  const applyBulkWorkflow = async () => {
    if (!bulkWorkflow || selectedIds.length === 0) return;
    setBulkSaving(true);
    try {
      await Promise.all(
        selectedIds.map((id) => {
          const item = items.find((i) => i.id === id);
          return onSave(sub.id, id, {
            workflowTemplateId: bulkWorkflow,
            promptGarmentPhase: item?.config?.promptGarmentPhase ?? null,
            promptFacePhase: null,
          });
        }),
      );
      clearSelection();
      setBulkWorkflow('');
    } finally {
      setBulkSaving(false);
    }
  };

  const applyBulkClearOverride = async () => {
    if (selectedIds.length === 0) return;
    setBulkSaving(true);
    try {
      await Promise.all(
        selectedIds.map((id) =>
          onSave(sub.id, id, {
            workflowTemplateId: null,
            promptGarmentPhase: null,
            promptFacePhase: null,
          }),
        ),
      );
      clearSelection();
      setBulkWorkflow('');
    } finally {
      setBulkSaving(false);
    }
  };

  const openEdit = (item: PoseGarmentConfig) => {
    setEditing(item);
    setEditWorkflow(item.config?.workflowTemplateId ?? '');
    // Pre-fill with override if set, else inherit pose default so user edits from it
    setEditGarmentPrompt(item.config?.promptGarmentPhase ?? item.defaultPromptGarmentPhase ?? '');
  };

  const closeEdit = () => {
    setEditing(null);
    setEditWorkflow('');
    setEditGarmentPrompt('');
  };

  const doSave = async () => {
    if (!editing) return;
    await onSave(sub.id, editing.id, {
      workflowTemplateId: editWorkflow || null,
      promptGarmentPhase: editGarmentPrompt || null,
      promptFacePhase: null,
    });
    closeEdit();
  };

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
        No active poses for {sub.genderSlug}.
      </div>
    );
  }

  return (
    <>
      {/* Bulk action bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 12,
          marginBottom: 4,
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <button className="btn ghost" onClick={onBack}>
          <Icon.ArrowLeft /> Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn sm ghost"
            onClick={selectedIds.length === items.length ? clearSelection : selectAll}
          >
            {selectedIds.length === items.length ? 'Deselect all' : 'Select all'}
          </button>
          {selectedIds.length > 0 && (
            <>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {selectedIds.length} selected
              </span>
              <select
                className="select"
                style={{ fontSize: 12, padding: '3px 8px', height: 30 }}
                value={bulkWorkflow}
                disabled={bulkSaving}
                onChange={(e) => setBulkWorkflow(e.target.value)}
              >
                <option value="">Pick workflow…</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
              <button
                className="btn sm primary"
                disabled={!bulkWorkflow || bulkSaving}
                onClick={() => void applyBulkWorkflow()}
              >
                {bulkSaving ? 'Applying…' : 'Apply workflow'}
              </button>
              <button
                className="btn sm ghost"
                disabled={bulkSaving}
                onClick={() => void applyBulkClearOverride()}
              >
                {bulkSaving ? 'Clearing…' : 'Clear override'}
              </button>
              <button className="btn sm ghost" onClick={clearSelection} disabled={bulkSaving}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
          marginTop: 8,
        }}
      >
        {items.map((item) => {
          const overrideWorkflow = item.config?.workflowTemplateId
            ? workflows.find((w) => w.id === item.config?.workflowTemplateId)?.label
            : null;
          const defaultWorkflow = item.defaultWorkflowTemplateId
            ? workflows.find((w) => w.id === item.defaultWorkflowTemplateId)?.label
            : null;
          const hasOverride = !!item.config;

          return (
            <div
              key={item.id}
              className="card"
              style={{
                padding: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                outline: selectedIds.includes(item.id)
                  ? '2px solid var(--accent)'
                  : hasOverride
                    ? '2px solid var(--pink)'
                    : undefined,
                opacity: item.isActive ? 1 : 0.55,
              }}
            >
              <div
                style={{
                  background: 'var(--surface2, #1a1a1a)',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  aspectRatio: '3/4',
                  position: 'relative',
                }}
              >
                <AssetThumb
                  thumbnailKey={item.thumbnailKey}
                  label={item.label}
                  storageBase={storagePublicUrl}
                  w={160}
                  h={210}
                />
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    width: 15,
                    height: 15,
                    cursor: 'pointer',
                    accentColor: 'var(--pink)',
                  }}
                />
              </div>
              <div style={{ padding: '8px 8px 10px' }}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={item.displayName ?? item.label}
                >
                  {item.displayName ?? item.label}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                  {overrideWorkflow ? (
                    <span
                      className="badge dot accent"
                      style={{ fontSize: 10 }}
                      title="Override workflow"
                    >
                      {overrideWorkflow}
                    </span>
                  ) : defaultWorkflow ? (
                    <span
                      className="badge"
                      style={{ fontSize: 10, opacity: 0.6 }}
                      title="Default workflow"
                    >
                      {defaultWorkflow}
                    </span>
                  ) : null}
                  {hasOverride && (
                    <span
                      className="badge dot"
                      style={{ fontSize: 10, background: 'var(--pink)', color: '#fff' }}
                    >
                      overridden
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 8,
                  }}
                >
                  <Switch
                    checked={item.isActive}
                    onChange={() => void onToggleActive(item.id, !item.isActive)}
                  />
                  <button
                    className="btn ghost"
                    style={{ fontSize: 10, padding: '3px 8px' }}
                    onClick={() => openEdit(item)}
                  >
                    <Icon.Edit /> Edit
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit override modal */}
      {editing && (
        <div className="modal-overlay" onClick={savingId === editing.id ? undefined : closeEdit}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(720px, calc(100vw - 80px))' }}
          >
            <div className="modal-head">
              <h3>{editing.displayName ?? editing.label} — Override</h3>
              <button
                className="btn sm ghost"
                onClick={closeEdit}
                disabled={savingId === editing.id}
                style={{ marginLeft: 'auto' }}
              >
                <Icon.Close />
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div className="field">
                <label>Workflow override</label>
                <select
                  className="select"
                  value={editWorkflow}
                  disabled={savingId === editing.id}
                  onChange={(e) => setEditWorkflow(e.target.value)}
                >
                  <option value="">
                    Use default (
                    {editing.defaultWorkflowTemplateId
                      ? (workflows.find((w) => w.id === editing.defaultWorkflowTemplateId)?.label ??
                        '?')
                      : 'none'}
                    )
                  </option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Positive prompt</label>
                <textarea
                  className="input"
                  rows={10}
                  placeholder="Inherited from pose"
                  value={editGarmentPrompt}
                  disabled={savingId === editing.id}
                  onChange={(e) => setEditGarmentPrompt(e.target.value)}
                  style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                />
              </div>
            </div>
            <div className="modal-foot">
              {editing.config && (
                <button
                  className="btn ghost"
                  disabled={savingId === editing.id}
                  style={{ marginRight: 'auto' }}
                  onClick={() =>
                    void onSave(sub.id, editing.id, {
                      workflowTemplateId: null,
                      promptGarmentPhase: null,
                      promptFacePhase: null,
                    }).then(closeEdit)
                  }
                >
                  Clear override
                </button>
              )}
              <button className="btn ghost" onClick={closeEdit} disabled={savingId === editing.id}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={savingId === editing.id}
                onClick={() => void doSave()}
              >
                {savingId === editing.id ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
