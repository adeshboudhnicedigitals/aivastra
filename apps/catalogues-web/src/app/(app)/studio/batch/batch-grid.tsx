'use client';
import { C } from '@/components/tokens';
import { BatchRow, type PickerItem } from './batch-row';
import type { BatchRowState, PoseOption, TrayGarment } from './types';

export function BatchGrid({
  rows,
  invalidRowIds,
  garments,
  faces,
  backgrounds,
  poses,
  lowerItems,
  shoeItems,
  onPatchRow,
  onSetPoses,
  onDuplicateRow,
  onRemoveRow,
  onAddRow,
  onAddGarment,
  onPatchGarment,
  onRemoveGarment,
}: {
  rows: BatchRowState[];
  invalidRowIds: string[];
  garments: TrayGarment[];
  faces: PickerItem[];
  backgrounds: PickerItem[];
  poses: Array<PickerItem & PoseOption>;
  lowerItems: PickerItem[];
  shoeItems: PickerItem[];
  onPatchRow: (rowId: string, patch: Partial<BatchRowState>) => void;
  onSetPoses: (rowId: string, poseIds: string[]) => void;
  onDuplicateRow: (rowId: string) => void;
  onRemoveRow: (rowId: string) => void;
  onAddRow: () => void;
  onAddGarment: (garment: TrayGarment) => void;
  onPatchGarment: (id: string, patch: Partial<TrayGarment>) => void;
  onRemoveGarment: (id: string) => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      {/* Row cells have a min width floor (see batch-row.tsx's gridTemplateColumns)
          so they stay legible at any zoom/window size. When the container is
          narrower than that floor, scroll horizontally instead of clipping —
          Lower/Shoe are the rightmost columns and are the first to disappear
          silently without this. */}
      <div style={{ overflowX: 'auto' }}>
        {rows.map((row, index) => (
          <BatchRow
            key={row.id}
            row={row}
            index={index}
            garments={garments}
            faces={faces}
            backgrounds={backgrounds}
            poses={poses}
            lowerItems={lowerItems}
            shoeItems={shoeItems}
            invalid={invalidRowIds.includes(row.id)}
            onPatch={(patch) => onPatchRow(row.id, patch)}
            onSetPoses={(poseIds) => onSetPoses(row.id, poseIds)}
            onDuplicate={() => onDuplicateRow(row.id)}
            onRemove={() => onRemoveRow(row.id)}
            onAddGarment={onAddGarment}
            onPatchGarment={onPatchGarment}
            onRemoveGarment={onRemoveGarment}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onAddRow}
        style={{
          marginTop: 8,
          padding: '8px 14px',
          borderRadius: 8,
          border: `1px dashed ${C.border}`,
          background: 'transparent',
          color: C.text,
          cursor: 'pointer',
        }}
      >
        + Add row
      </button>
    </div>
  );
}
