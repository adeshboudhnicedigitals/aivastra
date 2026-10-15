import { useEffect, useState } from 'react';
import { AssetThumb } from '../../components/AssetThumb';
import { BatchFaceUploadModal } from '../../components/BatchFaceUploadModal';
import { BatchPoseUploadModal } from '../../components/BatchPoseUploadModal';
import { Icon } from '../../components/Icons';
import { apiErrorMessage, apiFetch } from '../../lib/data';
import type {
  BodyType,
  FaceGarmentMapping,
  ModelFace,
  ModelPoseAsset,
  PoseGarmentTypeConfig,
} from '../../types';
import { useAssetsContext } from './AssetsContext';

type MappingKind = 'faces' | 'poses';

interface MappingState {
  mappedIds: Set<string>;
  hasExplicit: boolean;
}

interface UploadedItem {
  id: string;
  label: string;
  thumbnailUrl?: string | null;
}

const EMPTY_MAPPING: MappingState = { mappedIds: new Set(), hasExplicit: false };

function UploadedGrid({
  items,
  emptyLabel,
  selectedIds,
  onToggleSelect,
  onRemove,
}: {
  items: UploadedItem[];
  emptyLabel: string;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--muted)', padding: '0 16px 16px' }}>{emptyLabel}</p>
    );
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 12,
        padding: '0 16px 16px',
      }}
    >
      {items.map((item) => {
        const selected = selectedIds.has(item.id);
        return (
          <div
            key={item.id}
            className="card"
            style={{
              padding: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              outline: selected ? '2px solid var(--pink)' : undefined,
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
              <AssetThumb thumbnailUrl={item.thumbnailUrl} label={item.label} w={160} h={210} />
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(item.id)}
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
                title={item.label}
              >
                {item.label}
              </p>
              <button
                type="button"
                className="btn danger"
                style={{ width: '100%', marginTop: 8, fontSize: 11, padding: '3px 0' }}
                onClick={() => onRemove(item.id)}
              >
                <Icon.Trash /> Remove
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BodyTypeDetailView({ bodyType }: { bodyType: BodyType }) {
  const { faces, setFaces, toast } = useAssetsContext();

  const [poseAssets, setPoseAssets] = useState<ModelPoseAsset[]>([]);
  const [mappings, setMappings] = useState<Record<MappingKind, MappingState>>({
    faces: EMPTY_MAPPING,
    poses: EMPTY_MAPPING,
  });
  const [loadingMappings, setLoadingMappings] = useState(true);
  const [showFaceUpload, setShowFaceUpload] = useState(false);
  const [showPoseUpload, setShowPoseUpload] = useState(false);
  const [selected, setSelected] = useState<Record<MappingKind, Set<string>>>({
    faces: new Set(),
    poses: new Set(),
  });
  const [bulkSortStart, setBulkSortStart] = useState<Record<MappingKind, number>>({
    faces: 0,
    poses: 0,
  });
  const [bulkSortSaving, setBulkSortSaving] = useState<Record<MappingKind, boolean>>({
    faces: false,
    poses: false,
  });

  // Map selected poses to garment types — same per-pose garment-configs endpoints
  // the Pose Assets tab's bulk "Map to garment types" feature uses, so a mapping
  // made here shows up there too and takes effect in the public studio wizard.
  const [showGarmentMap, setShowGarmentMap] = useState(false);
  const [garmentConfigsByPose, setGarmentConfigsByPose] = useState<
    Record<string, PoseGarmentTypeConfig[]>
  >({});
  const [garmentMapLoading, setGarmentMapLoading] = useState(false);
  const [garmentMapSaving, setGarmentMapSaving] = useState(false);
  const [garmentTypeIdsToMap, setGarmentTypeIdsToMap] = useState<string[]>([]);

  const openGarmentMap = async () => {
    const poseIds = [...selected.poses];
    if (poseIds.length === 0) return;
    setGarmentTypeIdsToMap([]);
    setShowGarmentMap(true);
    setGarmentMapLoading(true);
    try {
      const entries = await Promise.all(
        poseIds.map(async (id) => {
          const res = await apiFetch<{ items: PoseGarmentTypeConfig[] }>(
            `/admin/assets/pose-assets/${id}/garment-configs`,
          );
          return [id, res.items] as const;
        }),
      );
      setGarmentConfigsByPose(Object.fromEntries(entries));
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load garment types',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setGarmentMapLoading(false);
    }
  };

  const doGarmentMap = async (makeVisible: boolean) => {
    const poseIds = [...selected.poses];
    if (garmentTypeIdsToMap.length === 0 || poseIds.length === 0) return;
    setGarmentMapSaving(true);
    try {
      const patches: Promise<unknown>[] = [];
      for (const poseId of poseIds) {
        const configs = garmentConfigsByPose[poseId] ?? [];
        for (const garmentTypeId of garmentTypeIdsToMap) {
          const cfg = configs.find((c) => c.id === garmentTypeId);
          if (!cfg) continue;
          patches.push(
            makeVisible
              ? apiFetch(`/admin/assets/garment-types/${garmentTypeId}/pose-configs/${poseId}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    workflowTemplateId: cfg.config?.workflowTemplateId ?? null,
                    promptGarmentPhase: cfg.config?.promptGarmentPhase ?? null,
                    promptFacePhase: cfg.config?.promptFacePhase ?? null,
                    isActive: true,
                  }),
                })
              : apiFetch(`/admin/assets/garment-types/${garmentTypeId}/pose-configs/${poseId}`, {
                  method: 'DELETE',
                }),
          );
        }
      }
      await Promise.all(patches);
      toast({
        title: `${poseIds.length} pose${poseIds.length !== 1 ? 's' : ''} ${makeVisible ? 'mapped to' : 'unmapped from'} ${garmentTypeIdsToMap.length} garment type${garmentTypeIdsToMap.length !== 1 ? 's' : ''}`,
      });
      setShowGarmentMap(false);
      clearSelected('poses');
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Bulk garment mapping failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setGarmentMapSaving(false);
    }
  };

  const garmentTypeOptionsToMap = Array.from(
    new Map(
      Object.values(garmentConfigsByPose)
        .flat()
        .map((g) => [g.id, g] as const),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));

  // Map selected faces to garment types — model_face_subcategories is a plain
  // opt-out many-to-many join (no per-type overrides like poses have), so writes
  // reuse the existing per-garment-type PUT /faces/:faceId endpoint directly.
  const [showFaceGarmentMap, setShowFaceGarmentMap] = useState(false);
  const [faceGarmentMappingsByFace, setFaceGarmentMappingsByFace] = useState<
    Record<string, FaceGarmentMapping[]>
  >({});
  const [faceGarmentMapLoading, setFaceGarmentMapLoading] = useState(false);
  const [faceGarmentMapSaving, setFaceGarmentMapSaving] = useState(false);
  const [garmentTypeIdsToMapForFaces, setGarmentTypeIdsToMapForFaces] = useState<string[]>([]);

  const openFaceGarmentMap = async () => {
    const faceIds = [...selected.faces];
    if (faceIds.length === 0) return;
    setGarmentTypeIdsToMapForFaces([]);
    setShowFaceGarmentMap(true);
    setFaceGarmentMapLoading(true);
    try {
      const entries = await Promise.all(
        faceIds.map(async (id) => {
          const res = await apiFetch<{ items: FaceGarmentMapping[] }>(
            `/admin/assets/faces/${id}/garment-mappings`,
          );
          return [id, res.items] as const;
        }),
      );
      setFaceGarmentMappingsByFace(Object.fromEntries(entries));
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to load garment types',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setFaceGarmentMapLoading(false);
    }
  };

  const doFaceGarmentMap = async (makeVisible: boolean) => {
    const faceIds = [...selected.faces];
    if (garmentTypeIdsToMapForFaces.length === 0 || faceIds.length === 0) return;
    setFaceGarmentMapSaving(true);
    try {
      const patches: Promise<unknown>[] = [];
      for (const faceId of faceIds) {
        const mappings = faceGarmentMappingsByFace[faceId] ?? [];
        for (const garmentTypeId of garmentTypeIdsToMapForFaces) {
          if (!mappings.some((m) => m.id === garmentTypeId)) continue;
          patches.push(
            apiFetch(`/admin/assets/garment-types/${garmentTypeId}/faces/${faceId}`, {
              method: 'PUT',
              body: JSON.stringify({ mapped: makeVisible }),
            }),
          );
        }
      }
      await Promise.all(patches);
      toast({
        title: `${faceIds.length} face${faceIds.length !== 1 ? 's' : ''} ${makeVisible ? 'mapped to' : 'unmapped from'} ${garmentTypeIdsToMapForFaces.length} garment type${garmentTypeIdsToMapForFaces.length !== 1 ? 's' : ''}`,
      });
      setShowFaceGarmentMap(false);
      clearSelected('faces');
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Bulk garment mapping failed',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setFaceGarmentMapSaving(false);
    }
  };

  const garmentTypeOptionsToMapForFaces = Array.from(
    new Map(
      Object.values(faceGarmentMappingsByFace)
        .flat()
        .map((g) => [g.id, g] as const),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));

  const toggleSelected = (kind: MappingKind, id: string) => {
    setSelected((prev) => {
      const next = new Set(prev[kind]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [kind]: next };
    });
  };

  const clearSelected = (kind: MappingKind) => {
    setSelected((prev) => ({ ...prev, [kind]: new Set() }));
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingMappings(true);
    Promise.all([
      apiFetch<{ mappedFaceIds: string[]; hasExplicitFaceMappings: boolean }>(
        `/admin/assets/body-types/${bodyType.id}/face-mappings`,
      ),
      apiFetch<{ mappedPoseAssetIds: string[]; hasExplicitPoseMappings: boolean }>(
        `/admin/assets/body-types/${bodyType.id}/pose-mappings`,
      ),
      apiFetch<{ items: ModelPoseAsset[] }>('/admin/assets/pose-assets'),
    ])
      .then(([faceRes, poseRes, poseAssetsRes]) => {
        if (cancelled) return;
        setMappings({
          faces: {
            mappedIds: new Set(faceRes.mappedFaceIds),
            hasExplicit: faceRes.hasExplicitFaceMappings,
          },
          poses: {
            mappedIds: new Set(poseRes.mappedPoseAssetIds),
            hasExplicit: poseRes.hasExplicitPoseMappings,
          },
        });
        setPoseAssets(poseAssetsRes.items);
      })
      .catch((e) => {
        if (cancelled) return;
        toast({
          kind: 'error',
          title: 'Failed to load mappings',
          body: apiErrorMessage(e, 'Please try again.'),
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingMappings(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bodyType.id, toast]);

  const putMapping = async (kind: MappingKind, itemId: string, mapped: boolean) => {
    await apiFetch(`/admin/assets/body-types/${bodyType.id}/${kind}/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ mapped }),
    });
  };

  const toggleMapped = (kind: MappingKind, itemId: string) => {
    const wasMapped = mappings[kind].mappedIds.has(itemId);
    setMappings((prev) => {
      const next = new Set(prev[kind].mappedIds);
      if (wasMapped) next.delete(itemId);
      else next.add(itemId);
      return { ...prev, [kind]: { mappedIds: next, hasExplicit: true } };
    });
    if (wasMapped) {
      setSelected((prev) => {
        const next = new Set(prev[kind]);
        next.delete(itemId);
        return { ...prev, [kind]: next };
      });
    }
    putMapping(kind, itemId, !wasMapped).catch((e) => {
      setMappings((prev) => {
        const next = new Set(prev[kind].mappedIds);
        if (wasMapped) next.add(itemId);
        else next.delete(itemId);
        return { ...prev, [kind]: { ...prev[kind], mappedIds: next } };
      });
      toast({
        kind: 'error',
        title: 'Failed to update mapping',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    });
  };

  const bulkSetMapped = (kind: MappingKind, itemIds: string[], mapped: boolean) => {
    const prevMapped = mappings[kind].mappedIds;
    setMappings((prev) => {
      const next = new Set(prev[kind].mappedIds);
      for (const id of itemIds) {
        if (mapped) next.add(id);
        else next.delete(id);
      }
      return { ...prev, [kind]: { mappedIds: next, hasExplicit: true } };
    });
    Promise.all(itemIds.map((id) => putMapping(kind, id, mapped))).catch((e) => {
      setMappings((prev) => ({ ...prev, [kind]: { ...prev[kind], mappedIds: prevMapped } }));
      toast({
        kind: 'error',
        title: 'Failed to update mappings',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    });
  };

  const doBulkSort = async (kind: MappingKind, orderedIds: string[]) => {
    if (orderedIds.length === 0) return;
    setBulkSortSaving((prev) => ({ ...prev, [kind]: true }));
    const entries = orderedIds.map((id, i) => ({ id, sortOrder: bulkSortStart[kind] + i }));
    try {
      await Promise.all(
        entries.map(({ id, sortOrder }) =>
          apiFetch(
            kind === 'faces' ? `/admin/assets/faces/${id}` : `/admin/assets/pose-assets/${id}`,
            { method: 'PATCH', body: JSON.stringify({ sortOrder }) },
          ),
        ),
      );
      if (kind === 'faces') {
        setFaces((prev) =>
          prev.map((f) => {
            const entry = entries.find((e) => e.id === f.id);
            return entry ? { ...f, sortOrder: entry.sortOrder } : f;
          }),
        );
      } else {
        setPoseAssets((prev) =>
          prev.map((p) => {
            const entry = entries.find((e) => e.id === p.id);
            return entry ? { ...p, sortOrder: entry.sortOrder } : p;
          }),
        );
      }
      toast({
        title: `Sort order updated for ${entries.length} ${kind === 'faces' ? 'face' : 'pose'}${entries.length !== 1 ? 's' : ''}`,
      });
      clearSelected(kind);
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Failed to update sort order',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    } finally {
      setBulkSortSaving((prev) => ({ ...prev, [kind]: false }));
    }
  };

  const mapNewUploads = async (kind: MappingKind, ids: string[]) => {
    setMappings((prev) => ({
      ...prev,
      [kind]: { mappedIds: new Set([...prev[kind].mappedIds, ...ids]), hasExplicit: true },
    }));
    try {
      await Promise.all(ids.map((id) => putMapping(kind, id, true)));
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Uploaded but failed to map to this body type',
        body: apiErrorMessage(e, 'Please try again.'),
      });
    }
  };

  const onFacesUploaded = (added: ModelFace[]) => {
    setFaces((prev) => [...prev, ...added]);
    setShowFaceUpload(false);
    void mapNewUploads(
      'faces',
      added.map((f) => f.id),
    );
  };

  const onPosesUploaded = (added: ModelPoseAsset[]) => {
    setPoseAssets((prev) => [...prev, ...added]);
    setShowPoseUpload(false);
    void mapNewUploads(
      'poses',
      added.map((p) => p.id),
    );
  };

  if (loadingMappings) {
    return <p style={{ color: 'var(--muted)', marginTop: 24 }}>Loading mappings…</p>;
  }

  const faceItems: UploadedItem[] = faces
    .filter((f) => f.isActive && f.gender === bodyType.genderSlug)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => ({ id: f.id, label: f.label, thumbnailUrl: f.thumbnailUrl }));
  const mappedFaceItems = faceItems.filter((i) => mappings.faces.mappedIds.has(i.id));

  const poseItems: UploadedItem[] = poseAssets
    .filter((p) => p.isActive && p.genderSlug === bodyType.genderSlug)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({ id: p.id, label: p.displayName ?? p.label, thumbnailUrl: p.thumbnailUrl }));
  const mappedPoseItems = poseItems.filter((i) => mappings.poses.mappedIds.has(i.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 12 }}>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '12px 16px 0',
            gap: 10,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 14 }}>Faces</h3>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '2px 0 10px' }}>
              {mappings.faces.hasExplicit
                ? `${mappings.faces.mappedIds.size} uploaded for this body type — only these show for it.`
                : 'No explicit mappings yet — every active face of this gender shows by default.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            {mappedFaceItems.length > 0 && (
              <button
                type="button"
                className="btn xs ghost"
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={() =>
                  setSelected((prev) => ({
                    ...prev,
                    faces: mappedFaceItems.every((i) => prev.faces.has(i.id))
                      ? new Set()
                      : new Set(mappedFaceItems.map((i) => i.id)),
                  }))
                }
              >
                {mappedFaceItems.every((i) => selected.faces.has(i.id))
                  ? 'Deselect all'
                  : 'Select all'}
              </button>
            )}
            {selected.faces.size > 0 && (
              <button
                type="button"
                className="btn xs ghost"
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={() => void openFaceGarmentMap()}
              >
                <Icon.Catalog /> Map to garment types ({selected.faces.size})
              </button>
            )}
            {selected.faces.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  Sort from
                </span>
                <input
                  type="number"
                  className="input"
                  min={0}
                  step={1}
                  value={bulkSortStart.faces}
                  disabled={bulkSortSaving.faces}
                  onChange={(e) =>
                    setBulkSortStart((prev) => ({ ...prev, faces: Number(e.target.value) }))
                  }
                  style={{ width: 64, padding: '3px 6px', fontSize: 12, height: 28 }}
                />
                <button
                  type="button"
                  className="btn xs"
                  disabled={bulkSortSaving.faces}
                  onClick={() =>
                    void doBulkSort(
                      'faces',
                      mappedFaceItems.filter((i) => selected.faces.has(i.id)).map((i) => i.id),
                    )
                  }
                >
                  {bulkSortSaving.faces ? 'Saving…' : `Apply (${selected.faces.size})`}
                </button>
              </div>
            )}
            {selected.faces.size > 0 && (
              <button
                type="button"
                className="btn xs danger"
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={() => {
                  bulkSetMapped('faces', [...selected.faces], false);
                  clearSelected('faces');
                }}
              >
                <Icon.Trash /> Remove selected ({selected.faces.size})
              </button>
            )}
            {mappedFaceItems.length > 0 && (
              <button
                type="button"
                className="btn xs danger"
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={() => {
                  bulkSetMapped(
                    'faces',
                    mappedFaceItems.map((i) => i.id),
                    false,
                  );
                  clearSelected('faces');
                }}
              >
                <Icon.Trash /> Remove all
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              onClick={() => setShowFaceUpload(true)}
            >
              <Icon.Add /> Bulk upload face
            </button>
          </div>
        </div>
        <UploadedGrid
          items={mappedFaceItems}
          emptyLabel="No faces uploaded yet for this body type."
          selectedIds={selected.faces}
          onToggleSelect={(id) => toggleSelected('faces', id)}
          onRemove={(id) => toggleMapped('faces', id)}
        />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '12px 16px 0',
            gap: 10,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 14 }}>Poses</h3>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '2px 0 10px' }}>
              {mappings.poses.hasExplicit
                ? `${mappings.poses.mappedIds.size} uploaded for this body type — only these show for it.`
                : 'No explicit mappings yet — every active pose of this gender shows by default.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            {mappedPoseItems.length > 0 && (
              <button
                type="button"
                className="btn xs ghost"
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={() =>
                  setSelected((prev) => ({
                    ...prev,
                    poses: mappedPoseItems.every((i) => prev.poses.has(i.id))
                      ? new Set()
                      : new Set(mappedPoseItems.map((i) => i.id)),
                  }))
                }
              >
                {mappedPoseItems.every((i) => selected.poses.has(i.id))
                  ? 'Deselect all'
                  : 'Select all'}
              </button>
            )}
            {selected.poses.size > 0 && (
              <button
                type="button"
                className="btn xs ghost"
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={() => void openGarmentMap()}
              >
                <Icon.Catalog /> Map to garment types ({selected.poses.size})
              </button>
            )}
            {selected.poses.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  Sort from
                </span>
                <input
                  type="number"
                  className="input"
                  min={0}
                  step={1}
                  value={bulkSortStart.poses}
                  disabled={bulkSortSaving.poses}
                  onChange={(e) =>
                    setBulkSortStart((prev) => ({ ...prev, poses: Number(e.target.value) }))
                  }
                  style={{ width: 64, padding: '3px 6px', fontSize: 12, height: 28 }}
                />
                <button
                  type="button"
                  className="btn xs"
                  disabled={bulkSortSaving.poses}
                  onClick={() =>
                    void doBulkSort(
                      'poses',
                      mappedPoseItems.filter((i) => selected.poses.has(i.id)).map((i) => i.id),
                    )
                  }
                >
                  {bulkSortSaving.poses ? 'Saving…' : `Apply (${selected.poses.size})`}
                </button>
              </div>
            )}
            {selected.poses.size > 0 && (
              <button
                type="button"
                className="btn xs danger"
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={() => {
                  bulkSetMapped('poses', [...selected.poses], false);
                  clearSelected('poses');
                }}
              >
                <Icon.Trash /> Remove selected ({selected.poses.size})
              </button>
            )}
            {mappedPoseItems.length > 0 && (
              <button
                type="button"
                className="btn xs danger"
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={() => {
                  bulkSetMapped(
                    'poses',
                    mappedPoseItems.map((i) => i.id),
                    false,
                  );
                  clearSelected('poses');
                }}
              >
                <Icon.Trash /> Remove all
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              onClick={() => setShowPoseUpload(true)}
            >
              <Icon.Add /> Bulk upload pose
            </button>
          </div>
        </div>
        <UploadedGrid
          items={mappedPoseItems}
          emptyLabel="No poses uploaded yet for this body type."
          selectedIds={selected.poses}
          onToggleSelect={(id) => toggleSelected('poses', id)}
          onRemove={(id) => toggleMapped('poses', id)}
        />
      </div>

      {showFaceUpload && (
        <BatchFaceUploadModal
          genderSlug={bodyType.genderSlug}
          onDone={onFacesUploaded}
          onClose={() => setShowFaceUpload(false)}
          toast={toast}
        />
      )}
      {showPoseUpload && (
        <BatchPoseUploadModal
          genderSlug={bodyType.genderSlug}
          onDone={onPosesUploaded}
          onClose={() => setShowPoseUpload(false)}
          toast={toast}
        />
      )}

      {showGarmentMap && (
        <div
          className="modal-overlay"
          onClick={() => !garmentMapSaving && setShowGarmentMap(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <h3>
                Map {selected.poses.size} pose{selected.poses.size !== 1 ? 's' : ''} to garment
                types
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                Select garment types, then show or hide the selected poses on them. A pose already
                shows on every garment type of its gender by default. This is the same mapping used
                by Pose Assets → Map to garment types, and takes effect in the studio wizard.
              </p>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {garmentMapLoading ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Loading garment types…</p>
              ) : garmentTypeOptionsToMap.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                  No garment types found for the selected poses.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn sm ghost"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() =>
                      setGarmentTypeIdsToMap((prev) =>
                        prev.length === garmentTypeOptionsToMap.length
                          ? []
                          : garmentTypeOptionsToMap.map((g) => g.id),
                      )
                    }
                  >
                    {garmentTypeIdsToMap.length === garmentTypeOptionsToMap.length
                      ? 'Deselect all'
                      : 'Select all'}
                  </button>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      maxHeight: 280,
                      overflowY: 'auto',
                    }}
                  >
                    {garmentTypeOptionsToMap.map((g) => (
                      <label
                        key={g.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: 'var(--surface-2)',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={garmentTypeIdsToMap.includes(g.id)}
                          onChange={(e) =>
                            setGarmentTypeIdsToMap((prev) =>
                              e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id),
                            )
                          }
                        />
                        {g.label}
                        {g.genderSlug && (
                          <span className="badge dot accent" style={{ fontSize: 10 }}>
                            {g.genderSlug}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn ghost"
                disabled={garmentMapSaving}
                onClick={() => setShowGarmentMap(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={garmentMapSaving || garmentTypeIdsToMap.length === 0}
                onClick={() => void doGarmentMap(false)}
              >
                {garmentMapSaving ? 'Saving…' : `Unmap from ${garmentTypeIdsToMap.length}`}
              </button>
              <button
                type="button"
                className="btn"
                disabled={garmentMapSaving || garmentTypeIdsToMap.length === 0}
                onClick={() => void doGarmentMap(true)}
              >
                {garmentMapSaving ? 'Saving…' : `Map to ${garmentTypeIdsToMap.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFaceGarmentMap && (
        <div
          className="modal-overlay"
          onClick={() => !faceGarmentMapSaving && setShowFaceGarmentMap(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <h3>
                Map {selected.faces.size} face{selected.faces.size !== 1 ? 's' : ''} to garment
                types
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                Select garment types, then show or hide the selected faces on them. A face already
                shows on every garment type of its gender by default. This takes effect in the
                studio wizard.
              </p>
            </div>
            <div
              className="modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {faceGarmentMapLoading ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Loading garment types…</p>
              ) : garmentTypeOptionsToMapForFaces.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                  No garment types found for the selected faces.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn sm ghost"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() =>
                      setGarmentTypeIdsToMapForFaces((prev) =>
                        prev.length === garmentTypeOptionsToMapForFaces.length
                          ? []
                          : garmentTypeOptionsToMapForFaces.map((g) => g.id),
                      )
                    }
                  >
                    {garmentTypeIdsToMapForFaces.length === garmentTypeOptionsToMapForFaces.length
                      ? 'Deselect all'
                      : 'Select all'}
                  </button>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      maxHeight: 280,
                      overflowY: 'auto',
                    }}
                  >
                    {garmentTypeOptionsToMapForFaces.map((g) => (
                      <label
                        key={g.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: 'var(--surface-2)',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={garmentTypeIdsToMapForFaces.includes(g.id)}
                          onChange={(e) =>
                            setGarmentTypeIdsToMapForFaces((prev) =>
                              e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id),
                            )
                          }
                        />
                        {g.label}
                        {g.genderSlug && (
                          <span className="badge dot accent" style={{ fontSize: 10 }}>
                            {g.genderSlug}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn ghost"
                disabled={faceGarmentMapSaving}
                onClick={() => setShowFaceGarmentMap(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={faceGarmentMapSaving || garmentTypeIdsToMapForFaces.length === 0}
                onClick={() => void doFaceGarmentMap(false)}
              >
                {faceGarmentMapSaving
                  ? 'Saving…'
                  : `Unmap from ${garmentTypeIdsToMapForFaces.length}`}
              </button>
              <button
                type="button"
                className="btn"
                disabled={faceGarmentMapSaving || garmentTypeIdsToMapForFaces.length === 0}
                onClick={() => void doFaceGarmentMap(true)}
              >
                {faceGarmentMapSaving ? 'Saving…' : `Map to ${garmentTypeIdsToMapForFaces.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
