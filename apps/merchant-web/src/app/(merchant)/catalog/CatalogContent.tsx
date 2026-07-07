'use client';

import { Search } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';

type MerchantCatalogGender = 'men' | 'women' | 'boy' | 'girl';

type MerchantCatalogItem = {
  id: string;
  label: string;
  sku: string | null;
  gender: MerchantCatalogGender | null;
  category: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  sourceJobId: string | null;
  sourceKind: 'imported' | 'uploaded';
  isActive: boolean;
  moderationStatus: 'approved' | 'rejected';
  moderationNote: string | null;
  createdAt: string;
  updatedAt: string;
};

type Draft = {
  label: string;
  sku: string;
  gender: MerchantCatalogGender | '';
  category: string;
  isActive: boolean;
};

type UploadState = {
  label: string;
  sku: string;
  gender: MerchantCatalogGender | '';
  category: string;
  file: File | null;
};

const GENDER_OPTIONS: Array<{ value: MerchantCatalogGender; label: string }> = [
  { value: 'men', label: 'Men' },
  { value: 'women', label: 'Women' },
  { value: 'boy', label: 'Boy' },
  { value: 'girl', label: 'Girl' },
];

function createDraft(item: MerchantCatalogItem): Draft {
  return {
    label: item.label,
    sku: item.sku ?? '',
    gender: item.gender ?? '',
    category: item.category ?? '',
    isActive: item.isActive,
  };
}

