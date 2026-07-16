import { useEffect, useMemo, useState } from 'react';
import { apiErrorMessage, apiFetch } from '../lib/data';
import { makeThumbnail } from '../lib/thumbnail';
import type {
  CatalogCategory,
  CatalogItem,
  GarmentType,
  TryonCategory,
  WorkflowOption,
} from '../types';
import { AssetThumb } from './AssetThumb';
import { Icon } from './Icons';
import { Switch } from './Switch';

interface Props {
  garmentType: GarmentType;
  catalogItems: CatalogItem[];
  tryonCategories: TryonCategory[];
  workflows: WorkflowOption[];
  storagePublicUrl: string | null;
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
  label,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        textAlign: 'left',
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
        {selected && (
          <div
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
        }}
      >
        {label}
      </span>
    </button>
  );
}

function ItemPicker({
  type,
  gender,
  items,
  categories,
  selectedId,
  onSelect,
  storagePublicUrl,
}: {
  type: 'lower' | 'shoe';
  gender: string;
  items: CatalogItem[];
  categories: CatalogCategory[];
  selectedId: string;
  onSelect: (id: string) => void;
  storagePublicUrl: string | null;
}) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | 'all'>('all');

  const scoped = useMemo(
    () =>
      items.filter(
        (c) => c.type === type && c.isActive && (!c.genderSlug || c.genderSlug === gender),
      ),
    [items, type, gender],
  );
  const relevantCategories = useMemo(
    () =>
      categories
        .filter(
          (c) => c.typeSlug === type && c.isActive && (!c.genderSlug || c.genderSlug === gender),
        )
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [categories, type, gender],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter(
      (c) =>
        (categoryFilter === 'all' || c.categoryId === categoryFilter) &&
        (!q || c.label.toLowerCase().includes(q)),
    );
  }, [scoped, categoryFilter, search]);

  const selectedItem = scoped.find((c) => c.id === selectedId);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <div className="search" style={{ width: 180 }}>
          <Icon.Search />
          <input
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {relevantCategories.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`badge ${categoryFilter === 'all' ? 'accent' : ''}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setCategoryFilter('all')}
            >
              All
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
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>
          {selectedItem ? `Selected: ${selectedItem.label}` : 'None selected'}
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
        {filtered.map((c) => (
          <PickerTile
            key={c.id}
            selected={selectedId === c.id}
            label={c.label}
            onClick={() => onSelect(c.id === selectedId ? '' : c.id)}
          >
            <AssetThumb
              thumbnailKey={c.thumbnailKey}
              label={c.label}
              w={88}
              h={88}
              storageBase={storagePublicUrl}
            />
          </PickerTile>
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

export function EditGarmentTypeModal({
  garmentType,
  catalogItems,
  tryonCategories,
  workflows,
  storagePublicUrl,
  onSaved,
  onClose,
  toast,
}: Props) {
  const [label, setLabel] = useState(garmentType.label);
  const [sortOrder, setSortOrder] = useState(garmentType.sortOrder);
  const [requiresLowerUpload, setRequiresLowerUpload] = useState(garmentType.requiresLowerUpload);
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [instructionFile, setInstructionFile] = useState<File | null>(null);
  const [removeInstructionImage, setRemoveInstructionImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);

  useEffect(() => {
    apiFetch<CatalogCategory[]>('/admin/catalog/categories')
      .then(setCategories)
      .catch(() => {});
  }, []);

  const imagePreview = imageFile
    ? URL.createObjectURL(imageFile)
    : garmentType.thumbnailKey && storagePublicUrl
      ? `${storagePublicUrl}/${garmentType.thumbnailKey}`
      : null;
  const instructionPreview = instructionFile
    ? URL.createObjectURL(instructionFile)
    : removeInstructionImage
      ? null
      : (garmentType.instructionImageUrl ?? null);

  const dirty =
    !!imageFile ||
    !!instructionFile ||
    removeInstructionImage ||
    label.trim() !== garmentType.label.trim() ||
    sortOrder !== garmentType.sortOrder ||
    requiresLowerUpload !== garmentType.requiresLowerUpload ||
    defaultLowerId !== (garmentType.defaultLowerCatalogId ?? '') ||
    defaultShoeId !== (garmentType.defaultShoeCatalogId ?? '') ||
    tryonCategoryId !== (garmentType.tryonCategoryId ?? '') ||
    requiresMannequinStep !== (garmentType.requiresMannequinStep ?? false) ||
    mannequinWorkflowTemplateId !== (garmentType.mannequinWorkflowTemplateId ?? '') ||
    sareeStep2WorkflowTemplateId !== (garmentType.sareeStep2WorkflowTemplateId ?? '');

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
      if (label.trim() !== garmentType.label.trim()) patchBody.label = label.trim();
      if (sortOrder !== garmentType.sortOrder) patchBody.sortOrder = sortOrder;
      if (requiresLowerUpload !== garmentType.requiresLowerUpload) {
        patchBody.requiresLowerUpload = requiresLowerUpload;
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
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(780px, calc(100vw - 60px))' }}
      >
        <div className="drawer-head">
          <AssetThumb
            thumbnailKey={garmentType.thumbnailKey ?? undefined}
            label={garmentType.label}
            w={40}
            h={40}
            storageBase={storagePublicUrl}
          />
          <div style={{ minWidth: 0 }}>
            <h2>Edit Garment Type</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span className="badge dot accent">{garmentType.genderSlug}</span>
              <span className="mono sub">{garmentType.slug}</span>
            </div>
          </div>
          <button
            className="btn sm ghost"
            onClick={onClose}
            disabled={saving}
            style={{ marginLeft: 'auto' }}
          >
            <Icon.Close />
          </button>
        </div>

        <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card">
            <div className="card-head">
              <h3>Basic Info</h3>
            </div>
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
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
              <div className="field">
                <label>Tryon Category</label>
                <select
                  className="select"
                  value={tryonCategoryId}
                  disabled={saving}
                  onChange={(e) => setTryonCategoryId(e.target.value)}
                >
                  <option value="">— none —</option>
                  {tryonCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="hint">
                  Maps this garment type to a tryon workflow for the "Browse from Catalog" picker on
                  the tryon page.
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Two-Step Generation</h3>
            </div>
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
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
                    <select
                      className="select"
                      value={mannequinWorkflowTemplateId}
                      disabled={saving}
                      onChange={(e) => setMannequinWorkflowTemplateId(e.target.value)}
                    >
                      <option value="">— none —</option>
                      {workflows
                        .filter((w) => w.workflowType === 'saree_step1' && w.isActive)
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.label} ({w.slug})
                          </option>
                        ))}
                    </select>
                    <span className="hint">
                      Drapes the uploaded garment onto the selected face, once per job.
                    </span>
                  </div>
                  <div className="field">
                    <label>Draping (Step 2) Workflow</label>
                    <select
                      className="select"
                      value={sareeStep2WorkflowTemplateId}
                      disabled={saving}
                      onChange={(e) => setSareeStep2WorkflowTemplateId(e.target.value)}
                    >
                      <option value="">— none —</option>
                      {workflows
                        .filter((w) => w.workflowType === 'regular' && w.isActive)
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.label} ({w.slug})
                          </option>
                        ))}
                    </select>
                    <span className="hint">
                      Used for EVERY pose in a job for this garment type — overrides each pose's own
                      workflow assignment.
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Default Lower Garment</h3>
            </div>
            <div className="card-body flush">
              <ItemPicker
                type="lower"
                gender={garmentType.genderSlug}
                items={catalogItems}
                categories={categories}
                selectedId={defaultLowerId}
                onSelect={setDefaultLowerId}
                storagePublicUrl={storagePublicUrl}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Default Shoe</h3>
            </div>
            <div className="card-body flush">
              <ItemPicker
                type="shoe"
                gender={garmentType.genderSlug}
                items={catalogItems}
                categories={categories}
                selectedId={defaultShoeId}
                onSelect={setDefaultShoeId}
                storagePublicUrl={storagePublicUrl}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Instruction Image</h3>
            </div>
            <div className="card-body">
              <UploadBox
                label="instruction image"
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
            </div>
          </div>
        </div>

        <div className="drawer-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
