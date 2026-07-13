import { useCallback, useEffect, useState } from 'react';
import { EditCatalogueTemplateModal } from '../../components/EditCatalogueTemplateModal';
import { Icon } from '../../components/Icons';
import { Switch } from '../../components/Switch';
import { apiFetch } from '../../lib/data';
import type {
  CatalogueTemplate,
  GarmentType,
  ModelBackground,
  ModelPoseAsset,
  TemplateGarmentTypeMapping,
} from '../../types';
import { useAssetsContext } from './AssetsContext';

const GENDER_TABS = [
  { k: 'all' as const, l: 'All' },
  { k: 'men' as const, l: 'Men' },
  { k: 'women' as const, l: 'Women' },
  { k: 'boys' as const, l: 'Boys' },
  { k: 'girls' as const, l: 'Girls' },
];

type SubView = { kind: 'grid' } | { kind: 'mapping' };

export function CatalogueTemplatesTab() {
  const { genderFilter, setGenderFilter, garmentTypes, loading, setLoading, toast } =
    useAssetsContext();

  const [subView, setSubView] = useState<SubView>({ kind: 'grid' });
  const [templates, setTemplates] = useState<CatalogueTemplate[]>([]);
  const [poseAssets, setPoseAssets] = useState<ModelPoseAsset[]>([]);
  // Own copy, fetched with scope=all — the shared AssetsContext.allBackgrounds is
  // scope-filtered (general only) for the Backgrounds tab, but this tab needs
  // template-scoped assets too, to resolve thumbnails for a template's own looks.
  const [backgrounds, setBackgrounds] = useState<ModelBackground[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<CatalogueTemplate | null | 'new'>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [templatesRes, poseAssetsRes, backgroundsRes] = await Promise.all([
        apiFetch<{ items: CatalogueTemplate[] }>('/admin/assets/catalogue-templates'),
        apiFetch<{ items: ModelPoseAsset[] }>('/admin/assets/pose-assets?scope=all'),
        apiFetch<{ items: ModelBackground[] }>('/admin/assets/backgrounds?scope=all'),
      ]);
      setTemplates(templatesRes.items);
      setPoseAssets(poseAssetsRes.items);
      setBackgrounds(backgroundsRes.items);
    } catch {
      toast({ kind: 'error', title: 'Failed to load catalogue templates' });
    } finally {
      setLoading(false);
    }
  }, [toast, setLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (t: CatalogueTemplate) => {
    const next = !t.isActive;
    setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, isActive: next } : x)));
    try {
      await apiFetch(`/admin/assets/catalogue-templates/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
    } catch {
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, isActive: t.isActive } : x)));
      toast({ kind: 'error', title: 'Failed to update template' });
    }
  };

  const doDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    try {
      await apiFetch(`/admin/assets/catalogue-templates/${id}`, { method: 'DELETE' });
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast({ title: 'Template deleted' });
    } catch (e) {
      toast({ kind: 'error', title: 'Delete failed', body: (e as Error).message });
    }
  };

  const filtered = templates.filter((t) => genderFilter === 'all' || t.genderSlug === genderFilter);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Catalogue Templates</h1>
          <p className="lede">
            {subView.kind === 'grid'
              ? 'Curated (pose, background) look sets. Users pick a template on the studio page instead of manually choosing a background and poses.'
              : 'Pick a garment type to choose which templates are offered for it. A template offered for no garment type is never shown to users.'}
          </p>
        </div>
        <div className="head-tools">
          {subView.kind === 'grid' ? (
            <>
              <button className="btn ghost" onClick={() => setSubView({ kind: 'mapping' })}>
                Garment Type Mapping
              </button>
              <button className="btn ghost" onClick={() => setEditingTemplate('new')}>
                <Icon.Add /> New template
              </button>
            </>
          ) : (
            <button className="btn ghost" onClick={() => setSubView({ kind: 'grid' })}>
              <Icon.ArrowLeft /> Back to templates
            </button>
          )}
        </div>
      </div>

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

      {subView.kind === 'mapping' && (
        <TemplateGarmentMappingPanel
          garmentTypes={garmentTypes}
          genderFilter={genderFilter}
          toast={toast}
        />
      )}

      {subView.kind === 'grid' &&
        !loading &&
        (filtered.length === 0 ? (
          <p style={{ color: 'var(--muted)', marginTop: 24 }}>
            No catalogue templates for this gender.
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            {filtered.map((t) => (
              <div
                key={t.id}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  opacity: t.isActive ? 1 : 0.55,
                }}
              >
                <div
                  style={{
                    background: 'var(--surface2, #1a1a1a)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    aspectRatio: '3/4',
                  }}
                >
                  {t.thumbnailUrl ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={t.thumbnailUrl}
                      alt={t.label}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <Icon.Image />
                  )}
                </div>
                <div style={{ padding: '8px 8px 10px' }}>
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={t.label}
                  >
                    {t.label}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
                    {t.lookCount} look{t.lookCount !== 1 ? 's' : ''} · {t.genderSlug}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 8,
                    }}
                  >
                    <Switch checked={t.isActive} onChange={() => void toggleActive(t)} />
                    <button
                      className="btn ghost"
                      style={{ fontSize: 10, padding: '3px 8px' }}
                      onClick={() => setEditingTemplate(t)}
                    >
                      <Icon.Edit /> Edit
                    </button>
                  </div>
                  <button
                    className="btn danger"
                    style={{ width: '100%', marginTop: 4, fontSize: 11, padding: '3px 0' }}
                    onClick={() => setConfirmDeleteId(t.id)}
                  >
                    <Icon.Trash /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}

      {confirmDeleteId && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Delete catalogue template</h3>
            </div>
            <div className="modal-body">
              <p>Delete this template? Studio users will no longer see it.</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button className="btn danger" onClick={doDelete}>
                <Icon.Trash /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTemplate !== null && (
        <EditCatalogueTemplateModal
          template={editingTemplate === 'new' ? null : editingTemplate}
          defaultGenderSlug={genderFilter === 'all' ? 'men' : genderFilter}
          poseAssets={poseAssets}
          backgrounds={backgrounds}
          onSaved={() => void load()}
          onClose={() => setEditingTemplate(null)}
          toast={toast}
        />
      )}
    </>
  );
}

// ── TemplateGarmentMappingPanel ─────────────────────────────────────────────

interface TemplateGarmentMappingPanelProps {
  garmentTypes: GarmentType[];
  genderFilter: 'all' | 'men' | 'women' | 'boys' | 'girls';
  toast: (opts: { kind?: 'error'; title: string; body?: string }) => void;
}

function TemplateGarmentMappingPanel({
  garmentTypes,
  genderFilter,
  toast,
}: TemplateGarmentMappingPanelProps) {
  const [selectedGarmentType, setSelectedGarmentType] = useState<GarmentType | null>(null);
  const [items, setItems] = useState<TemplateGarmentTypeMapping[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadItems = useCallback(
    async (garmentTypeId: string) => {
      setItemsLoading(true);
      try {
        const res = await apiFetch<{ items: TemplateGarmentTypeMapping[] }>(
          `/admin/assets/garment-types/${garmentTypeId}/templates`,
        );
        setItems(res.items);
      } catch {
        toast({ kind: 'error', title: 'Failed to load template mapping' });
      } finally {
        setItemsLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (selectedGarmentType) void loadItems(selectedGarmentType.id);
  }, [selectedGarmentType, loadItems]);

  const toggleMapped = async (templateId: string, mapped: boolean) => {
    if (!selectedGarmentType) return;
    setSavingId(templateId);
    const prev = items;
    setItems((cur) => cur.map((i) => (i.id === templateId ? { ...i, mapped } : i)));
    try {
      await apiFetch(
        `/admin/assets/garment-types/${selectedGarmentType.id}/templates/${templateId}`,
        { method: 'PATCH', body: JSON.stringify({ mapped }) },
      );
    } catch {
      setItems(prev);
      toast({ kind: 'error', title: 'Failed to update mapping' });
    } finally {
      setSavingId(null);
    }
  };

  const filteredGarmentTypes = garmentTypes.filter(
    (g) => genderFilter === 'all' || g.genderSlug === genderFilter,
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, marginTop: 12 }}>
      <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Garment Type</th>
            </tr>
          </thead>
          <tbody>
            {filteredGarmentTypes.map((g) => (
              <tr
                key={g.id}
                style={{
                  cursor: 'pointer',
                  background:
                    selectedGarmentType?.id === g.id ? 'var(--surface2, #1a1a1a)' : undefined,
                }}
                onClick={() => setSelectedGarmentType(g)}
              >
                <td>
                  <span className="semi">{g.label}</span>
                  <span className="sub mono" style={{ display: 'block' }}>
                    {g.genderSlug} / {g.slug}
                  </span>
                </td>
              </tr>
            ))}
            {filteredGarmentTypes.length === 0 && (
              <tr>
                <td style={{ textAlign: 'center', color: 'var(--muted)', padding: '1.5rem' }}>
                  No garment types for this gender.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        {!selectedGarmentType ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
            Select a garment type to see which templates are offered for it.
          </div>
        ) : itemsLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
            No templates for {selectedGarmentType.genderSlug}.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {items.map((item) => (
              <div
                key={item.id}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  outline: item.mapped ? '2px solid var(--pink)' : undefined,
                }}
              >
                <div
                  style={{
                    background: 'var(--surface2, #1a1a1a)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    aspectRatio: '3/4',
                  }}
                >
                  {item.thumbnailUrl ? (
                    // biome-ignore lint/performance/noImgElement: admin panel
                    <img
                      src={item.thumbnailUrl}
                      alt={item.label}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <Icon.Image />
                  )}
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
                    title={item.label}
                  >
                    {item.label}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 8,
                    }}
                  >
                    <Switch
                      checked={item.mapped}
                      onChange={() => void toggleMapped(item.id, !item.mapped)}
                    />
                    {savingId === item.id && (
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>Saving…</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
