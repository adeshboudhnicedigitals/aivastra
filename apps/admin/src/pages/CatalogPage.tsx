import { useState, useEffect } from 'react';
import type { CatalogItem } from '../types';
import { apiFetch } from '../lib/data';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icons';
import { Pager } from '../components/Pager';
import { Th } from '../components/Th';
import type { SortDir } from '../components/Th';
import { Switch } from '../components/Switch';
import { UploadModal } from '../components/UploadModal';
import type { FieldDef } from '../components/UploadModal';

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
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch<CatalogItem[]>('/admin/catalog/items'),
      apiFetch<CategoryRow[]>('/admin/catalog/categories'),
    ]).then(([itemsRes, catsRes]) => {
      setItems(itemsRes);
      setCategories(catsRes);
    }).catch(() => {
      toast({ kind: 'error', title: 'Failed to load catalog' });
    }).finally(() => setLoading(false));
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
    else { setSortKey(k); setSortDir('asc'); }
  };

  const toggleActive = async (id: string) => {
    const item = items.find((c) => c.id === id);
    if (!item) return;
    const next = !item.isActive;
    setItems((prev) => prev.map((c) => c.id === id ? { ...c, isActive: next } : c));
    try {
      await apiFetch(`/admin/catalog/items/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
      toast({ title: `${item.label} ${item.isActive ? 'deactivated' : 'activated'}` });
    } catch {
      setItems((prev) => prev.map((c) => c.id === id ? { ...c, isActive: item.isActive } : c));
      toast({ kind: 'error', title: 'Failed to update item' });
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

  const uploadFields: FieldDef[] = [
    { type: 'text', name: 'label', label: 'Label', required: true },
    {
      type: 'select',
      name: 'categoryId',
      label: 'Category (gender)',
      options: categories
        .filter((c) => tab === 'all' || c.typeSlug === tab)
        .map((c) => ({
          value: String(c.id),
          label: tab === 'all' ? `[${c.typeSlug}] ${c.label}` : c.label,
        })),
    },
    { type: 'number', name: 'sortOrder', label: 'Sort order', min: 0, defaultValue: 0 },
  ];

  const lowerCount = items.filter((c) => c.type === 'lower').length;
  const shoeCount = items.filter((c) => c.type === 'shoe').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Catalog</h1>
          <p className="lede">
            {lowerCount} lower garments · {shoeCount} shoes — optional add-ons shown when pose permits.
          </p>
        </div>
        <div className="head-tools">
          <div className="search">
            <Icon.Search />
            <input
              placeholder="Search by label or ID…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            />
          </div>
          <button className="btn" onClick={() => setShowUpload(true)}><Icon.Add /> Add item</button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.k} className={`tab ${tab === t.k ? 'active' : ''}`} onClick={() => { setTab(t.k); setPage(0); }}>
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
                <Th k="label" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Label</Th>
                <Th k="type" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Type</Th>
                <Th k="sortOrder" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Order</Th>
                <Th k="isActive" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Active</Th>
                <Th k="updatedAt" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Updated</Th>
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
                          style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Icon.Image />
                        </div>
                      )}
                      <div>
                        <span className="semi">{c.label}</span>
                        <span className="sub mono" style={{ display: 'block' }}>{c.id}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge dot ${c.type === 'lower' ? 'accent' : 'warn'}`}>
                      {c.type === 'lower' ? 'Lower' : 'Shoe'}
                    </span>
                  </td>
                  <td><span className="mono">{c.sortOrder}</span></td>
                  <td><Switch checked={c.isActive} onChange={() => toggleActive(c.id)} /></td>
                  <td><span className="mono">{c.updatedAt.slice(0, 10)}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn sm ghost"><Icon.Edit /></button>
                      <button className="btn sm ghost" onClick={() => setConfirmDelete(c.id)}><Icon.Trash /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>No items found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={page} totalPages={totalPages} onPage={setPage} totalItems={sorted.length} pageSize={PAGE_SIZE} />

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>Delete catalog item</h3></div>
            <div className="modal-body">
              <p>Delete <strong>{items.find((c) => c.id === confirmDelete)?.label ?? confirmDelete}</strong>? This cannot be undone.</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn danger" onClick={doDelete}><Icon.Trash /> Delete</button>
            </div>
          </div>
        </div>
      )}

      {showUpload && (
        categories.length === 0 ? (
          <div className="modal-overlay" onClick={() => setShowUpload(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head"><h3>No categories found</h3></div>
              <div className="modal-body">
                <p>Run <code>pnpm db:migrate</code> to seed the lower &amp; shoe categories, then reload.</p>
              </div>
              <div className="modal-foot">
                <button className="btn ghost" onClick={() => setShowUpload(false)}>Close</button>
              </div>
            </div>
          </div>
        ) : (
          <UploadModal
            title="Add catalog item"
            presignPath="/admin/catalog/items/presign"
            confirmPath="/admin/catalog/items/confirm"
            fields={uploadFields}
            onDone={() => {
              setShowUpload(false);
              apiFetch<CatalogItem[]>('/admin/catalog/items').then(setItems).catch(() => {
                toast({ kind: 'error', title: 'Item added but failed to refresh list' });
              });
            }}
            onClose={() => setShowUpload(false)}
            toast={toast}
          />
        )
      )}
    </>
  );
}
