import { BlockStack, Divider, InlineStack, Pagination } from '@shopify/polaris';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { type ClassifiedError, classifyError } from '../../lib/errors';
import { CLEARED_FILTER, filterToParams } from '../../lib/products';
import type { ShopifyProductsResponse } from '../../types';
import { ErrorBanner } from '../ErrorBanner';
import { ProductRow } from './ProductRow';

const PAGE_SIZE = 10;
const LIST_FILTER = { ...CLEARED_FILTER, excluded: false, enabled: true };

/**
 * Step 1 once the selection is confirmed: the products that are enabled right
 * now, read from the server, each removable. Removing disables the product (the
 * confirmed selection is live data, not a draft), then refreshes `me` so step 2
 * and the footer follow.
 *
 * `version` is any value that changes when products get enabled elsewhere on the
 * page (the "add more" flow), so this list reloads without owning that flow.
 */
export function EnabledProductsList({
  version,
  onChanged,
}: {
  version: number;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<ShopifyProductsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is a reload trigger, not read
  const load = useCallback(async () => {
    try {
      const res = await apiFetch<ShopifyProductsResponse>(
        `/v1/shopify/products?${filterToParams(LIST_FILTER, { page, pageSize: PAGE_SIZE })}`,
      );
      setData(res);
      setError(null);
    } catch (err) {
      setError(classifyError(err));
    }
  }, [page, version]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // Removing the last product on a page would otherwise leave an empty page.
  useEffect(() => {
    if (page > 1 && data && items.length === 0) setPage((p) => p - 1);
  }, [page, data, items.length]);

  async function remove(shopifyProductId: number) {
    setBusyId(shopifyProductId);
    setError(null);
    try {
      await apiFetch(`/v1/shopify/products/${shopifyProductId}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      });
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <BlockStack gap="200">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <BlockStack gap="0">
        {items.map((item, index) => (
          <Fragment key={item.shopifyProductId}>
            {index > 0 && <Divider />}
            <ProductRow
              item={item}
              removing={busyId === item.shopifyProductId}
              onRemove={() => remove(item.shopifyProductId)}
            />
          </Fragment>
        ))}
      </BlockStack>
      {(page > 1 || page * PAGE_SIZE < total) && (
        <InlineStack align="center">
          <Pagination
            hasPrevious={page > 1}
            hasNext={page * PAGE_SIZE < total}
            onPrevious={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
        </InlineStack>
      )}
    </BlockStack>
  );
}