async function createThumbnail(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read the selected image.'));
      img.src = objectUrl;
    });

    const maxEdge = 720;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable in this browser.');
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.9);
    });
    if (!blob) throw new Error('Could not generate a thumbnail.');
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function CatalogContent() {
  const [items, setItems] = useState<MerchantCatalogItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({
    label: '',
    sku: '',
    gender: '',
    category: '',
    file: null,
  });

  async function load(query = '') {
    setLoading(true);
    setError('');
    try {
      const qs = query.trim() ? `?search=${encodeURIComponent(query.trim())}` : '';
      const res = await fetch(`/api/merchant/catalog${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load catalog items.');
      const body = (await res.json()) as { items?: MerchantCatalogItem[] };
      const nextItems = body.items ?? [];
      setItems(nextItems);
      setDrafts(Object.fromEntries(nextItems.map((item) => [item.id, createDraft(item)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog items.');
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load only closes over stable setState setters; run once on mount
  useEffect(() => {
    void load();
  }, []);

  const activeCount = useMemo(() => items.filter((item) => item.isActive).length, [items]);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((current) => {
      const existing = current[id];
      if (!existing) return current;
      return {
        ...current,
        [id]: { ...existing, ...patch },
      };
    });
  }

  async function saveItem(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setError('');
    try {
      const res = await fetch(`/api/merchant/catalog/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: draft.label,
          sku: draft.sku.trim() || null,
          gender: draft.gender || null,
          category: draft.category.trim() || null,
          isActive: draft.isActive,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Failed to save catalog item.');
      }
      const item = (await res.json()) as MerchantCatalogItem;
      setItems((current) => current.map((entry) => (entry.id === id ? item : entry)));
      setDrafts((current) => ({ ...current, [id]: createDraft(item) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save catalog item.');
    } finally {
      setSavingId(null);
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<MerchantCatalogItem | null>(null);

  async function removeItem(item: MerchantCatalogItem) {
    setDeleteTarget(item);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeletingId(id);
    setError('');
    try {
      const res = await fetch(`/api/merchant/catalog/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Failed to delete catalog item.');
      }
      setItems((current) => current.filter((item) => item.id !== id));
      setDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete catalog item.');
    } finally {
      setDeletingId(null);
    }
  }

  async function uploadDirectItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadState.file) {
      setError('Select an image before uploading.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const assetId = crypto.randomUUID();
      const file = uploadState.file;
      const thumbnail = await createThumbnail(file);

      const [imagePresignRes, thumbPresignRes] = await Promise.all([
        fetch('/api/merchant/catalog/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetId,
            kind: 'image',
            contentType: file.type,
            contentLength: file.size,
          }),
        }),
        fetch('/api/merchant/catalog/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetId,
            kind: 'thumbnail',
            contentType: thumbnail.type || 'image/webp',
            contentLength: thumbnail.size,
          }),
        }),
      ]);

      if (!imagePresignRes.ok || !thumbPresignRes.ok) {
        throw new Error('Failed to create upload URLs.');
      }

      const imagePresign = (await imagePresignRes.json()) as { uploadUrl: string; r2Key: string };
      const thumbPresign = (await thumbPresignRes.json()) as { uploadUrl: string; r2Key: string };

      const [imageUpload, thumbUpload] = await Promise.all([
        fetch(imagePresign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        }),
        fetch(thumbPresign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': thumbnail.type || 'image/webp' },
          body: thumbnail,
        }),
      ]);

      if (!imageUpload.ok || !thumbUpload.ok) {
        throw new Error('Upload failed before the catalog item could be created.');
      }

      const createRes = await fetch('/api/merchant/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: uploadState.label.trim(),
          sku: uploadState.sku.trim() || null,
          gender: uploadState.gender || null,
          category: uploadState.category.trim() || null,
          r2Key: imagePresign.r2Key,
          thumbnailKey: thumbPresign.r2Key,
        }),
      });
      if (!createRes.ok) {
        const body = (await createRes.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Failed to create catalog item.');
      }

      const item = (await createRes.json()) as MerchantCatalogItem;
      setItems((current) => [item, ...current]);
      setDrafts((current) => ({ ...current, [item.id]: createDraft(item) }));
      setUploadState({ label: '', sku: '', gender: '', category: '', file: null });
      const form = event.currentTarget;
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload catalog item.');
    } finally {
      setUploading(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setUploadState((current) => ({ ...current, file }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            color: 'hsl(var(--text-primary))',
            letterSpacing: '-0.02em',
            margin: '0 0 var(--space-2)',
          }}
        >
          Kiosk Catalog
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', margin: 0 }}>
          Upload private items directly, classify imported studio output, and control what kiosks
          can show.
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'hsl(var(--danger-subtle))',
            color: 'hsl(var(--danger-base))',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      <div className="grid-responsive-2" style={{ alignItems: 'start' }}>
        <Card>
          <CardHeader
            style={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 'var(--space-4)',
            }}
          >
            <div>
              <CardTitle>Catalog Items</CardTitle>
              <CardDescription>
                {activeCount} active of {items.length} total items
              </CardDescription>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void load(search);
              }}
              style={{ display: 'flex', gap: 'var(--space-2)' }}
            >
              <div style={{ position: 'relative' }}>
                <Search
                  size={16}
                  color="hsl(var(--text-tertiary))"
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                  }}
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search label..."
                  style={{ paddingLeft: 34, minWidth: 200 }}
                  sizeVariant="sm"
                />
              </div>
              <Button type="submit" variant="secondary" size="sm">
                Search
              </Button>
            </form>
          </CardHeader>

          <CardContent>
            {loading ? (
              <div style={{ fontSize: '0.875rem', color: 'hsl(var(--text-tertiary))' }}>
                Loading catalog items...
              </div>
            ) : items.length === 0 ? (
              <div style={{ fontSize: '0.875rem', color: 'hsl(var(--text-tertiary))' }}>
                No kiosk catalog items yet. Upload one directly or publish from My Catalogues.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {items.map((item) => {
                  const draft = drafts[item.id] ?? createDraft(item);
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '140px minmax(0, 1fr)',
                        gap: 'var(--space-5)',
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid hsl(var(--border-default))',
                        background: 'hsl(var(--bg-surface-hover))',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            aspectRatio: '3 / 4',
                            borderRadius: 'var(--radius-md)',
                            overflow: 'hidden',
                            background: 'hsl(var(--bg-surface))',
                            border: '1px solid hsl(var(--border-subtle))',
                          }}
                        >
                          {item.thumbnailUrl && (
                            // biome-ignore lint/performance/noImgElement: presigned image preview
                            <img
                              src={item.thumbnailUrl}
                              alt={item.label}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          )}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: 'var(--space-1)',
                            marginTop: 'var(--space-2)',
                            flexWrap: 'wrap',
                          }}
                        >
                          <Badge variant={item.sourceKind === 'imported' ? 'primary' : 'success'}>
                            {item.sourceKind === 'imported' ? 'Imported' : 'Upload'}
                          </Badge>
                          <Badge variant={item.isActive ? 'success' : 'danger'}>
                            {item.isActive ? 'Active' : 'Hidden'}
                          </Badge>
                          <Badge
                            variant={item.moderationStatus === 'approved' ? 'success' : 'warning'}
                          >
                            {item.moderationStatus}
                          </Badge>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                            gap: 'var(--space-3)',
                            marginBottom: 'var(--space-4)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 'var(--space-1)',
                            }}
                          >
                            <label
                              htmlFor={`draft-label-${item.id}`}
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: 'hsl(var(--text-tertiary))',
                                textTransform: 'uppercase',
                              }}
                            >
                              Label
                            </label>
                            <Input
                              id={`draft-label-${item.id}`}
                              sizeVariant="sm"
                              value={draft.label}
                              onChange={(e) => updateDraft(item.id, { label: e.target.value })}
                            />
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 'var(--space-1)',
                            }}
                          >
                            <label
                              htmlFor={`draft-sku-${item.id}`}
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: 'hsl(var(--text-tertiary))',
                                textTransform: 'uppercase',
                              }}
                            >
                              SKU
                            </label>
                            <Input
                              id={`draft-sku-${item.id}`}
                              sizeVariant="sm"
                              value={draft.sku}
                              onChange={(e) => updateDraft(item.id, { sku: e.target.value })}
                            />
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 'var(--space-1)',
                            }}
                          >
                            <label
                              htmlFor={`draft-gender-${item.id}`}
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: 'hsl(var(--text-tertiary))',
                                textTransform: 'uppercase',
                              }}
                            >
                              Gender
                            </label>
                            <select
                              id={`draft-gender-${item.id}`}
                              value={draft.gender}
                              onChange={(e) =>
                                updateDraft(item.id, {
                                  gender: e.target.value as MerchantCatalogGender | '',
                                })
                              }
                              className="input input-sm"
                            >
                              <option value="">Unassigned</option>
                              {GENDER_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 'var(--space-1)',
                            }}
                          >
                            <label
                              htmlFor={`draft-category-${item.id}`}
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: 'hsl(var(--text-tertiary))',
                                textTransform: 'uppercase',
                              }}
                            >
                              Category
                            </label>
                            <Input
                              id={`draft-category-${item.id}`}
                              sizeVariant="sm"
                              value={draft.category}
                              onChange={(e) => updateDraft(item.id, { category: e.target.value })}
                            />
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 'var(--space-3)',
                            flexWrap: 'wrap',
                            marginTop: 'auto',
                          }}
                        >
                          <label
                            className="focus-ring"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 'var(--space-2)',
                              fontSize: '0.875rem',
                              color: 'hsl(var(--text-secondary))',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={draft.isActive}
                              onChange={(e) => updateDraft(item.id, { isActive: e.target.checked })}
                              style={{
                                accentColor: 'hsl(var(--accent-primary))',
                                width: 16,
                                height: 16,
                              }}
                            />
                            Visible on kiosk
                          </label>
                          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <Button
                              size="sm"
                              onClick={() => void saveItem(item.id)}
                              disabled={savingId === item.id}
                            >
                              {savingId === item.id ? 'Saving...' : 'Save Changes'}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => void removeItem(item)}
                              disabled={deletingId === item.id}
                            >
                              {deletingId === item.id ? 'Deleting...' : 'Delete'}
                            </Button>
                          </div>
                        </div>

                        {item.moderationNote && (
                          <div
                            style={{
                              marginTop: 'var(--space-3)',
                              fontSize: '0.75rem',
                              color: 'hsl(var(--warning-base))',
                              background: 'hsl(var(--warning-subtle))',
                              padding: 'var(--space-2) var(--space-3)',
                              borderRadius: 'var(--radius-sm)',
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>Moderation note:</span>{' '}
                            {item.moderationNote}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Direct Upload</CardTitle>
            <CardDescription>
              Upload a product image directly. The portal will generate and upload the kiosk
              thumbnail client-side.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => void uploadDirectItem(event)}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <label
                  htmlFor="upload-label"
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'hsl(var(--text-tertiary))',
                    textTransform: 'uppercase',
                  }}
                >
                  Label
                </label>
                <Input
                  id="upload-label"
                  required
                  value={uploadState.label}
                  onChange={(e) => setUploadState((c) => ({ ...c, label: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <label
                  htmlFor="upload-sku"
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'hsl(var(--text-tertiary))',
                    textTransform: 'uppercase',
                  }}
                >
                  SKU
                </label>
                <Input
                  id="upload-sku"
                  value={uploadState.sku}
                  onChange={(e) => setUploadState((c) => ({ ...c, sku: e.target.value }))}
                />
              </div>

              <div className="grid-responsive-equal-2">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <label
                    htmlFor="upload-gender"
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'hsl(var(--text-tertiary))',
                      textTransform: 'uppercase',
                    }}
                  >
                    Gender
                  </label>
                  <select
                    id="upload-gender"
                    className="input input-md"
                    value={uploadState.gender}
                    onChange={(e) =>
                      setUploadState((c) => ({
                        ...c,
                        gender: e.target.value as MerchantCatalogGender | '',
                      }))
                    }
                  >
                    <option value="">Unassigned</option>
                    {GENDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <label
                    htmlFor="upload-category"
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'hsl(var(--text-tertiary))',
                      textTransform: 'uppercase',
                    }}
                  >
                    Category
                  </label>
                  <Input
                    id="upload-category"
                    value={uploadState.category}
                    onChange={(e) => setUploadState((c) => ({ ...c, category: e.target.value }))}
                  />
                </div>
              </div>

              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-1)',
                  marginTop: 'var(--space-2)',
                }}
              >
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'hsl(var(--text-tertiary))',
                    textTransform: 'uppercase',
                  }}
                >
                  Product Image
                </span>
                <div style={{ position: 'relative' }}>
                  <input
                    required
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={onFileChange}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: 'var(--space-2)',
                      fontSize: '0.875rem',
                      border: '1px dashed hsl(var(--border-strong))',
                      borderRadius: 'var(--radius-md)',
                      background: 'hsl(var(--bg-surface-hover))',
                      cursor: 'pointer',
                    }}
                  />
                </div>
              </label>

              <div style={{ marginTop: 'var(--space-2)' }}>
                <Button
                  type="submit"
                  disabled={uploading || !uploadState.file}
                  style={{ width: '100%' }}
                >
                  {uploading ? 'Uploading...' : 'Upload to Kiosk Catalog'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Catalog Item"
        description="Are you sure you want to remove this item from your kiosk catalog? This action cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deletingId === deleteTarget?.id}
            >
              {deletingId === deleteTarget?.id ? 'Deleting...' : 'Delete Item'}
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            {deleteTarget.thumbnailUrl && (
              // biome-ignore lint/performance/noImgElement: presigned R2 URL
              <img
                src={deleteTarget.thumbnailUrl}
                alt=""
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 'var(--radius-md)',
                  objectFit: 'cover',
                }}
              />
            )}
            <div>
              <div style={{ fontWeight: 600, color: 'hsl(var(--text-primary))' }}>
                {deleteTarget.label}
              </div>
              {deleteTarget.sku && (
                <div style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-secondary))' }}>
                  SKU: {deleteTarget.sku}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
