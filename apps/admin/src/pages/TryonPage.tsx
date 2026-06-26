import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type { TryonCategory, TryonSample, WorkflowOption } from '../types';

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

function toSnakeSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

interface Props {
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
}

export default function TryonPage({ toast }: Props) {
  const { storagePublicUrl } = useAuth();
  const [categories, setCategories] = useState<TryonCategory[]>([]);
  const [tryonWorkflows, setTryonWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formWorkflowId, setFormWorkflowId] = useState('');
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formSaving, setFormSaving] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);

  // Delete category confirm
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  // Sample upload state
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, wfs] = await Promise.all([
        apiFetch<TryonCategory[]>('/admin/tryon-categories'),
        apiFetch<WorkflowOption[]>('/admin/workflows'),
      ]);
      setCategories(cats);
      setTryonWorkflows(wfs.filter((w) => w.workflowType === 'tryon'));
    } catch {
      toast({ kind: 'error', title: 'Failed to load tryon categories' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openCreate = () => {
    setFormName('');
    setFormSlug('');
    setFormWorkflowId(tryonWorkflows[0]?.id ?? '');
    setFormSortOrder(categories.length);
    setFormIsActive(true);
    setSlugEdited(false);
    setEditingCategoryId(null);
    setModalMode('create');
  };

  const openEdit = (cat: TryonCategory) => {
    setFormName(cat.name);
    setFormSlug(cat.slug);
    setFormWorkflowId(cat.workflowTemplateId ?? '');
    setFormSortOrder(cat.sortOrder);
    setFormIsActive(cat.isActive);
    setSlugEdited(true);
    setEditingCategoryId(cat.id);
    setModalMode('edit');
  };

  const closeModal = () => {
    if (formSaving || uploadingFiles) return;
    setModalMode(null);
    setEditingCategoryId(null);
  };

  const handleNameChange = (value: string) => {
    setFormName(value);
    if (!slugEdited) {
      setFormSlug(toSnakeSlug(value));
    }
  };

  const handleSaveCategory = async () => {
    if (!formName.trim() || !formSlug.trim()) return;
    setFormSaving(true);
    try {
      if (modalMode === 'create') {
        const created = await apiFetch<TryonCategory>('/admin/tryon-categories', {
          method: 'POST',
          body: JSON.stringify({
            name: formName.trim(),
            slug: formSlug.trim(),
            workflowTemplateId: formWorkflowId || null,
            sortOrder: formSortOrder,
            isActive: formIsActive,
          }),
        });
        setCategories((prev) => [...prev, { ...created, samples: [] }]);
        toast({ title: `Category "${created.name}" created` });
        setModalMode(null);
        setEditingCategoryId(null);
      } else if (modalMode === 'edit' && editingCategoryId) {
        const updated = await apiFetch<TryonCategory>(
          `/admin/tryon-categories/${editingCategoryId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name: formName.trim(),
              workflowTemplateId: formWorkflowId || null,
              sortOrder: formSortOrder,
              isActive: formIsActive,
            }),
          },
        );
        setCategories((prev) =>
          prev.map((c) => (c.id === updated.id ? { ...updated, samples: c.samples } : c)),
        );
        toast({ title: `Category "${updated.name}" updated` });
        // Stay open so admin can manage samples
      }
    } catch (e) {
      toast({
        kind: 'error',
        title: modalMode === 'create' ? 'Failed to create category' : 'Failed to update category',
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    setDeleteConfirming(true);
    try {
      await apiFetch(`/admin/tryon-categories/${id}`, { method: 'DELETE' });
      setCategories((prev) => prev.filter((c) => c.id !== id));
      toast({ title: 'Category deleted' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to delete category',
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDeletingId(null);
      setDeleteConfirming(false);
    }
  };

  const handleSampleUpload = async (categoryId: string, files: FileList) => {
    setUploadingFiles(true);
    const fileArray = Array.from(files);
    let successCount = 0;
    const currentSamples = categories.find((c) => c.id === categoryId)?.samples ?? [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      try {
        const presign = await apiFetch<{
          r2Key: string;
          uploadUrl: string;
          thumbnailKey: string;
          thumbnailUploadUrl: string;
        }>(`/admin/tryon-categories/${categoryId}/samples/presign`, {
          method: 'POST',
          body: JSON.stringify({ contentType: file.type }),
        });

        const thumb = await makeThumbnail(file, 200);
        await Promise.all([
          putFile(presign.uploadUrl, file),
          putFile(presign.thumbnailUploadUrl, thumb),
        ]);

        const sample = await apiFetch<TryonSample>(
          `/admin/tryon-categories/${categoryId}/samples`,
          {
            method: 'POST',
            body: JSON.stringify({
              r2Key: presign.r2Key,
              thumbnailKey: presign.thumbnailKey,
              sortOrder: currentSamples.length + i,
            }),
          },
        );

        setCategories((prev) =>
          prev.map((c) => (c.id === categoryId ? { ...c, samples: [...c.samples, sample] } : c)),
        );
        successCount++;
      } catch (e) {
        toast({
          kind: 'error',
          title: `Failed to upload ${file.name}`,
          body: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (successCount > 0) {
      toast({ title: `${successCount} sample${successCount > 1 ? 's' : ''} uploaded` });
    }
    setUploadingFiles(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteSample = async (categoryId: string, sampleId: string) => {
    try {
      await apiFetch(`/admin/tryon-categories/${categoryId}/samples/${sampleId}`, {
        method: 'DELETE',
      });
      setCategories((prev) =>
        prev.map((c) =>
          c.id === categoryId ? { ...c, samples: c.samples.filter((s) => s.id !== sampleId) } : c,
        ),
      );
      toast({ title: 'Sample deleted' });
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to delete sample',
        body: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const deletingCategory = deletingId ? categories.find((c) => c.id === deletingId) : null;
  const modalSamples = editingCategoryId
    ? (categories.find((c) => c.id === editingCategoryId)?.samples ?? [])
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Tryon Categories</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Manage garment type categories and their sample images for try-on.
          </p>
        </div>
        <button className="btn primary" onClick={openCreate}>
          <Icon.Plus /> Add category
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div
          style={{ color: 'var(--muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}
        >
          Loading…
        </div>
      ) : categories.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: '48px 24px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: 13,
          }}
        >
          <p style={{ marginTop: 12 }}>
            No tryon categories yet. Add your first category to get started.
          </p>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={openCreate}>
            <Icon.Plus /> Add category
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {categories.map((cat) => {
            const wfLabel = tryonWorkflows.find((w) => w.id === cat.workflowTemplateId)?.label;
            return (
              <div
                key={cat.id}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  opacity: cat.isActive ? 1 : 0.6,
                }}
              >
                {/* Sample thumbnails strip */}
                <div
                  style={{
                    display: 'flex',
                    gap: 4,
                    padding: 8,
                    background: 'var(--bg-2, var(--surface-2))',
                    minHeight: 80,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  {cat.samples.length === 0 ? (
                    <div
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--muted)',
                        fontSize: 12,
                        gap: 6,
                      }}
                    >
                      <Icon.Image /> No samples
                    </div>
                  ) : (
                    <>
                      {cat.samples.slice(0, 5).map((s) =>
                        storagePublicUrl ? (
                          // biome-ignore lint/performance/noImgElement: admin panel thumbnail
                          <img
                            key={s.id}
                            src={`${storagePublicUrl}/${s.thumbnailKey ?? s.r2Key}`}
                            alt=""
                            style={{
                              width: 56,
                              height: 72,
                              objectFit: 'cover',
                              borderRadius: 4,
                              border: '1px solid var(--border)',
                            }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : null,
                      )}
                      {cat.samples.length > 5 && (
                        <div
                          style={{
                            width: 56,
                            height: 72,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'var(--subtle)',
                            borderRadius: 4,
                            border: '1px solid var(--border)',
                            fontSize: 11,
                            color: 'var(--muted)',
                            flexShrink: 0,
                          }}
                        >
                          +{cat.samples.length - 5}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Card info */}
                <div
                  style={{
                    padding: '10px 12px 12px',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cat.name}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 7px',
                        borderRadius: 10,
                        background: cat.isActive
                          ? 'var(--success-soft, rgba(76,175,80,0.12))'
                          : 'var(--bg-2)',
                        color: cat.isActive ? 'var(--success, #4caf50)' : 'var(--muted)',
                        flexShrink: 0,
                      }}
                    >
                      {cat.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <span>#{cat.sortOrder}</span>
                    <code
                      style={{
                        fontSize: 10,
                        background: 'var(--bg-2)',
                        padding: '1px 5px',
                        borderRadius: 3,
                      }}
                    >
                      {cat.slug}
                    </code>
                    {wfLabel && (
                      <span style={{ color: 'var(--accent, #6366f1)', fontSize: 11 }}>
                        {wfLabel}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {cat.samples.length} sample{cat.samples.length !== 1 ? 's' : ''}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button className="btn sm ghost" onClick={() => openEdit(cat)}>
                      <Icon.Edit /> Edit
                    </button>
                    <button
                      className="btn sm ghost"
                      style={{ color: 'var(--danger)', marginLeft: 'auto' }}
                      onClick={() => setDeletingId(cat.id)}
                      title="Delete category"
                    >
                      <Icon.Trash />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit modal */}
      {modalMode && (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(520px, calc(100vw - 40px))' }}
          >
            <div className="modal-head">
              <h3>
                {modalMode === 'create'
                  ? 'Add category'
                  : `Edit: ${categories.find((c) => c.id === editingCategoryId)?.name ?? ''}`}
              </h3>
              <button
                className="btn sm ghost"
                onClick={closeModal}
                disabled={formSaving || uploadingFiles}
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
              {/* Name */}
              <div className="field">
                <label>Name</label>
                <input
                  className="input"
                  value={formName}
                  disabled={formSaving}
                  placeholder="e.g. Upper Body"
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>

              {/* Slug */}
              <div className="field">
                <label>
                  Slug{' '}
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                    (auto-derived, editable)
                  </span>
                </label>
                <input
                  className="input"
                  value={formSlug}
                  disabled={formSaving || modalMode === 'edit'}
                  placeholder="snake_case"
                  onChange={(e) => {
                    setSlugEdited(true);
                    setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                  }}
                />
              </div>

              {/* Workflow */}
              <div className="field">
                <label>Workflow template</label>
                <select
                  className="select"
                  value={formWorkflowId}
                  disabled={formSaving}
                  onChange={(e) => setFormWorkflowId(e.target.value)}
                >
                  <option value="">— none —</option>
                  {tryonWorkflows.map((wf) => (
                    <option key={wf.id} value={wf.id}>
                      {wf.label}
                      {!wf.isActive ? ' (inactive)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sort order */}
              <div className="field">
                <label>
                  Sort order{' '}
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                    (lower = first)
                  </span>
                </label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={1}
                  value={formSortOrder}
                  disabled={formSaving}
                  onChange={(e) => setFormSortOrder(Number(e.target.value))}
                  style={{ width: 120 }}
                />
              </div>

              {/* Active */}
              <div
                className="field"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <input
                  type="checkbox"
                  id="cat-is-active"
                  checked={formIsActive}
                  disabled={formSaving}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  style={{
                    accentColor: 'var(--pink, #ec4899)',
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                  }}
                />
                <label htmlFor="cat-is-active" style={{ margin: 0, cursor: 'pointer' }}>
                  Active
                </label>
              </div>

              {/* Sample uploader — edit mode only */}
              {modalMode === 'edit' && editingCategoryId && (
                <>
                  <hr
                    style={{
                      border: 'none',
                      borderTop: '1px solid var(--border)',
                      margin: '4px 0',
                    }}
                  />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                      Sample images{' '}
                      <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                        ({modalSamples.length} uploaded)
                      </span>
                    </div>

                    {/* Upload input */}
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        border: '1.5px dashed var(--border)',
                        borderRadius: 8,
                        cursor: uploadingFiles || formSaving ? 'not-allowed' : 'pointer',
                        opacity: uploadingFiles || formSaving ? 0.6 : 1,
                        background: 'var(--surface-2)',
                        fontSize: 12,
                        color: 'var(--muted)',
                        userSelect: 'none',
                      }}
                    >
                      <Icon.Image />
                      {uploadingFiles ? 'Uploading…' : 'Choose image files to upload'}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        disabled={uploadingFiles || formSaving}
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          if (e.target.files && e.target.files.length > 0) {
                            void handleSampleUpload(editingCategoryId, e.target.files);
                          }
                        }}
                      />
                    </label>

                    {/* Existing samples */}
                    {modalSamples.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                        {modalSamples.map((s) => (
                          <div key={s.id} style={{ position: 'relative', display: 'inline-block' }}>
                            {storagePublicUrl && (
                              // biome-ignore lint/performance/noImgElement: admin panel thumbnail
                              <img
                                src={`${storagePublicUrl}/${s.thumbnailKey ?? s.r2Key}`}
                                alt=""
                                style={{
                                  width: 72,
                                  height: 90,
                                  objectFit: 'cover',
                                  borderRadius: 5,
                                  border: '1px solid var(--border)',
                                  display: 'block',
                                }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDeleteSample(editingCategoryId, s.id)}
                              disabled={formSaving || uploadingFiles}
                              title="Delete sample"
                              style={{
                                position: 'absolute',
                                top: 2,
                                right: 2,
                                background: 'var(--danger)',
                                color: 'var(--white, #fff)',
                                border: 'none',
                                borderRadius: '50%',
                                width: 18,
                                height: 18,
                                cursor: formSaving || uploadingFiles ? 'not-allowed' : 'pointer',
                                fontSize: 9,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 0,
                                lineHeight: 1,
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={closeModal}
                disabled={formSaving || uploadingFiles}
              >
                {modalMode === 'edit' ? 'Close' : 'Cancel'}
              </button>
              <button
                className="btn primary"
                disabled={formSaving || !formName.trim() || !formSlug.trim()}
                onClick={() => void handleSaveCategory()}
              >
                {formSaving ? 'Saving…' : modalMode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletingId && deletingCategory && (
        <div
          className="modal-overlay"
          onClick={deleteConfirming ? undefined : () => setDeletingId(null)}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(400px, calc(100vw - 40px))' }}
          >
            <div className="modal-head">
              <h3>Delete category</h3>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0 }}>
                Delete <strong>"{deletingCategory.name}"</strong>? This will permanently remove the
                category and all its samples. This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setDeletingId(null)}
                disabled={deleteConfirming}
              >
                Cancel
              </button>
              <button
                className="btn danger"
                disabled={deleteConfirming}
                onClick={() => void handleDeleteCategory(deletingId)}
              >
                {deleteConfirming ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
