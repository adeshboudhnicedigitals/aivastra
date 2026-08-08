'use client';
import { requiredInputsForPoses } from '@aivastra/types';
import { useEffect, useState } from 'react';
import { C } from '@/components/tokens';
import { SelectGridModal } from '../select-modal';
import type { BatchRowState, PoseOption, TrayGarment } from './types';
import { rowIssues } from './use-batch-state';

export interface PickerItem {
  id: string;
  label: string;
  thumbnailUrl?: string | null;
  tags?: string[];
}

type OpenPicker = 'garment' | 'face' | 'background' | 'pose' | 'lower' | 'shoe' | null;

/**
 * Matches the CSS breakpoint the rest of Studio uses. A media-query hook rather
 * than a CSS class because the grid template lives in inline styles alongside
 * the rest of this page's styling.
 */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** A single grid cell: shows the current selection, opens a picker on click. */
function Cell({
  label,
  value,
  disabled,
  onClick,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${C.border}`,
        background: disabled ? C.field : C.white,
        color: disabled ? C.mid : C.text,
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: '100%',
      }}
    >
      <span style={{ display: 'block', fontSize: 11, color: C.mid }}>{label}</span>
      <span style={{ display: 'block', fontSize: 13 }}>{value}</span>
    </button>
  );
}

export function BatchRow({
  row,
  index,
  garments,
  faces,
  backgrounds,
  poses,
  lowerItems,
  shoeItems,
  invalid,
  onPatch,
  onSetPoses,
  onDuplicate,
  onRemove,
}: {
  row: BatchRowState;
  index: number;
  garments: TrayGarment[];
  faces: PickerItem[];
  backgrounds: PickerItem[];
  poses: Array<PickerItem & PoseOption>;
  lowerItems: PickerItem[];
  shoeItems: PickerItem[];
  invalid: boolean;
  onPatch: (patch: Partial<BatchRowState>) => void;
  onSetPoses: (poseIds: string[]) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [picker, setPicker] = useState<OpenPicker>(null);
  const narrow = useIsNarrow();

  const garment = garments.find((g) => g.id === row.garmentId) ?? null;
  const face = faces.find((f) => f.id === row.faceId) ?? null;
  const background = backgrounds.find((b) => b.id === row.backgroundId) ?? null;
  const selectedPoses = poses.filter((p) => row.poseIds.includes(p.id));
  const { needsLower, needsShoes } = requiredInputsForPoses(selectedPoses);
  const issues = rowIssues(row, poses);

  const garmentItems: PickerItem[] = garments.map((g) => ({
    id: g.id,
    label: g.fileName,
    thumbnailUrl: g.previewUrl,
  }));

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: narrow ? '1fr' : '32px repeat(6, 1fr) 72px',
          gap: 8,
          alignItems: narrow ? 'stretch' : 'center',
          padding: 8,
          borderRadius: 10,
          border: `1px solid ${invalid ? C.pink : narrow ? C.border : 'transparent'}`,
          marginBottom: narrow ? 12 : 0,
        }}
      >
        <span style={{ color: C.mid, fontSize: 12 }}>
          {narrow ? `Row ${index + 1}` : index + 1}
        </span>

        <Cell
          label="Garment"
          value={garment?.fileName ?? 'Choose'}
          onClick={() => setPicker('garment')}
        />
        <Cell label="Model" value={face?.label ?? 'Choose'} onClick={() => setPicker('face')} />
        <Cell
          label="Background"
          value={background?.label ?? 'Choose'}
          onClick={() => setPicker('background')}
        />
        <Cell
          label="Poses"
          value={row.poseIds.length ? `${row.poseIds.length} selected` : 'Choose'}
          onClick={() => setPicker('pose')}
        />
        <Cell
          label="Lower"
          value={
            needsLower
              ? (lowerItems.find((i) => i.id === row.lowerCatalogId)?.label ?? 'Choose')
              : 'Not needed'
          }
          disabled={!needsLower}
          onClick={() => setPicker('lower')}
        />
        <Cell
          label="Shoes"
          value={
            needsShoes
              ? (shoeItems.find((i) => i.id === row.shoeCatalogId)?.label ?? 'Choose')
              : 'Not needed'
          }
          disabled={!needsShoes}
          onClick={() => setPicker('shoe')}
        />

        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" onClick={onDuplicate} title="Duplicate row">
            ⧉
          </button>
          <button type="button" onClick={onRemove} title="Remove row">
            ×
          </button>
        </div>
      </div>

      {invalid && (
        <p style={{ margin: '0 0 8px 40px', fontSize: 12, color: C.pink }}>
          Missing: {issues.join(', ')}
        </p>
      )}

      {picker === 'garment' && (
        <SelectGridModal
          title="Choose garment"
          items={garmentItems}
          selectedIds={row.garmentId ? [row.garmentId] : []}
          onSelect={(id) => {
            onPatch({ garmentId: id });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'face' && (
        <SelectGridModal
          title="Choose model"
          items={faces}
          selectedIds={row.faceId ? [row.faceId] : []}
          onSelect={(id) => {
            onPatch({ faceId: id });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'background' && (
        <SelectGridModal
          title="Choose background"
          items={backgrounds}
          selectedIds={row.backgroundId ? [row.backgroundId] : []}
          onSelect={(id) => {
            onPatch({ backgroundId: id });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'pose' && (
        <SelectGridModal
          title="Choose poses"
          items={poses}
          multiSelect
          selectedIds={row.poseIds}
          continueLabel="Done"
          onSelect={(id) =>
            onSetPoses(
              row.poseIds.includes(id) ? row.poseIds.filter((p) => p !== id) : [...row.poseIds, id],
            )
          }
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'lower' && (
        <SelectGridModal
          title="Choose lower garment"
          items={lowerItems}
          selectedIds={row.lowerCatalogId ? [row.lowerCatalogId] : []}
          onSelect={(id) => {
            onPatch({ lowerCatalogId: id });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'shoe' && (
        <SelectGridModal
          title="Choose shoes"
          items={shoeItems}
          selectedIds={row.shoeCatalogId ? [row.shoeCatalogId] : []}
          onSelect={(id) => {
            onPatch({ shoeCatalogId: id });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}
