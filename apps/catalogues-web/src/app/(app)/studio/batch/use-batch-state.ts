'use client';
import { countBatchJobs, requiredInputsForPoses } from '@aivastra/types';
import { useCallback, useState } from 'react';
import type { BatchRowState, PoseOption } from './types';

function newRow(faceId: string): BatchRowState {
  return {
    id: crypto.randomUUID(),
    garmentId: null,
    faceId,
    backgroundId: '',
    poseIds: [],
    lowerCatalogId: '',
    shoeCatalogId: '',
  };
}

/**
 * Lists what a row is still missing. Empty means the row is submittable.
 * The lower/shoe rule comes from requiredInputsForPoses so the client and the
 * API cannot drift — the API rejects exactly what this predicts.
 */
export function rowIssues(row: BatchRowState, poses: PoseOption[]): string[] {
  const issues: string[] = [];
  if (!row.garmentId) issues.push('garment');
  if (!row.faceId) issues.push('model');
  if (!row.backgroundId) issues.push('background');
  if (row.poseIds.length === 0) issues.push('pose');

  const selected = poses.filter((p) => row.poseIds.includes(p.id));
  const { needsLower, needsShoes } = requiredInputsForPoses(selected);
  if (needsLower && !row.lowerCatalogId) issues.push('lower garment');
  if (needsShoes && !row.shoeCatalogId) issues.push('shoes');
  return issues;
}

export function batchIssues(
  rows: BatchRowState[],
  poses: PoseOption[],
): { invalidRowIds: string[]; totalJobs: number } {
  return {
    invalidRowIds: rows.filter((r) => rowIssues(r, poses).length > 0).map((r) => r.id),
    totalJobs: countBatchJobs(rows),
  };
}

export function useBatchState(defaultFaceId: string) {
  const [rows, setRows] = useState<BatchRowState[]>([newRow(defaultFaceId)]);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, newRow(defaultFaceId)]);
  }, [defaultFaceId]);

  const duplicateRow = useCallback((rowId: string) => {
    setRows((prev) => {
      const index = prev.findIndex((r) => r.id === rowId);
      if (index === -1) return prev;
      const copy = { ...prev[index], id: crypto.randomUUID() } as BatchRowState;
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
    });
  }, []);

  // The grid must never reach zero rows — an empty grid has no affordance to add
  // one back that is discoverable mid-task.
  const removeRow = useCallback(
    (rowId: string) => {
      setRows((prev) =>
        prev.length === 1 ? [newRow(defaultFaceId)] : prev.filter((r) => r.id !== rowId),
      );
    },
    [defaultFaceId],
  );

  const patchRow = useCallback((rowId: string, patch: Partial<BatchRowState>) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  }, []);

  /**
   * Changing the pose selection can retire the lower/shoe requirement. Clear the
   * now-irrelevant values rather than submitting them: the API strips inputs the
   * workflow does not support, so leaving them set would show the user a
   * selection that silently has no effect.
   */
  const setPoses = useCallback((rowId: string, poseIds: string[], poses: PoseOption[]) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const selected = poses.filter((p) => poseIds.includes(p.id));
        const { needsLower, needsShoes } = requiredInputsForPoses(selected);
        return {
          ...r,
          poseIds,
          lowerCatalogId: needsLower ? r.lowerCatalogId : '',
          shoeCatalogId: needsShoes ? r.shoeCatalogId : '',
        };
      }),
    );
  }, []);

  /**
   * Removing a tray tile must not leave rows pointing at it. rowIssues only asks
   * whether a row *has* a garmentId, so a dangling id would keep the row looking
   * complete and let submit fire — which then fails with a misleading
   * "still uploading" message and no row attribution. Clearing the reference
   * puts the row back into the normal "Missing: garment" state instead.
   */
  const clearGarmentFromRows = useCallback((garmentId: string) => {
    setRows((prev) => prev.map((r) => (r.garmentId === garmentId ? { ...r, garmentId: null } : r)));
  }, []);

  const resetRows = useCallback(() => {
    setRows([newRow(defaultFaceId)]);
  }, [defaultFaceId]);

  return {
    rows,
    addRow,
    duplicateRow,
    removeRow,
    patchRow,
    setPoses,
    clearGarmentFromRows,
    resetRows,
  };
}
