import { Modal } from '@shopify/polaris';
import { type CSSProperties, useState } from 'react';
import { selectedCount } from '../../lib/productSelection';
import { FONT_MONO } from '../OnboardingShell';
import { ProductSelectionStage, type StagePick } from './ProductSelectionStage';

/**
 * The product picker, opened from the "Select products" button. The pick is a
 * draft until "Select" is pressed: Cancel (or clicking away) discards it, and
 * reopening starts from the last confirmed pick. Polaris unmounts the modal body
 * when it closes, so the stage rebuilds itself from `initial` each time.
 */
export function SelectProductsModal({
  open,
  initial,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  initial: StagePick;
  onCancel: () => void;
  onConfirm: (pick: StagePick) => void;
}) {
  // The stage reports its starting pick as soon as it mounts, so this is never
  // stale across openings.
  const [draft, setDraft] = useState<StagePick>(initial);
  const count = selectedCount(draft.selection, draft.total);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Select products"
      size="large"
      primaryAction={{
        content: count > 0 ? `Select ${count} product${count === 1 ? '' : 's'}` : 'Select',
        disabled: count === 0,
        onAction: () => onConfirm(draft),
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onCancel }]}
    >
      <Modal.Section>
        {/* The modal portals out of the onboarding panel, so the panel's font token
            does not reach it; re-apply it so the picker matches the page. */}
        <div
          style={
            {
              fontFamily: FONT_MONO,
              '--p-font-family-sans': FONT_MONO,
            } as CSSProperties
          }
        >
          <ProductSelectionStage onPickChange={setDraft} initial={initial} />
        </div>
      </Modal.Section>
    </Modal>
  );
}
