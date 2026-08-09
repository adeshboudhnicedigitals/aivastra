'use client';
import { DEFAULT_MAX_BATCH_JOBS } from '@aivastra/types';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { C } from '@/components/tokens';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { BatchGrid } from './batch-grid';
import type { PickerItem } from './batch-row';
import { GarmentTray } from './garment-tray';
import { SummaryBar } from './summary-bar';
import type { PoseOption, TrayGarment } from './types';
import { batchIssues, useBatchState } from './use-batch-state';

// Local copy of the studio page's catalog-tree shape. /v1/catalog/:type
// (apps/api/src/modules/catalog/routes.ts) returns a category tree, not a flat
// item list — page.tsx and the embed wizard each keep their own
// CatalogNode/flattenNode pair rather than sharing one, so this follows the
// same established pattern instead of introducing a new shared module.
interface CatalogTreeNode {
  id: number;
  label: string;
  thumbnailUrl?: string | null;
  children: CatalogTreeNode[];
  items: PickerItem[];
}
function flattenCatalogTree(node: CatalogTreeNode): PickerItem[] {
  return [...node.items, ...node.children.flatMap((c) => flattenCatalogTree(c))];
}

/**
 * Mirrors CreateBatchJobRequest.aspectRatio (packages/types/src/batch.ts). The
 * page's own ALL_ASPECTS list is wider (it includes 9:16 / 16:9 / custom), and
 * batch mode has no aspect control to correct a selection with, so an
 * unsupported ratio is surfaced as a blocking reason rather than a 400.
 */
const BATCH_ASPECTS = ['1:1', '2:3', '3:4', '4:5'];

/** Pulls the row index off a row-attributed API error envelope, if present. */
function errorRowIndex(err: unknown): number | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body;
  if (!body || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const rowIndex = (error as { rowIndex?: unknown }).rowIndex;
  return typeof rowIndex === 'number' ? rowIndex : null;
}

