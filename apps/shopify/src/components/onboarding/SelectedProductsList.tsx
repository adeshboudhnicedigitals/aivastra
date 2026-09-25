import { BlockStack, Divider, InlineStack, Pagination } from '@shopify/polaris';
import { Fragment, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { type ClassifiedError, classifyError } from '../../lib/errors';
import { isSelected, setMany } from '../../lib/productSelection';
import { filterToParams } from '../../lib/products';
import type { ShopifyProductListItem, ShopifyProductsResponse } from '../../types';
import { ErrorBanner } from '../ErrorBanner';
import { ProductRow } from './ProductRow';
import type { StagePick } from './ProductSelectionStage';

const PAGE_SIZE = 10;

/**
 * The confirmed pick, listed with a remove button per product. Removing edits
 * the pick itself (`onChange`), so the count and Continue follow.
 *
 * Ticked ids are already in `pick.items`, so that list is paged locally. "All
 * matching" is the one case where most of the products were never loaded, so it
 * pages the filter on the server and hides whatever has been excluded.
 */
export function SelectedProductsList({
  pick,
  onChange,
}: {
  pick: StagePick;
  onChange: (pick: StagePick) => void;
}) {
  const { selection } = pick;
  const [page, setPage] = useState(1);
  const [remote, setRemote] = useState<ShopifyProductsResponse | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);

  const isAll = selection.kind === 'all';

  useEffect(() => {
    if (!isAll) return;
    let cancelled = false;
    apiFetch<ShopifyProductsResponse>(
      `/v1/shopify/products?${filterToParams(pick.filter, { page, pageSize: PAGE_SIZE })}`,
    )
      .then((res) => {
        if (cancelled) return;
        setRemote(res);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(classifyError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [isAll, pick.filter, page]);

  let rows: ShopifyProductListItem[];
  let hasNext: boolean;
  if (selection.kind === 'ids') {
    const all = pick.items.filter((i) => selection.ids.has(i.shopifyProductId));
    rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    hasNext = page * PAGE_SIZE < all.length;
  } else {
    rows = (remote?.items ?? []).filter((i) => isSelected(selection, i.shopifyProductId));
    hasNext = page * PAGE_SIZE < (remote?.total ?? 0);
  }

  // Removing the last product on a page would otherwise leave an empty page.
  useEffect(() => {
    if (page > 1 && rows.length === 0 && !hasNext) setPage((p) => p - 1);
  }, [page, rows.length, hasNext]);

  if (rows.length === 0 && page === 1) return null;

  return (
    <BlockStack gap="200">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <BlockStack gap="0">
        {rows.map((item, index) => (
          <Fragment key={item.shopifyProductId}>
            {index > 0 && <Divider />}
            <ProductRow
              item={item}
              onRemove={() =>
                onChange({
                  ...pick,
                  selection: setMany(selection, [item.shopifyProductId], false),
                })
              }
            />
          </Fragment>
        ))}
      </BlockStack>
      {(page > 1 || hasNext) && (
        <InlineStack align="center">
          <Pagination
            hasPrevious={page > 1}
            hasNext={hasNext}
            onPrevious={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
        </InlineStack>
      )}
    </BlockStack>
  );
}
