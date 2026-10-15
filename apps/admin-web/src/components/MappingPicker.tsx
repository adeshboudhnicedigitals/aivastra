import { useMemo, useState } from 'react';
import { AssetThumb } from './AssetThumb';
import { Icon } from './Icons';

export interface MappingPickerItem {
  id: string;
  label: string;
  thumbnailUrl?: string | null;
  /** Optional secondary filter (e.g. continent) — the filter bar only renders when more than one group is present. */
  group?: string | null;
}

function MappingTile({
  item,
  isMapped,
  isBulkSelected,
  onToggleBulk,
  onToggleMapped,
}: {
  item: MappingPickerItem;
  isMapped: boolean;
  isBulkSelected: boolean;
  onToggleBulk: () => void;
  onToggleMapped: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <button
        type="button"
        onClick={onToggleMapped}
        title={item.label}
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          opacity: isMapped ? 1 : 0.45,
          transition: 'opacity 150ms ease',
        }}
      >
        <div
          style={{
            position: 'relative',
            borderRadius: 8,
            overflow: 'hidden',
            outline: '1px solid var(--border)',
            outlineOffset: -1,
          }}
        >
          <AssetThumb thumbnailUrl={item.thumbnailUrl} label={item.label} w={88} h={88} />
          <input
            type="checkbox"
            checked={isBulkSelected}
            onChange={onToggleBulk}
            onClick={(e) => e.stopPropagation()}
            title="Select for bulk action"
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              zIndex: 2,
              cursor: 'pointer',
              accentColor: 'var(--accent)',
            }}
          />
        </div>
        <span
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 4,
            display: 'block',
            maxWidth: 88,
          }}
        >
          {item.label}
        </span>
      </button>
      <button
        type="button"
        className={`btn xs ${isMapped ? 'ghost' : ''}`}
        style={{
          padding: '2px 4px',
          fontSize: 10,
          lineHeight: 1,
          color: isMapped ? 'var(--muted)' : undefined,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
        }}
        title={isMapped ? 'Unmap from this body type' : 'Map to this body type'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleMapped();
        }}
      >
        {isMapped ? (
          <>
            <Icon.Trash /> Unmap
          </>
        ) : (
          'Map'
        )}
      </button>
    </div>
  );
}

/**
 * Generic mapped/unmapped tile grid — search, status filter, an optional
 * secondary group filter (e.g. continent), bulk select, and bulk map/unmap.
 * Shared by the body-type detail view's garment-type/face/pose sections.
 */
export function MappingPicker({
  items,
  mappedIds,
  onToggleMapped,
  onBulkSetMapped,
  searchPlaceholder = 'Search…',
  groupAllLabel = 'All',
}: {
  items: MappingPickerItem[];
  mappedIds: Set<string>;
  onToggleMapped: (id: string) => void;
  onBulkSetMapped: (ids: string[], mapped: boolean) => void;
  searchPlaceholder?: string;
  groupAllLabel?: string;
}) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);

  const groups = useMemo(
    () => Array.from(new Set(items.map((i) => i.group || null).filter(Boolean) as string[])).sort(),
    [items],
  );

  const mappedCount = useMemo(
    () => items.filter((i) => mappedIds.has(i.id)).length,
    [items, mappedIds],
  );
  const unmappedCount = items.length - mappedCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      const isMapped = mappedIds.has(i.id);
      const matchesGroup = groupFilter === 'all' || (i.group || null) === groupFilter;
      const matchesSearch = !q || i.label.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === 'all' ? true : statusFilter === 'mapped' ? isMapped : !isMapped;
      return matchesGroup && matchesSearch && matchesStatus;
    });
  }, [items, groupFilter, search, statusFilter, mappedIds]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="search" style={{ width: 180 }}>
            <Icon.Search />
            <input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 2 }}>Show:</span>
            <button
              type="button"
              className={`badge ${statusFilter === 'all' ? 'accent' : ''}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setStatusFilter('all')}
            >
              All ({items.length})
            </button>
            <button
              type="button"
              className={`badge ${statusFilter === 'mapped' ? 'accent' : ''}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setStatusFilter('mapped')}
            >
              Mapped ({mappedCount})
            </button>
            <button
              type="button"
              className={`badge ${statusFilter === 'unmapped' ? 'accent' : ''}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setStatusFilter('unmapped')}
            >
              Unmapped ({unmappedCount})
            </button>
          </div>
        </div>

        {groups.length > 1 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className={`badge ${groupFilter === 'all' ? 'accent' : ''}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setGroupFilter('all')}
            >
              {groupAllLabel}
            </button>
            {groups.map((g) => (
              <button
                key={g}
                type="button"
                className={`badge ${groupFilter === g ? 'accent' : ''}`}
                style={{ cursor: 'pointer', border: 'none' }}
                onClick={() => setGroupFilter(g)}
              >
                {g}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 16px',
          background: 'var(--surface-2)',
          borderBottom: '1px solid var(--border)',
          fontSize: 12,
        }}
      >
        <button
          type="button"
          className="btn xs ghost"
          onClick={() => {
            const visibleIds = filtered.map((i) => i.id);
            const allSelected =
              visibleIds.length > 0 && visibleIds.every((id) => selectedBulkIds.includes(id));
            setSelectedBulkIds(
              allSelected
                ? selectedBulkIds.filter((id) => !visibleIds.includes(id))
                : Array.from(new Set([...selectedBulkIds, ...visibleIds])),
            );
          }}
        >
          {filtered.length > 0 && filtered.every((i) => selectedBulkIds.includes(i.id))
            ? 'Deselect visible'
            : 'Select all visible'}
        </button>
        {selectedBulkIds.length > 0 && (
          <>
            <button
              type="button"
              className="btn xs danger"
              onClick={() => {
                onBulkSetMapped(selectedBulkIds, false);
                setSelectedBulkIds([]);
              }}
            >
              <Icon.Trash /> Unmap selected ({selectedBulkIds.length})
            </button>
            <button
              type="button"
              className="btn xs"
              onClick={() => {
                onBulkSetMapped(selectedBulkIds, true);
                setSelectedBulkIds([]);
              }}
            >
              Map selected ({selectedBulkIds.length})
            </button>
            <button type="button" className="btn xs ghost" onClick={() => setSelectedBulkIds([])}>
              Clear
            </button>
          </>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
          {filtered.length} visible
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
          gap: 10,
          padding: 16,
          maxHeight: 340,
          overflowY: 'auto',
        }}
      >
        {filtered.map((item) => (
          <MappingTile
            key={item.id}
            item={item}
            isMapped={mappedIds.has(item.id)}
            isBulkSelected={selectedBulkIds.includes(item.id)}
            onToggleBulk={() => {
              setSelectedBulkIds((prev) =>
                prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
              );
            }}
            onToggleMapped={() => onToggleMapped(item.id)}
          />
        ))}
        {filtered.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: '20px 0',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 13,
            }}
          >
            No items match.
          </div>
        )}
      </div>
    </div>
  );
}
