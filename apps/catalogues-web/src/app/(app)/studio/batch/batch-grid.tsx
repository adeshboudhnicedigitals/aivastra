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
}) {
  return (
    <div style={{ marginTop: 16 }}>
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
        />
      ))}
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
