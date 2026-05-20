import { useState } from 'react';
import type { CatalogItem } from '../types';
import { MOCK_CATALOG } from '../lib/data';
import { Icon } from '../components/Icons';
import { Pager } from '../components/Pager';
import { Th } from '../components/Th';
import type { SortDir } from '../components/Th';
import { Switch } from '../components/Switch';

const PAGE_SIZE = 25;

type Tab = 'all' | 'lower' | 'shoe';
const TABS: { k: Tab; l: string }[] = [
  { k: 'all', l: 'All items' },
  { k: 'lower', l: 'Lower garments' },
  { k: 'shoe', l: 'Shoes' },
];

interface Props {
  onNav: (_page: string, _filter?: { page: string; filter?: string }) => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

export default function CatalogPage({ onNav: _onNav, toast }: Props) {
  const [items, setItems] = useState<CatalogItem[]>(MOCK_CATALOG);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<keyof CatalogItem>('sortOrder');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = items.filter((c) => {
    if (tab !== 'all' && c.type !== tab) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortKey] ?? '';
    const bVal = b[sortKey] ?? '';
    const cmp = typeof aVal === 'string'
      ? aVal.localeCompare(bVal as string)
      : (aVal as number) - (bVal as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (k: keyof CatalogItem) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };

  const toggleActive = (id: string) => {
    const item = items.find((c) => c.id === id);
    setItems((prev) => prev.map((c) => c.id === id ? { ...c, isActive: !c.isActive } : c));
    if (item) toast({ title: `${item.label} ${item.isActive ? 'activated' : 'deactivated'}` });
  };

  const doDelete = () => {
    const item = items.find((c) => c.id === confirmDelete);
    setItems((prev) => prev.filter((c) => c.id !== confirmDelete));
    toast({ title: `${item?.label ?? confirmDelete} deleted` });
    setConfirmDelete(null);
  };

  const lowerCount = items.filter((c) => c.type === 'lower').length;
  const shoeCount = items.filter((c) => c.type === 'shoe').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Catalog</h1>
          <p className="lede">{lowerCount} lower garments · {shoeCount} shoes — optional add-ons shown when pose permits.</p>
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
          <button className="btn"><Icon.Add /> Add item</button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.k}
            className={`tab ${tab === t.k ? 'active' : ''}`}
            onClick={() => { setTab(t.k); setPage(0); }}
          >
            {t.l}
          </button>
        ))}
      </div>

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
                    <div style={{
                      width: 40, height: 40, borderRadius: 6,
                      background: 'var(--subtle)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Icon.Image />
                    </div>
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
                <td>
                  <Switch checked={c.isActive} onChange={() => toggleActive(c.id)} />
                </td>
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
    </>
  );
}
