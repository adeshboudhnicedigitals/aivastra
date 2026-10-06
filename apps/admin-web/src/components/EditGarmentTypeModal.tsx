import { useEffect, useMemo, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type {
  CatalogCategory,
  CatalogItem,
  GarmentType,
  ModelFace,
  TryonCategory,
  WorkflowOption,
} from '../types';
import { AssetThumb } from './AssetThumb';
import { EditDrawer } from './EditDrawer';
import { Icon } from './Icons';
import { PublicApiSlugField } from './PublicApiSlugField';
import { SearchableSelect } from './SearchableSelect';
import { Switch } from './Switch';

interface Props {
  garmentType: GarmentType;
  catalogItems: CatalogItem[];
  faces: ModelFace[];
  tryonCategories: TryonCategory[];
  workflows: WorkflowOption[];
  onSaved: (patch: Record<string, unknown>) => void;
  onClose: () => void;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

function UploadBox({
  label,
  hint,
  previewUrl,
  onPick,
  onRemove,
  disabled,
  size = 72,
}: {
  label: string;
  hint?: string;
  previewUrl: string | null;
  onPick: (f: File) => void;
  onRemove?: () => void;
  disabled: boolean;
  size?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {previewUrl ? (
        // biome-ignore lint/performance/noImgElement: admin panel
        <img
          src={previewUrl}
          alt=""
          style={{
            width: size,
            height: size,
            objectFit: 'cover',
            borderRadius: 10,
            border: '1px solid var(--border)',
            flexShrink: 0,
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: 10,
            background: 'var(--surface-2)',
            border: '1.5px dashed var(--border-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted)',
            flexShrink: 0,
          }}
        >
          <Icon.Image />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <label className="btn sm" style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
            {previewUrl ? 'Replace' : 'Upload'} {label}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              disabled={disabled}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(f);
              }}
            />
          </label>
          {previewUrl && onRemove && (
            <button type="button" className="btn sm ghost" disabled={disabled} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
        {hint && <span className="hint">{hint}</span>}
      </div>
    </div>
  );
}

function PickerTile({
  selected,
  isMapped,
  isBulkSelected,
  onToggleBulk,
  onToggleMapped,
  label,
  onClick,
  children,
}: {
  selected: boolean;
  isMapped?: boolean;
  isBulkSelected?: boolean;
  onToggleBulk?: () => void;
  onToggleMapped?: () => void;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        position: 'relative',
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        title={label}
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          opacity: isMapped !== false ? 1 : 0.45,
          transition: 'opacity 150ms ease',
        }}
      >
        <div
          style={{
            position: 'relative',
            borderRadius: 8,
            overflow: 'hidden',
            outline: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
            outlineOffset: selected ? -2 : -1,
            boxShadow: selected ? '0 0 0 3px var(--accent-soft)' : undefined,
            transition: 'outline-color 100ms ease, box-shadow 100ms ease',
          }}
        >
          {children}
          {onToggleBulk && !selected && (
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
          )}
          {selected && (
            <div
              title="Default item"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'var(--accent)',
                color: 'oklch(0.16 0.04 55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2,
              }}
            >
              <Icon.Check />
            </div>
          )}
        </div>
        <span
          style={{
            fontSize: 11,
            color: selected ? 'var(--ink)' : 'var(--muted)',
            fontWeight: selected ? 500 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 4,
            display: 'block',
            maxWidth: 88,
          }}
        >
          {label}
        </span>
      </button>

      {onToggleMapped && (
        <button
          type="button"
          className={`btn xs ${isMapped !== false ? 'ghost' : ''}`}
          style={{
            padding: '2px 4px',
            fontSize: 10,
            lineHeight: 1,
            color: isMapped !== false ? 'var(--muted)' : undefined,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
          }}
          title={isMapped !== false ? 'Unmap from this garment type' : 'Map to this garment type'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMapped();
          }}
        >
          {isMapped !== false ? (
            <>
              <Icon.Trash /> Unmap
            </>
          ) : (
            'Map'
          )}
        </button>
      )}
    </div>
  );
}

