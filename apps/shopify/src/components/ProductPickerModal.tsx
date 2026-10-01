import { Modal } from '@shopify/polaris';
import { useState } from 'react';
import { selectedCount } from '../lib/productSelection';
import type { ProductFilterState } from '../lib/products';
import type { ShopifyProductListItem } from '../types';
import { ProductSelectionStage, type StagePick } from './onboarding/ProductSelectionStage';

/**
 * Multi-select product picker for the Manage page's Eligibility tabs — the same
 * search, filters and tick boxes as onboarding's picker. Ticks are staged only:
 * confirming hands the chosen products back, and the caller records them in its
 * draft list, which is saved (or discarded) with the page's Save bar.
 *
 * Ticks are per product (no "select all matching"), because a draft is a list of
 * concrete product ids that Save applies one by one.
 */
export function ProductPickerModal({
  title,
  confirmVerb,
  startFilter,
  locked,
  onClose,
  onConfirm,
}: {
  title: string;
  /** "Add" → the button reads "Add 3 products". */
  confirmVerb: string;
  startFilter: ProductFilterState;
  /** Fields the list is always scoped to (stable reference — see ProductSelectionStage). */
  locked: Partial<ProductFilterState>;
  onClose: () => void;
  onConfirm: (items: ShopifyProductListItem[]) => void;
}) {
  const [pick, setPick] = useState<StagePick | null>(null);
  const count = pick ? selectedCount(pick.selection, pick.total) : 0;

  function confirm() {
    if (pick?.selection.kind !== 'ids') return;
    const chosen = pick.selection.ids;
    onConfirm(pick.items.filter((i) => chosen.has(i.shopifyProductId)));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="large"
      primaryAction={{
        content:
          count > 0 ? `${confirmVerb} ${count} product${count === 1 ? '' : 's'}` : confirmVerb,
        disabled: count === 0,
        onAction: confirm,
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <ProductSelectionStage
          onPickChange={setPick}
          startFilter={startFilter}
          locked={locked}
          allowSelectAll={false}
        />
      </Modal.Section>
    </Modal>
  );
}
