import { useEffect, useRef, useState } from 'react';
import { BatchCatalogUploadModal } from '../components/BatchCatalogUploadModal';
import { Icon } from '../components/Icons';
import { Pager } from '../components/Pager';
import { Switch } from '../components/Switch';
import type { SortDir } from '../components/Th';
import { Th } from '../components/Th';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type { CatalogItem, GarmentType } from '../types';

async function uploadFile(url: string, file: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(file);
  });
}

const PAGE_SIZE = 25;

type Tab = 'all' | 'lower' | 'shoe';
const TABS: { k: Tab; l: string }[] = [
  { k: 'all', l: 'All items' },
  { k: 'lower', l: 'Lower garments' },
  { k: 'shoe', l: 'Shoes' },
];

interface CategoryRow {
  id: number;
  label: string;
  typeSlug: string;
}

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function CatalogPage({ onNav: _onNav, toast }: Props) {
  const { storagePublicUrl } = useAuth();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<keyof CatalogItem>('sortOrder');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<CatalogItem | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editSortOrder, setEditSortOrder] = useState(0);
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editReplaceFile, setEditReplaceFile] = useState<File | null>(null);
  const [editReplacePreview, setEditReplacePreview] = useState<string | null>(null);
  const [editReplaceUploading, setEditReplaceUploading] = useState(false);
  const replaceFileRef = useRef<HTMLInputElement>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(false);
  const [garmentTypes, setGarmentTypes] = useState<GarmentType[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<CatalogItem[]>('/admin/catalog/items'),
      apiFetch<CategoryRow[]>('/admin/catalog/categories'),
      apiFetch<{ items: GarmentType[] }>('/admin/assets/garment-types'),
    ])
      .then(([itemsRes, catsRes, gtRes]) => {
        setItems(itemsRes);
        setCategories(catsRes);
        setGarmentTypes(gtRes.items);
      })
      .catch(() => {
        toast({ kind: 'error', title: 'Failed to load catalog' });
      })
      .finally(() => setLoading(false));
  }, [toast]);

  const filtered = items.filter((c) => {
    if (tab !== 'all' && c.type !== tab) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortKey] ?? '';
    const bVal = b[sortKey] ?? '';
    let cmp: number;
    if (typeof aVal === 'boolean') {
      cmp = Number(bVal as boolean) - Number(aVal);
    } else if (typeof aVal === 'string') {
      cmp = aVal.localeCompare(bVal as string);
    } else {
      cmp = (aVal as number) - (bVal as number);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (k: keyof CatalogItem) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('asc');
    }
  };

  const toggleActive = async (id: string) => {
    const item = items.find((c) => c.id === id);
    if (!item) return;
    const next = !item.isActive;
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, isActive: next } : c)));
    try {
      await apiFetch(`/admin/catalog/items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      toast({ title: `${item.label} ${item.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setItems((prev) => prev.map((c) => (c.id === id ? { ...c, isActive: item.isActive } : c)));
      toast({ kind: 'error', title: 'Failed to update item' });
    }
  };

  const openEdit = (item: CatalogItem) => {
    setEditItem(item);
    setEditLabel(item.label);
    setEditSortOrder(item.sortOrder);
    setEditReplaceFile(null);
    setEditReplacePreview(null);
    const cat = categories.find(
      (c) => (item as any).categoryId === c.id || c.typeSlug === item.type,
    );
    setEditCategoryId(cat ? String(cat.id) : '');
  };

  const handleReplaceFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditReplaceFile(file);
    setEditReplacePreview(URL.createObjectURL(file));
  };

  const doReplaceImage = async () => {
    if (!editItem || !editReplaceFile) return;
    setEditReplaceUploading(true);
    try {
      const presign = await apiFetch<{
        uploadUrl: string;
        r2Key: string;
        thumbnailUploadUrl: string;
        thumbnailKey: string;
      }>('/admin/catalog/items/presign', {
        method: 'POST',
        body: JSON.stringify({ typeSlug: editItem.type, contentType: editReplaceFile.type }),
      });
      await Promise.all([
        uploadFile(presign.uploadUrl, editReplaceFile),
        makeThumbnail(editReplaceFile).then((t) => uploadFile(presign.thumbnailUploadUrl, t)),
      ]);
      await apiFetch(`/admin/catalog/items/${editItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          r2Key: presign.r2Key,
          thumbnailKey: presign.thumbnailKey,
          isActive: true,
        }),
      });
      setItems((prev) =>
        prev.map((c) =>
          c.id === editItem.id
            ? { ...c, r2Key: presign.r2Key, thumbnailKey: presign.thumbnailKey, isActive: true }
            : c,
        ),
      );
      setEditItem((prev) =>
        prev
          ? { ...prev, r2Key: presign.r2Key, thumbnailKey: presign.thumbnailKey, isActive: true }
          : prev,
      );
      setEditReplaceFile(null);
      setEditReplacePreview(null);
      toast({ title: 'Image replaced' });
    } catch {
      toast({ kind: 'error', title: 'Image replace failed' });
    } finally {
      setEditReplaceUploading(false);
    }
  };

  const saveEdit = async () => {
    if (!editItem) return;
    setEditSaving(true);
    try {
      await apiFetch(`/admin/catalog/items/${editItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          label: editLabel.trim() || editItem.label,
          sortOrder: editSortOrder,
          ...(editCategoryId ? { categoryId: Number(editCategoryId) } : {}),
        }),
      });
      setItems((prev) =>
        prev.map((c) =>
          c.id === editItem.id
            ? { ...c, label: editLabel.trim() || c.label, sortOrder: editSortOrder }
            : c,
        ),
      );
      toast({ title: `${editLabel || editItem.label} updated` });
      setEditItem(null);
    } catch {
      toast({ kind: 'error', title: 'Failed to save changes' });
    } finally {
      setEditSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const item = items.find((c) => c.id === confirmDelete);
    setConfirmDelete(null);
    try {
      await apiFetch(`/admin/catalog/items/${confirmDelete}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((c) => c.id !== confirmDelete));
      toast({ title: `${item?.label ?? confirmDelete} deleted` });
    } catch {
      toast({ kind: 'error', title: 'Failed to delete item' });
    }
  };

  const lowerCount = items.filter((c) => c.type === 'lower').length;
  const shoeCount = items.filter((c) => c.type === 'shoe').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Catalog</h1>
          <p className="lede">
            {lowerCount} lower garments · {shoeCount} shoes — optional add-ons shown when pose
            permits.
          </p>
        </div>
        <div className="head-tools">
          <div className="search">
            <Icon.Search />
            <input
              placeholder="Search by label or ID…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </div>
          {tab !== 'all' && (
            <button className="btn" onClick={() => setShowUpload(true)}>
              <Icon.Add /> Add item
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.k}
            className={`tab ${tab === t.k ? 'active' : ''}`}
            onClick={() => {
              setTab(t.k);
              setPage(0);
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>Loading…</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <Th k="label" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                  Label
                </Th>
                <Th k="type" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                  Type
                </Th>
                <Th k="sortOrder" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                  Order
                </Th>
                <Th k="isActive" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                  Active
                </Th>
                <Th k="updatedAt" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                  Updated
                </Th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {storagePublicUrl && c.thumbnailKey ? (
                        <img
                          src={`${storagePublicUrl}/${c.thumbnailKey}`}
                          alt={c.label}
                          style={{
                            width: 40,
                            height: 40,
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
                            width: 40,
                            height: 40,
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
                      <div>
                        <span className="semi">{c.label}</span>
                        <span className="sub mono" style={{ display: 'block' }}>
                          {c.id}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge dot ${c.type === 'lower' ? 'accent' : 'warn'}`}>
                      {c.type === 'lower' ? 'Lower' : 'Shoe'}
                    </span>
                  </td>
                  <td>
                    <span className="mono">{c.sortOrder}</span>
                  </td>
                  <td>
                    <Switch checked={c.isActive} onChange={() => toggleActive(c.id)} />
                  </td>
                  <td>
                    <span className="mono">{c.updatedAt.slice(0, 10)}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn sm ghost" onClick={() => openEdit(c)}>
                        <Icon.Edit />
                      </button>
                      <button className="btn sm ghost" onClick={() => setConfirmDelete(c.id)}>
                        <Icon.Trash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}
                  >
                    No items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Pager
        page={page}
        totalPages={totalPages}
        onPage={setPage}
        totalItems={sorted.length}
        pageSize={PAGE_SIZE}
      />

      {editItem && (
        <div className="modal-overlay" onClick={editSaving ? undefined : () => setEditItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Edit catalog item</h3>
              <button
                className="btn sm ghost"
                onClick={() => setEditItem(null)}
                disabled={editSaving}
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
                  value={editLabel}
                  disabled={editSaving}
                  onChange={(e) => setEditLabel(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Gender category</label>
                <select
                  className="select"
                  value={editCategoryId}
                  disabled={editSaving}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                >
                  {categories
                    .filter((c) => c.typeSlug === editItem.type)
                    .map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.label}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Sort order</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={editSortOrder}
                  disabled={editSaving}
                  onChange={(e) => setEditSortOrder(Number(e.target.value))}
                  style={{ width: 100 }}
                />
              </div>
              <div className="field">
                <label>Replace image</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {(editReplacePreview ??
                    (storagePublicUrl && editItem.thumbnailKey
                      ? `${storagePublicUrl}/${editItem.thumbnailKey}`
                      : null)) && (
                    <img
                      src={editReplacePreview ?? `${storagePublicUrl}/${editItem.thumbnailKey}`}
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
                      ref={replaceFileRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handleReplaceFilePick}
                    />
                    <button
                      type="button"
                      className="btn sm ghost"
                      disabled={editSaving || editReplaceUploading}
                      onClick={() => replaceFileRef.current?.click()}
                    >
                      <Icon.Image /> {editReplaceFile ? editReplaceFile.name : 'Pick new image'}
                    </button>
                    {editReplaceFile && (
                      <button
                        type="button"
                        className="btn sm primary"
                        disabled={editReplaceUploading}
                        onClick={doReplaceImage}
                      >
                        {editReplaceUploading ? 'Uploading…' : 'Upload & replace'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setEditItem(null)} disabled={editSaving}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={saveEdit}
                disabled={editSaving || !editLabel.trim()}
              >
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete catalog item</h3>
            </div>
            <div className="modal-body">
              <p>
                Delete{' '}
                <strong>{items.find((c) => c.id === confirmDelete)?.label ?? confirmDelete}</strong>
                ? This cannot be undone.
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

      {showUpload && (
        <BatchCatalogUploadModal
          typeSlug={tab === 'shoe' ? 'shoe' : 'lower'}
          garmentTypes={garmentTypes}
          onDone={(added) => {
            setShowUpload(false);
            setItems((prev) => [...prev, ...(added as any)]);
            apiFetch<CatalogItem[]>('/admin/catalog/items')
              .then(setItems)
              .catch(() => {
                toast({ kind: 'error', title: 'Items added but failed to refresh list' });
              });
          }}
          onClose={() => setShowUpload(false)}
          toast={toast}
        />
      )}
    </>
  );
}