function ItemPicker({
  type,
  gender,
  items,
  categories,
  selectedId,
  onSelect,
  mappedIds,
  onToggleMapped,
  onBulkSetMapped,
}: {
  type: 'lower' | 'shoe';
  gender: string;
  items: CatalogItem[];
  categories: CatalogCategory[];
  selectedId: string;
  onSelect: (id: string) => void;
  mappedIds: Set<string>;
  onToggleMapped: (id: string) => void;
  onBulkSetMapped: (ids: string[], mapped: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);

  const scoped = useMemo(
    () => items.filter((c) => c.type === type && c.isActive && c.genderSlug === gender),
    [items, type, gender],
  );
  const relevantCategories = useMemo(
    () =>
      categories
        .filter((c) => c.typeSlug === type && c.isActive && c.genderSlug === gender)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [categories, type, gender],
  );

  const mappedCount = useMemo(
    () => scoped.filter((c) => mappedIds.has(c.id)).length,
    [scoped, mappedIds],
  );
  const unmappedCount = scoped.length - mappedCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((c) => {
      const isMapped = mappedIds.has(c.id);
      const matchesCategory = categoryFilter === 'all' || c.categoryId === categoryFilter;
      const matchesSearch = !q || c.label.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === 'all' ? true : statusFilter === 'mapped' ? isMapped : !isMapped;
      return matchesCategory && matchesSearch && matchesStatus;
    });
  }, [scoped, categoryFilter, search, statusFilter, mappedIds]);

  const selectedItem = scoped.find((c) => c.id === selectedId);

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
              placeholder="Search items…"
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
              All ({scoped.length})
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
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>
            {selectedItem ? `Default: ${selectedItem.label}` : 'No default selected'}
          </span>
        </div>

        {relevantCategories.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className={`badge ${categoryFilter === 'all' ? 'accent' : ''}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setCategoryFilter('all')}
            >
              All Categories
            </button>
            {relevantCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`badge ${categoryFilter === c.id ? 'accent' : ''}`}
                style={{ cursor: 'pointer', border: 'none' }}
                onClick={() => setCategoryFilter(c.id)}
              >
                {c.label}
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
            const visibleIds = filtered.map((c) => c.id);
            const allSelected =
              visibleIds.length > 0 && visibleIds.every((id) => selectedBulkIds.includes(id));
            setSelectedBulkIds(
              allSelected
                ? selectedBulkIds.filter((id) => !visibleIds.includes(id))
                : Array.from(new Set([...selectedBulkIds, ...visibleIds])),
            );
          }}
        >
          {filtered.length > 0 && filtered.every((c) => selectedBulkIds.includes(c.id))
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
          maxHeight: 300,
          overflowY: 'auto',
        }}
      >
        <PickerTile selected={selectedId === ''} label="None" onClick={() => onSelect('')}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 8,
              background: 'var(--surface-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              fontSize: 20,
            }}
          >
            —
          </div>
        </PickerTile>
        {filtered.map((c) => {
          const isItemMapped = mappedIds.has(c.id);
          return (
            <PickerTile
              key={c.id}
              selected={selectedId === c.id}
              isMapped={isItemMapped}
              isBulkSelected={selectedBulkIds.includes(c.id)}
              onToggleBulk={() => {
                setSelectedBulkIds((prev) =>
                  prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                );
              }}
              onToggleMapped={() => onToggleMapped(c.id)}
              label={c.label}
              onClick={() => {
                if (!isItemMapped) {
                  onToggleMapped(c.id);
                  onSelect(c.id);
                } else {
                  onSelect(c.id === selectedId ? '' : c.id);
                }
              }}
            >
              <AssetThumb thumbnailUrl={c.thumbnailUrl} label={c.label} w={88} h={88} />
            </PickerTile>
          );
        })}
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

function FacePicker({
  gender,
  faces,
  mappedIds,
  onToggleMapped,
  onBulkSetMapped,
}: {
  gender: string;
  faces: ModelFace[];
  mappedIds: Set<string>;
  onToggleMapped: (id: string) => void;
  onBulkSetMapped: (ids: string[], mapped: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [continentFilter, setContinentFilter] = useState<string | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);

  const scoped = useMemo(
    () => faces.filter((f) => f.isActive && f.gender === gender),
    [faces, gender],
  );
  const continents = useMemo(
    () =>
      Array.from(new Set(scoped.map((f) => f.continent || 'global'))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [scoped],
  );

  const mappedCount = useMemo(
    () => scoped.filter((f) => mappedIds.has(f.id)).length,
    [scoped, mappedIds],
  );
  const unmappedCount = scoped.length - mappedCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((f) => {
      const isMapped = mappedIds.has(f.id);
      const matchesContinent =
        continentFilter === 'all' || (f.continent || 'global') === continentFilter;
      const matchesSearch = !q || f.label.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === 'all' ? true : statusFilter === 'mapped' ? isMapped : !isMapped;
      return matchesContinent && matchesSearch && matchesStatus;
    });
  }, [scoped, continentFilter, search, statusFilter, mappedIds]);

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
              placeholder="Search faces…"
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
              All ({scoped.length})
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

        {continents.length > 1 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className={`badge ${continentFilter === 'all' ? 'accent' : ''}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setContinentFilter('all')}
            >
              All Continents
            </button>
            {continents.map((c) => (
              <button
                key={c}
                type="button"
                className={`badge ${continentFilter === c ? 'accent' : ''}`}
                style={{ cursor: 'pointer', border: 'none' }}
                onClick={() => setContinentFilter(c)}
              >
                {c === 'global' ? 'Global' : c}
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
            const visibleIds = filtered.map((f) => f.id);
            const allSelected =
              visibleIds.length > 0 && visibleIds.every((id) => selectedBulkIds.includes(id));
            setSelectedBulkIds(
              allSelected
                ? selectedBulkIds.filter((id) => !visibleIds.includes(id))
                : Array.from(new Set([...selectedBulkIds, ...visibleIds])),
            );
          }}
        >
          {filtered.length > 0 && filtered.every((f) => selectedBulkIds.includes(f.id))
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
          maxHeight: 300,
          overflowY: 'auto',
        }}
      >
        {filtered.map((f) => {
          const isFaceMapped = mappedIds.has(f.id);
          return (
            <PickerTile
              key={f.id}
              selected={false}
              isMapped={isFaceMapped}
              isBulkSelected={selectedBulkIds.includes(f.id)}
              onToggleBulk={() => {
                setSelectedBulkIds((prev) =>
                  prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id],
                );
              }}
              onToggleMapped={() => onToggleMapped(f.id)}
              label={f.label}
              onClick={() => onToggleMapped(f.id)}
            >
              <AssetThumb thumbnailUrl={f.thumbnailUrl} label={f.label} w={88} h={88} />
            </PickerTile>
          );
        })}
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
            No faces match.
          </div>
        )}
      </div>
    </div>
  );
}