export function BatchMode({
  gender,
  garmentTypeId,
  defaultFaceId,
  aspectRatio,
  resolution,
  platform,
  params,
  creditCostPerImage,
  balance,
  onDirtyChange,
}: {
  gender: string;
  garmentTypeId: string;
  defaultFaceId: string;
  aspectRatio: string;
  resolution: string;
  platform?: string;
  /**
   * Custom output dimensions, mirroring CreateBatchJobRequest.params
   * (packages/types/src/batch.ts) — only meaningful when the page's aspect is
   * 'custom'. Omitted entirely (not sent as undefined fields) when the page
   * isn't in custom-dims mode, matching how the single-mode submit builds its
   * own `params` object.
   */
  params?: { outputWidth: number; outputHeight: number };
  creditCostPerImage: number;
  balance: number | null;
  /** Lets the page warn before switching away from Batch and losing this work. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [garments, setGarments] = useState<TrayGarment[]>([]);
  const [selectedGarmentId, setSelectedGarmentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  /** Row the server named via error.rowIndex on the last failed submit. */
  const [rejectedRowId, setRejectedRowId] = useState<string | null>(null);
  const {
    rows,
    addRow,
    duplicateRow,
    removeRow,
    patchRow,
    setPoses,
    clearGarmentFromRows,
    resetRows,
  } = useBatchState(defaultFaceId);

  // /v1/models/faces only accepts `gender` (see apps/api/src/modules/models/routes.ts) —
  // it has no garmentTypeId param, and its response is `{ items: [...] }`, matching
  // the query the existing single-mode wizard (studio/page.tsx) already makes.
  const faces = useQuery({
    queryKey: ['batch-faces', gender],
    queryFn: async () =>
      (await api.get<{ items: PickerItem[] }>(`/v1/models/faces?gender=${gender}`)).items,
    enabled: !!gender,
  });
  // /v1/models/backgrounds has no faceId param either — it filters by `gender`,
  // same as studio/page.tsx's backgrounds query.
  const backgrounds = useQuery({
    queryKey: ['batch-backgrounds', gender],
    queryFn: async () =>
      (await api.get<{ items: PickerItem[] }>(`/v1/models/backgrounds?gender=${gender}`)).items,
    enabled: !!gender,
  });
  const poses = useQuery({
    queryKey: ['batch-poses', gender, garmentTypeId],
    queryFn: async () =>
      (
        await api.get<{ items: Array<PickerItem & PoseOption> }>(
          `/v1/models/poses?gender=${gender}&garmentTypeId=${garmentTypeId}`,
        )
      ).items,
    enabled: !!gender && !!garmentTypeId,
  });
  // /v1/catalog/lower and /v1/catalog/shoe return a category tree scoped by
  // gender (poseIds is omitted here — a batch row's pose selection is per-row,
  // not a single grid-wide value, so there is no one poseIds list to pass; this
  // falls back to the same "all active items for this gender" path the legacy,
  // no-poseIds branch of that route already serves).
  const lowerItems = useQuery({
    queryKey: ['batch-lower', gender],
    queryFn: async () => {
      const res = await api.get<{ tree: CatalogTreeNode[] }>(`/v1/catalog/lower?gender=${gender}`);
      return res.tree.flatMap(flattenCatalogTree);
    },
    enabled: !!gender,
  });
  const shoeItems = useQuery({
    queryKey: ['batch-shoe', gender],
    queryFn: async () => {
      const res = await api.get<{ tree: CatalogTreeNode[] }>(`/v1/catalog/shoe?gender=${gender}`);
      return res.tree.flatMap(flattenCatalogTree);
    },
    enabled: !!gender,
  });

  const poseOptions = useMemo(() => poses.data ?? [], [poses.data]);
  const { invalidRowIds, totalJobs } = batchIssues(rows, poseOptions);

  // Any uploaded/uploading garment or any row with real progress (a pose picked,
  // or a garment attached) counts as work the mode toggle would otherwise
  // silently destroy by unmounting this component.
  const isDirty = garments.length > 0 || rows.some((r) => r.poseIds.length > 0 || !!r.garmentId);
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const onAddGarments = useCallback((added: TrayGarment[]) => {
    setGarments((prev) => [...prev, ...added]);
  }, []);
  const onPatchGarment = useCallback((id: string, patch: Partial<TrayGarment>) => {
    setGarments((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }, []);
  const onRemoveGarment = useCallback(
    (id: string) => {
      setGarments((prev) => prev.filter((g) => g.id !== id));
      // Rows still pointing at the removed tile would otherwise stay "complete".
      clearGarmentFromRows(id);
    },
    [clearGarmentFromRows],
  );

  // Pose availability is scoped to the garment type — /v1/models/poses?garmentTypeId=
  // returns a different set, and pose_garment_configs can deactivate a pose for one
  // type specifically. Leaving stale pose ids in the rows would submit combinations
  // the API rejects with a BAD_CATALOG naming a row the user never touched.
  const [confirmingTypeChange, setConfirmingTypeChange] = useState<string | null>(null);
  const [appliedGarmentTypeId, setAppliedGarmentTypeId] = useState(garmentTypeId);

  // Changing the type mid-grid throws away work, so ask first rather than
  // silently emptying the rows the user just filled in.
  useEffect(() => {
    if (garmentTypeId === appliedGarmentTypeId) return;
    const hasWork = rows.some((r) => r.poseIds.length > 0 || r.garmentId);
    if (!hasWork) {
      setAppliedGarmentTypeId(garmentTypeId);
      resetRows();
      return;
    }
    setConfirmingTypeChange(garmentTypeId);
  }, [garmentTypeId, appliedGarmentTypeId, rows, resetRows]);

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    setRejectedRowId(null);
    try {
      // Rows carry a client-side garment id; the API takes the R2 key. rowIssues
      // only checks that a row *has* a garmentId, not that its upload finished —
      // a row can still point at a garment whose r2Key hasn't landed yet, so this
      // throw is genuinely reachable, not just defensive.
      const payloadRows = rows.map((row) => {
        const garment = garments.find((g) => g.id === row.garmentId);
        if (!garment?.r2Key) throw new Error('A garment is still uploading');
        return {
          upperGarmentKey: garment.r2Key,
          faceId: row.faceId,
          backgroundId: row.backgroundId,
          poseIds: row.poseIds,
          ...(row.lowerCatalogId ? { lowerCatalogId: row.lowerCatalogId } : {}),
          ...(row.shoeCatalogId ? { shoeCatalogId: row.shoeCatalogId } : {}),
        };
      });

      const result = await api.post<{ batchId: string }>('/v1/jobs/batch', {
        garmentTypeId,
        aspectRatio,
        resolution,
        ...(platform ? { platform } : {}),
        ...(params ? { params } : {}),
        rows: payloadRows,
      });
      router.push(`/catalogues?batch=${result.batchId}`);
    } catch (e) {
      // The API attributes row-scoped rejections with error.rowIndex (see
      // withRowIndex in apps/api/src/lib/errors.ts). Light up that row with the
      // same treatment client-side validation uses, so "pose not found" points
      // at a row instead of at the whole grid.
      const rowIndex = errorRowIndex(e);
      const rejected = rowIndex !== null ? rows[rowIndex] : undefined;
      setRejectedRowId(rejected?.id ?? null);
      const message = (e as Error).message || 'Batch submission failed';
      setError(rejected && rowIndex !== null ? `Row ${rowIndex + 1}: ${message}` : message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <GarmentTray
        garments={garments}
        onAdd={onAddGarments}
        onPatch={onPatchGarment}
        onRemove={onRemoveGarment}
        selectedGarmentId={selectedGarmentId}
        onSelect={setSelectedGarmentId}
      />

      {confirmingTypeChange && (
        <div
          role="alertdialog"
          style={{ padding: 12, border: `1px solid ${C.pink}`, borderRadius: 8, marginTop: 16 }}
        >
          <p style={{ margin: 0, color: C.text }}>
            Changing the garment type clears every row — poses differ per type.
          </p>
          <button
            type="button"
            onClick={() => {
              setAppliedGarmentTypeId(confirmingTypeChange);
              resetRows();
              setConfirmingTypeChange(null);
            }}
            style={{
              marginTop: 8,
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              background: C.pink,
              color: C.white,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Clear rows and continue
          </button>
        </div>
      )}

      <BatchGrid
        rows={rows}
        invalidRowIds={
          rejectedRowId && !invalidRowIds.includes(rejectedRowId)
            ? [...invalidRowIds, rejectedRowId]
            : invalidRowIds
        }
        garments={garments}
        faces={faces.data ?? []}
        backgrounds={backgrounds.data ?? []}
        poses={poseOptions}
        lowerItems={lowerItems.data ?? []}
        shoeItems={shoeItems.data ?? []}
        onPatchRow={patchRow}
        onSetPoses={(rowId, poseIds) => setPoses(rowId, poseIds, poseOptions)}
        onDuplicateRow={duplicateRow}
        onRemoveRow={removeRow}
        onAddRow={addRow}
      />

      {error && (
        <p role="alert" style={{ color: C.danger, fontSize: 13, margin: '12px 0 0' }}>
          {error}
        </p>
      )}

      <SummaryBar
        rowCount={rows.length}
        totalJobs={totalJobs}
        creditCost={totalJobs * creditCostPerImage}
        balance={balance}
        maxBatchJobs={DEFAULT_MAX_BATCH_JOBS}
        invalidRowCount={invalidRowIds.length}
        aspectSupported={BATCH_ASPECTS.includes(aspectRatio)}
        submitting={submitting}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