export function EditGarmentTypeModal({
  garmentType,
  catalogItems,
  faces,
  tryonCategories,
  workflows,
  onSaved,
  onClose,
  toast,
}: Props) {
  const [label, setLabel] = useState(garmentType.label);
  const [sortOrder, setSortOrder] = useState(garmentType.sortOrder);
  const [requiresLowerUpload, setRequiresLowerUpload] = useState(garmentType.requiresLowerUpload);
  const [upperUploadLabel, setUpperUploadLabel] = useState(garmentType.upperUploadLabel ?? '');
  const [lowerUploadLabel, setLowerUploadLabel] = useState(garmentType.lowerUploadLabel ?? '');
  const [requiresThirdUpload, setRequiresThirdUpload] = useState(
    garmentType.requiresThirdUpload ?? false,
  );
  const [thirdUploadLabel, setThirdUploadLabel] = useState(garmentType.thirdUploadLabel ?? '');
  const [allowsFourthUpload, setAllowsFourthUpload] = useState(
    garmentType.allowsFourthUpload ?? false,
  );
  const [fourthUploadLabel, setFourthUploadLabel] = useState(garmentType.fourthUploadLabel ?? '');
  const [defaultLowerId, setDefaultLowerId] = useState(garmentType.defaultLowerCatalogId ?? '');
  const [defaultShoeId, setDefaultShoeId] = useState(garmentType.defaultShoeCatalogId ?? '');
  const [tryonCategoryId, setTryonCategoryId] = useState(garmentType.tryonCategoryId ?? '');
  const [requiresMannequinStep, setRequiresMannequinStep] = useState(
    garmentType.requiresMannequinStep ?? false,
  );
  const [mannequinWorkflowTemplateId, setMannequinWorkflowTemplateId] = useState(
    garmentType.mannequinWorkflowTemplateId ?? '',
  );
  const [sareeStep2WorkflowTemplateId, setSareeStep2WorkflowTemplateId] = useState(
    garmentType.sareeStep2WorkflowTemplateId ?? '',
  );
  const [mannequinTwoInputWorkflowTemplateId, setMannequinTwoInputWorkflowTemplateId] = useState(
    garmentType.mannequinTwoInputWorkflowTemplateId ?? '',
  );
  const [twoInputTryonWorkflowTemplateId, setTwoInputTryonWorkflowTemplateId] = useState(
    garmentType.twoInputTryonWorkflowTemplateId ?? '',
  );
  const [publicApiSlug, setPublicApiSlug] = useState(garmentType.publicApiSlug ?? '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [instructionFile, setInstructionFile] = useState<File | null>(null);
  const [removeInstructionImage, setRemoveInstructionImage] = useState(false);
  const [tryonLibraryInstructionFile, setTryonLibraryInstructionFile] = useState<File | null>(null);
  const [removeTryonLibraryInstructionImage, setRemoveTryonLibraryInstructionImage] =
    useState(false);
  const [tutorialVideoUrl, setTutorialVideoUrl] = useState(garmentType.tutorialVideoUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);

  const allLowers = useMemo(
    () =>
      catalogItems.filter(
        (c) => c.type === 'lower' && c.isActive && c.genderSlug === garmentType.genderSlug,
      ),
    [catalogItems, garmentType.genderSlug],
  );

  const allShoes = useMemo(
    () =>
      catalogItems.filter(
        (c) => c.type === 'shoe' && c.isActive && c.genderSlug === garmentType.genderSlug,
      ),
    [catalogItems, garmentType.genderSlug],
  );

  const [mappedLowerIds, setMappedLowerIds] = useState<Set<string>>(() => {
    const explicitlyMapped = allLowers.filter((c) =>
      (c.subcategoryIds ?? []).includes(garmentType.id),
    );
    return new Set(
      explicitlyMapped.length > 0 ? explicitlyMapped.map((c) => c.id) : allLowers.map((c) => c.id),
    );
  });
  const [initialMappedLowerIds, setInitialMappedLowerIds] = useState<Set<string>>(mappedLowerIds);

  const [mappedShoeIds, setMappedShoeIds] = useState<Set<string>>(() => {
    const explicitlyMapped = allShoes.filter((c) =>
      (c.subcategoryIds ?? []).includes(garmentType.id),
    );
    return new Set(
      explicitlyMapped.length > 0 ? explicitlyMapped.map((c) => c.id) : allShoes.map((c) => c.id),
    );
  });
  const [initialMappedShoeIds, setInitialMappedShoeIds] = useState<Set<string>>(mappedShoeIds);

  const allFaces = useMemo(
    () => faces.filter((f) => f.isActive && f.gender === garmentType.genderSlug),
    [faces, garmentType.genderSlug],
  );
  // Faces (unlike catalog items) don't carry their own subcategoryIds in this
  // component's props, so there's no instant guess available here — this starts
  // empty and gets its real value from the face-mappings fetch below, same as
  // mappedLower/ShoeIds would if allLowers/allShoes had no subcategoryIds either.
  const [mappedFaceIds, setMappedFaceIds] = useState<Set<string>>(new Set());
  const [initialMappedFaceIds, setInitialMappedFaceIds] = useState<Set<string>>(new Set());

  // biome-ignore lint/correctness/useExhaustiveDependencies: initialMapped{Lower,Shoe,Face}Ids are read once to snapshot the pre-fetch baseline, not reacted to — listing them would loop this effect forever
  useEffect(() => {
    // Snapshot the pre-fetch baseline so a toggle made by the admin while this
    // request is in flight isn't silently discarded when the authoritative
    // mapping data lands — replay it on top of the real baseline instead of
    // overwriting mappedLower/Shoe/FaceIds outright.
    const guessedInitialLower = initialMappedLowerIds;
    const guessedInitialShoe = initialMappedShoeIds;
    const guessedInitialFace = initialMappedFaceIds;

    apiFetch<{
      mappedLowerIds: string[];
      hasExplicitLowerMappings: boolean;
      mappedShoeIds: string[];
      hasExplicitShoeMappings: boolean;
    }>(`/admin/assets/garment-types/${garmentType.id}/catalog-mappings`)
      .then((res) => {
        const lowerSet = res.hasExplicitLowerMappings
          ? new Set(res.mappedLowerIds)
          : new Set(allLowers.map((c) => c.id));
        setMappedLowerIds((prevMapped) => {
          const next = new Set(lowerSet);
          for (const id of prevMapped) {
            if (!guessedInitialLower.has(id)) next.add(id);
          }
          for (const id of guessedInitialLower) {
            if (!prevMapped.has(id)) next.delete(id);
          }
          return next;
        });
        setInitialMappedLowerIds(new Set(lowerSet));

        const shoeSet = res.hasExplicitShoeMappings
          ? new Set(res.mappedShoeIds)
          : new Set(allShoes.map((c) => c.id));
        setMappedShoeIds((prevMapped) => {
          const next = new Set(shoeSet);
          for (const id of prevMapped) {
            if (!guessedInitialShoe.has(id)) next.add(id);
          }
          for (const id of guessedInitialShoe) {
            if (!prevMapped.has(id)) next.delete(id);
          }
          return next;
        });
        setInitialMappedShoeIds(new Set(shoeSet));
      })
      .catch(() => {});

    apiFetch<{ mappedFaceIds: string[]; hasExplicitFaceMappings: boolean }>(
      `/admin/assets/garment-types/${garmentType.id}/face-mappings`,
    )
      .then((res) => {
        const faceSet = res.hasExplicitFaceMappings
          ? new Set(res.mappedFaceIds)
          : new Set(allFaces.map((f) => f.id));
        setMappedFaceIds((prevMapped) => {
          const next = new Set(faceSet);
          for (const id of prevMapped) {
            if (!guessedInitialFace.has(id)) next.add(id);
          }
          for (const id of guessedInitialFace) {
            if (!prevMapped.has(id)) next.delete(id);
          }
          return next;
        });
        setInitialMappedFaceIds(new Set(faceSet));
      })
      .catch(() => {});
  }, [garmentType.id, allLowers, allShoes, allFaces]);

  const toggleMappedLower = (id: string) => {
    setMappedLowerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (defaultLowerId === id) setDefaultLowerId('');
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const bulkSetMappedLower = (ids: string[], mapped: boolean) => {
    setMappedLowerIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (mapped) {
          next.add(id);
        } else {
          next.delete(id);
          if (defaultLowerId === id) setDefaultLowerId('');
        }
      }
      return next;
    });
  };

  const toggleMappedShoe = (id: string) => {
    setMappedShoeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (defaultShoeId === id) setDefaultShoeId('');
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const bulkSetMappedShoe = (ids: string[], mapped: boolean) => {
    setMappedShoeIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (mapped) {
          next.add(id);
        } else {
          next.delete(id);
          if (defaultShoeId === id) setDefaultShoeId('');
        }
      }
      return next;
    });
  };

  const toggleMappedFace = (id: string) => {
    setMappedFaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const bulkSetMappedFace = (ids: string[], mapped: boolean) => {
    setMappedFaceIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (mapped) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  };

  const lowerMappingDirty = useMemo(() => {
    if (initialMappedLowerIds.size !== mappedLowerIds.size) return true;
    for (const id of mappedLowerIds) {
      if (!initialMappedLowerIds.has(id)) return true;
    }
    return false;
  }, [initialMappedLowerIds, mappedLowerIds]);

  const shoeMappingDirty = useMemo(() => {
    if (initialMappedShoeIds.size !== mappedShoeIds.size) return true;
    for (const id of mappedShoeIds) {
      if (!initialMappedShoeIds.has(id)) return true;
    }
    return false;
  }, [initialMappedShoeIds, mappedShoeIds]);

  const faceMappingDirty = useMemo(() => {
    if (initialMappedFaceIds.size !== mappedFaceIds.size) return true;
    for (const id of mappedFaceIds) {
      if (!initialMappedFaceIds.has(id)) return true;
    }
    return false;
  }, [initialMappedFaceIds, mappedFaceIds]);

  useEffect(() => {
    apiFetch<CatalogCategory[]>('/admin/catalog/categories')
      .then(setCategories)
      .catch(() => {});
  }, []);

  const imagePreview = imageFile
    ? URL.createObjectURL(imageFile)
    : (garmentType.thumbnailUrl ?? null);
  const instructionPreview = instructionFile
    ? URL.createObjectURL(instructionFile)
    : removeInstructionImage
      ? null
      : (garmentType.instructionImageUrl ?? null);
  const tryonLibraryInstructionPreview = tryonLibraryInstructionFile
    ? URL.createObjectURL(tryonLibraryInstructionFile)
    : removeTryonLibraryInstructionImage
      ? null
      : (garmentType.tryonLibraryInstructionImageUrl ?? null);

  const dirty =
    !!imageFile ||
    !!instructionFile ||
    removeInstructionImage ||
    !!tryonLibraryInstructionFile ||
    removeTryonLibraryInstructionImage ||
    label.trim() !== garmentType.label.trim() ||
    sortOrder !== garmentType.sortOrder ||
    requiresLowerUpload !== garmentType.requiresLowerUpload ||
    upperUploadLabel !== (garmentType.upperUploadLabel ?? '') ||
    lowerUploadLabel !== (garmentType.lowerUploadLabel ?? '') ||
    requiresThirdUpload !== (garmentType.requiresThirdUpload ?? false) ||
    thirdUploadLabel !== (garmentType.thirdUploadLabel ?? '') ||
    allowsFourthUpload !== (garmentType.allowsFourthUpload ?? false) ||
    fourthUploadLabel !== (garmentType.fourthUploadLabel ?? '') ||
    defaultLowerId !== (garmentType.defaultLowerCatalogId ?? '') ||
    defaultShoeId !== (garmentType.defaultShoeCatalogId ?? '') ||
    tryonCategoryId !== (garmentType.tryonCategoryId ?? '') ||
    requiresMannequinStep !== (garmentType.requiresMannequinStep ?? false) ||
    mannequinWorkflowTemplateId !== (garmentType.mannequinWorkflowTemplateId ?? '') ||
    sareeStep2WorkflowTemplateId !== (garmentType.sareeStep2WorkflowTemplateId ?? '') ||
    mannequinTwoInputWorkflowTemplateId !==
      (garmentType.mannequinTwoInputWorkflowTemplateId ?? '') ||
    twoInputTryonWorkflowTemplateId !== (garmentType.twoInputTryonWorkflowTemplateId ?? '') ||
    tutorialVideoUrl !== (garmentType.tutorialVideoUrl ?? '') ||
    lowerMappingDirty ||
    shoeMappingDirty ||
    faceMappingDirty;

  const save = async () => {
    setSaving(true);
    try {
      const patchBody: Record<string, unknown> = {};
      if (imageFile) {
        const presign = await apiFetch<{ uploadUrl: string; thumbnailKey: string }>(
          '/admin/assets/garment-types/presign',
          { method: 'POST', body: JSON.stringify({ contentType: imageFile.type }) },
        );
        const thumb = await makeThumbnail(imageFile);
        await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': thumb.type },
          body: thumb,
        });
        patchBody.thumbnailKey = presign.thumbnailKey;
      }
      if (instructionFile) {
        const presign = await apiFetch<{ uploadUrl: string; instructionImageKey: string }>(
          '/admin/assets/garment-types/instruction/presign',
          { method: 'POST', body: JSON.stringify({ contentType: instructionFile.type }) },
        );
        await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': instructionFile.type },
          body: instructionFile,
        });
        patchBody.instructionImageKey = presign.instructionImageKey;
      } else if (removeInstructionImage) {
        patchBody.instructionImageKey = null;
      }
      if (tryonLibraryInstructionFile) {
        const presign = await apiFetch<{
          uploadUrl: string;
          tryonLibraryInstructionImageKey: string;
        }>('/admin/assets/garment-types/tryon-library-instruction/presign', {
          method: 'POST',
          body: JSON.stringify({ contentType: tryonLibraryInstructionFile.type }),
        });
        await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': tryonLibraryInstructionFile.type },
          body: tryonLibraryInstructionFile,
        });
        patchBody.tryonLibraryInstructionImageKey = presign.tryonLibraryInstructionImageKey;
      } else if (removeTryonLibraryInstructionImage) {
        patchBody.tryonLibraryInstructionImageKey = null;
      }
      if (label.trim() !== garmentType.label.trim()) patchBody.label = label.trim();
      if (publicApiSlug !== (garmentType.publicApiSlug ?? ''))
        patchBody.publicApiSlug = publicApiSlug;
      if (sortOrder !== garmentType.sortOrder) patchBody.sortOrder = sortOrder;
      if (requiresLowerUpload !== garmentType.requiresLowerUpload) {
        patchBody.requiresLowerUpload = requiresLowerUpload;
      }
      if (upperUploadLabel !== (garmentType.upperUploadLabel ?? '')) {
        patchBody.upperUploadLabel = upperUploadLabel.trim() || null;
      }
      if (lowerUploadLabel !== (garmentType.lowerUploadLabel ?? '')) {
        patchBody.lowerUploadLabel = lowerUploadLabel.trim() || null;
      }
      if (requiresThirdUpload !== (garmentType.requiresThirdUpload ?? false)) {
        patchBody.requiresThirdUpload = requiresThirdUpload;
      }
      if (thirdUploadLabel !== (garmentType.thirdUploadLabel ?? '')) {
        patchBody.thirdUploadLabel = thirdUploadLabel.trim() || null;
      }
      if (allowsFourthUpload !== (garmentType.allowsFourthUpload ?? false)) {
        patchBody.allowsFourthUpload = allowsFourthUpload;
      }
      if (fourthUploadLabel !== (garmentType.fourthUploadLabel ?? '')) {
        patchBody.fourthUploadLabel = fourthUploadLabel.trim() || null;
      }
      if (defaultLowerId !== (garmentType.defaultLowerCatalogId ?? '')) {
        patchBody.defaultLowerCatalogId = defaultLowerId || null;
      }
      if (defaultShoeId !== (garmentType.defaultShoeCatalogId ?? '')) {
        patchBody.defaultShoeCatalogId = defaultShoeId || null;
      }
      if (tryonCategoryId !== (garmentType.tryonCategoryId ?? '')) {
        patchBody.tryonCategoryId = tryonCategoryId || null;
      }
      if (requiresMannequinStep !== (garmentType.requiresMannequinStep ?? false)) {
        patchBody.requiresMannequinStep = requiresMannequinStep;
      }
      if (mannequinWorkflowTemplateId !== (garmentType.mannequinWorkflowTemplateId ?? '')) {
        patchBody.mannequinWorkflowTemplateId = mannequinWorkflowTemplateId || null;
      }
      if (sareeStep2WorkflowTemplateId !== (garmentType.sareeStep2WorkflowTemplateId ?? '')) {
        patchBody.sareeStep2WorkflowTemplateId = sareeStep2WorkflowTemplateId || null;
      }
      if (
        mannequinTwoInputWorkflowTemplateId !==
        (garmentType.mannequinTwoInputWorkflowTemplateId ?? '')
      ) {
        patchBody.mannequinTwoInputWorkflowTemplateId = mannequinTwoInputWorkflowTemplateId || null;
      }
      if (twoInputTryonWorkflowTemplateId !== (garmentType.twoInputTryonWorkflowTemplateId ?? '')) {
        patchBody.twoInputTryonWorkflowTemplateId = twoInputTryonWorkflowTemplateId || null;
      }
      if (tutorialVideoUrl !== (garmentType.tutorialVideoUrl ?? '')) {
        patchBody.tutorialVideoUrl = tutorialVideoUrl.trim() || null;
      }
      if (lowerMappingDirty) {
        patchBody.mappedLowerCatalogItemIds = Array.from(mappedLowerIds);
      }
      if (shoeMappingDirty) {
        patchBody.mappedShoeCatalogItemIds = Array.from(mappedShoeIds);
      }
      if (faceMappingDirty) {
        patchBody.mappedFaceIds = Array.from(mappedFaceIds);
      }

      if (Object.keys(patchBody).length > 0) {
        await apiFetch(`/admin/assets/garment-types/${garmentType.id}`, {
          method: 'PATCH',
          body: JSON.stringify(patchBody),
        });
        onSaved(patchBody);
      }
      toast({ title: `${(patchBody.label as string) ?? garmentType.label} updated` });
      onClose();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to save',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditDrawer
      onClose={onClose}
      title="Edit Garment Type"
      subtitle={garmentType.slug}
      tags={[{ label: garmentType.genderSlug, tone: 'dot-accent' }]}
      thumbnail={{ thumbnailUrl: garmentType.thumbnailUrl }}
      width="min(780px, calc(100vw - 60px))"
      saving={saving}
      onSave={() => void save()}
      saveDisabled={!dirty || !label.trim()}
      sections={[
        {
          title: 'Basic Info',
          children: (
            <>
              <UploadBox
                label="thumbnail"
                previewUrl={imagePreview}
                onPick={setImageFile}
                disabled={saving}
              />
              <div className="field">
                <label>Label</label>
                <input
                  className="input"
                  value={label}
                  disabled={saving}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <PublicApiSlugField
                value={publicApiSlug}
                disabled={saving}
                kind="shirt"
                onChange={setPublicApiSlug}
              />
              <div className="field">
                <label>
                  Sort order{' '}
                  <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                    (1 shows first; picking a taken position pushes the rest down)
                  </span>
                </label>
                <input
                  className="input"
                  type="number"
                  step={1}
                  value={sortOrder}
                  disabled={saving}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                />
              </div>
              <div className="setting-row" style={{ padding: 0, border: 0 }}>
                <div>
                  <div className="setting-lbl">Requires lower garment upload</div>
                  <div className="setting-desc">
                    User uploads bottom wear separately instead of picking from the catalog.
                  </div>
                </div>
                <Switch
                  checked={requiresLowerUpload}
                  onChange={setRequiresLowerUpload}
                  disabled={saving}
                />
              </div>
              {requiresLowerUpload && (
                <>
                  <div className="field">
                    <label>Top garment upload label</label>
                    <input
                      className="input"
                      placeholder="e.g. Upload Top (defaults to garment name)"
                      value={upperUploadLabel}
                      disabled={saving}
                      onChange={(e) => setUpperUploadLabel(e.target.value)}
                    />
                    <span className="hint">
                      Shown in studio as the title of the top-wear upload box. Leave blank to use
                      the garment type name.
                    </span>
                  </div>
                  <div className="field">
                    <label>Bottom garment upload label</label>
                    <input
                      className="input"
                      placeholder="e.g. Upload Bottom / Pyjama / Trousers"
                      value={lowerUploadLabel}
                      disabled={saving}
                      onChange={(e) => setLowerUploadLabel(e.target.value)}
                    />
                    <span className="hint">
                      Shown in studio as the title of the bottom-wear upload box.
                    </span>
                  </div>
                </>
              )}
              <div className="setting-row" style={{ padding: 0, border: 0 }}>
                <div>
                  <div className="setting-lbl">Requires 3rd Upload (e.g. Scarf/Dupatta)</div>
                  <div className="setting-desc">Customers must upload a third image.</div>
                </div>
                <Switch
                  checked={requiresThirdUpload}
                  onChange={setRequiresThirdUpload}
                  disabled={saving}
                />
              </div>
              {requiresThirdUpload && (
                <div className="field">
                  <label>3rd Upload Field Label</label>
                  <input
                    className="input"
                    placeholder="e.g. Scarf Image"
                    value={thirdUploadLabel}
                    disabled={saving}
                    onChange={(e) => setThirdUploadLabel(e.target.value)}
                  />
                  <span className="hint">
                    Shown in studio as the title of the third garment upload box.
                  </span>
                </div>
              )}
              <div className="setting-row" style={{ padding: 0, border: 0 }}>
                <div>
                  <div className="setting-lbl">Optional extra upload (e.g. Blouse)</div>
                  <div className="setting-desc">
                    Studio offers an optional fourth image. Without it the job runs on the other
                    uploads alone. Needs a workflow with a blouse node mapped.
                  </div>
                </div>
                <Switch
                  checked={allowsFourthUpload}
                  onChange={setAllowsFourthUpload}
                  disabled={saving}
                />
              </div>
              {allowsFourthUpload && (
                <div className="field">
                  <label>Optional Upload Field Label</label>
                  <input
                    className="input"
                    placeholder="e.g. Blouse (optional)"
                    value={fourthUploadLabel}
                    disabled={saving}
                    onChange={(e) => setFourthUploadLabel(e.target.value)}
                  />
                  <span className="hint">
                    Shown in studio as the title of the optional upload box. Map the matching node
                    on the workflow (title it "blouse") — see the note in the workflow upload panel.
                  </span>
                </div>
              )}
              <div className="field">
                <label>Tryon Category</label>
                <SearchableSelect
                  options={tryonCategories.map((c) => ({ id: c.id, label: c.name }))}
                  value={tryonCategoryId}
                  disabled={saving}
                  emptyLabel="— none —"
                  placeholder="— search category —"
                  onChange={setTryonCategoryId}
                />
                <span className="hint">
                  Maps this garment type to a tryon workflow for the "Browse from Catalog" picker on
                  the tryon page.
                </span>
              </div>
            </>
          ),
        },
        {
          title: 'Two-Step Generation',
          children: (
            <>
              <div className="setting-row" style={{ padding: 0, border: 0 }}>
                <div>
                  <div className="setting-lbl">Two-step generation (mannequin + drape)</div>
                  <div className="setting-desc">
                    Runs a one-time, free "mannequin" generation before the normal per-pose jobs,
                    reusing its output as the garment input for every pose. Used by Flat Saree.
                  </div>
                </div>
                <Switch
                  checked={requiresMannequinStep}
                  onChange={setRequiresMannequinStep}
                  disabled={saving}
                />
              </div>
              {requiresMannequinStep && (
                <>
                  <div className="field">
                    <label>Mannequin (Step 1) Workflow</label>
                    <SearchableSelect
                      options={workflows
                        .filter((w) => w.workflowType === 'saree_step1' && w.isActive)
                        .map((w) => ({ id: w.id, label: `${w.label} (${w.slug})` }))}
                      value={mannequinWorkflowTemplateId}
                      disabled={saving}
                      emptyLabel="— none —"
                      placeholder="— search workflow —"
                      onChange={setMannequinWorkflowTemplateId}
                    />
                    <span className="hint">
                      Drapes the uploaded garment onto the selected face, once per job.
                    </span>
                  </div>
                  <div className="field">
                    <label>Two-Input Mannequin (Body + Pallu) Workflow</label>
                    <SearchableSelect
                      options={workflows
                        .filter((w) => w.workflowType === 'saree_step1_two_input' && w.isActive)
                        .map((w) => ({ id: w.id, label: `${w.label} (${w.slug})` }))}
                      value={mannequinTwoInputWorkflowTemplateId}
                      disabled={saving}
                      emptyLabel="— none —"
                      placeholder="— search workflow —"
                      onChange={setMannequinTwoInputWorkflowTemplateId}
                    />
                    <span className="hint">
                      Optional. When set, the studio wizard offers a "Body & Pallu" two-image upload
                      mode for this garment type, using this workflow instead of the one above.
                    </span>
                  </div>
                  <div className="field">
                    <label>Two-Input Direct Try-On Workflow</label>
                    <SearchableSelect
                      options={workflows
                        .filter((w) => w.workflowType === 'saree_step1_two_input' && w.isActive)
                        .map((w) => ({ id: w.id, label: `${w.label} (${w.slug})` }))}
                      value={twoInputTryonWorkflowTemplateId}
                      disabled={saving}
                      emptyLabel="— none —"
                      placeholder="— search workflow —"
                      onChange={setTwoInputTryonWorkflowTemplateId}
                    />
                    <span className="hint">
                      Used when a customer tries on a merchant catalog item that has a second
                      (pallu) image — patches the customer's own photo directly, no mannequin step.
                    </span>
                  </div>
                  <div className="field">
                    <label>Draping (Step 2) Workflow</label>
                    <SearchableSelect
                      options={workflows
                        .filter((w) => w.workflowType === 'regular' && w.isActive)
                        .map((w) => ({ id: w.id, label: `${w.label} (${w.slug})` }))}
                      value={sareeStep2WorkflowTemplateId}
                      disabled={saving}
                      emptyLabel="— none —"
                      placeholder="— search workflow —"
                      onChange={setSareeStep2WorkflowTemplateId}
                    />
                    <span className="hint">
                      Used for EVERY pose in a job for this garment type — overrides each pose's own
                      workflow assignment.
                    </span>
                  </div>
                </>
              )}
            </>
          ),
        },
        {
          title: `Default Lower Garment${allLowers.length - mappedLowerIds.size > 0 ? ` (${allLowers.length - mappedLowerIds.size} unmapped)` : ''}`,
          flush: true,
          children: (
            <ItemPicker
              type="lower"
              gender={garmentType.genderSlug}
              items={catalogItems}
              categories={categories}
              selectedId={defaultLowerId}
              onSelect={setDefaultLowerId}
              mappedIds={mappedLowerIds}
              onToggleMapped={toggleMappedLower}
              onBulkSetMapped={bulkSetMappedLower}
            />
          ),
        },
        {
          title: `Default Shoe${allShoes.length - mappedShoeIds.size > 0 ? ` (${allShoes.length - mappedShoeIds.size} unmapped)` : ''}`,
          flush: true,
          children: (
            <ItemPicker
              type="shoe"
              gender={garmentType.genderSlug}
              items={catalogItems}
              categories={categories}
              selectedId={defaultShoeId}
              onSelect={setDefaultShoeId}
              mappedIds={mappedShoeIds}
              onToggleMapped={toggleMappedShoe}
              onBulkSetMapped={bulkSetMappedShoe}
            />
          ),
        },
        {
          title: `Faces${allFaces.length - mappedFaceIds.size > 0 ? ` (${allFaces.length - mappedFaceIds.size} unmapped)` : ''}`,
          flush: true,
          children: (
            <FacePicker
              gender={garmentType.genderSlug}
              faces={faces}
              mappedIds={mappedFaceIds}
              onToggleMapped={toggleMappedFace}
              onBulkSetMapped={bulkSetMappedFace}
            />
          ),
        },
        {
          title: 'Catalogue Instruction Image',
          children: (
            <>
              <UploadBox
                label="catalogue instruction image"
                hint="Shown to users as an upload guide for this garment type."
                previewUrl={instructionPreview}
                onPick={(f) => {
                  setInstructionFile(f);
                  setRemoveInstructionImage(false);
                }}
                onRemove={
                  instructionPreview
                    ? () => {
                        setInstructionFile(null);
                        setRemoveInstructionImage(true);
                      }
                    : undefined
                }
                disabled={saving}
              />
              <div className="field">
                <label>Tutorial Video (YouTube link)</label>
                <input
                  className="input"
                  placeholder="https://youtu.be/…"
                  value={tutorialVideoUrl}
                  disabled={saving}
                  onChange={(e) => setTutorialVideoUrl(e.target.value)}
                />
                <span className="hint">
                  Shown to users as a "Watch Demo Video" link above the do's/don'ts image. Leave
                  blank to hide it.
                </span>
              </div>
            </>
          ),
        },
        {
          title: 'Try-On Instruction Image',
          children: (
            <UploadBox
              label="try-on instruction image"
              hint="Shown as the reference photo when a merchant adds a product in the Try-On Library app."
              previewUrl={tryonLibraryInstructionPreview}
              onPick={(f) => {
                setTryonLibraryInstructionFile(f);
                setRemoveTryonLibraryInstructionImage(false);
              }}
              onRemove={
                tryonLibraryInstructionPreview
                  ? () => {
                      setTryonLibraryInstructionFile(null);
                      setRemoveTryonLibraryInstructionImage(true);
                    }
                  : undefined
              }
              disabled={saving}
            />
          ),
        },
      ]}
    />
  );
}
