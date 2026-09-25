import {
  Badge,
  BlockStack,
  Button,
  IndexTable,
  InlineStack,
  Select,
  Text,
  Thumbnail,
} from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { type ClassifiedError, classifyError } from '../../lib/errors';
import { CLEARED_FILTER, filterToBody, filterToParams } from '../../lib/products';
import type { ShopifyProductsResponse } from '../../types';
import { ErrorBanner } from '../ErrorBanner';
import { BasketTiles } from './BasketTiles';

const PAGE_SIZE = 20;

interface Basket {
  id: string;
  label: string;
  description: string | null;
  imageUrl: string | null;
}

/**
 * The enabled products, each with a basket. "Apply to all" pins one basket to
 * every listed product; each row's own dropdown changes just that product and
 * saves immediately. Used by onboarding's step 2 and by Manage → Routing, so it
 * takes plain values rather than the `/me` payload the wizard holds.
 */
export function BasketAssignmentStage({
  globalMode,
  reloadKey,
  unrouted,
  onChanged,
  bulk = true,
}: {
  /** Global activation mode: every non-excluded product counts as enabled. */
  globalMode: boolean;
  /**
   * Reload cue: reloads the list whenever it changes. Products can be enabled or
   * disabled elsewhere while this is on screen, so the caller passes something
   * that moves only then (onboarding uses the enabled total — pinning a basket
   * shifts products between routed and unrouted but never changes the sum).
   */
  reloadKey: number;
  /** Enabled products still without a basket, for the intro line. */
  unrouted: number;
  /** Called after any basket change, so the caller can refresh what it shows. */
  onChanged: () => Promise<void> | void;
  /**
   * Show the tiles and "Apply to all" above the list. Off leaves just the
   * per-product list, for a live store where one click overwriting every pinned
   * basket is more risk than it is worth.
   */
  bulk?: boolean;
}) {
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [chosen, setChosen] = useState('');
  const [data, setData] = useState<ShopifyProductsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [applying, setApplying] = useState(false);
  const [busyRow, setBusyRow] = useState<number | null>(null);

  // In global mode every non-excluded product is enabled without its own
  // `enabled` flag, so filtering on it would show an empty list. Otherwise list
  // the products whose `enabled` flag is set.
  // No status filter: unroutedEnabledCount counts enabled products of every
  // status, so a failed or processing one left out of this list could never be
  // given a basket and would keep Continue disabled forever. Pinning a basket
  // ignores status, so listing them is harmless.
  const listFilter = useMemo(
    () => ({
      ...CLEARED_FILTER,
      excluded: false,
      ...(globalMode ? {} : { enabled: true }),
    }),
    [globalMode],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ShopifyProductsResponse>(
        `/v1/shopify/products?${filterToParams(listFilter, { page, pageSize: PAGE_SIZE })}`,
      );
      setData(res);
      setError(null);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setLoading(false);
    }
  }, [page, listFilter]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is a reload trigger, not read
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  useEffect(() => {
    apiFetch<{ items: Basket[] }>('/v1/shopify/baskets')
      .then((res) => setBaskets(res.items))
      .catch((err) => setError(classifyError(err)));
  }, []);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const basketOptions = [
    { label: 'Choose a basket', value: '', disabled: true },
    ...baskets.map((b) => ({ label: b.label, value: b.id })),
  ];

  async function applyToAll() {
    if (!chosen) return;
    setApplying(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/products/bulk', {
        method: 'POST',
        body: JSON.stringify({
          target: { filter: filterToBody(listFilter) },
          funnelTemplateId: chosen,
        }),
      });
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setApplying(false);
    }
  }

  async function changeRow(shopifyProductId: number, basketId: string) {
    setBusyRow(shopifyProductId);
    setError(null);
    try {
      await apiFetch(`/v1/shopify/products/${shopifyProductId}`, {
        method: 'PATCH',
        body: JSON.stringify({ funnelTemplateId: basketId }),
      });
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setBusyRow(null);
    }
  }

  return (
    <BlockStack gap="300">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <BlockStack gap="200">
        <Text as="p">
          {bulk
            ? 'A basket decides which try-on experience a product uses. Pick one for everything, then change individual products below if they need a different one.'
            : 'A basket decides which try-on experience a product uses. Choose one for each product below.'}
          {unrouted > 0 &&
            ` ${unrouted} product${unrouted === 1 ? ' still needs' : 's still need'} a basket.`}
        </Text>
        {bulk && (
          <>
            <BasketTiles
              baskets={baskets}
              value={chosen}
              disabled={applying}
              onChange={setChosen}
            />
            <div style={{ textAlign: 'center' }}>
              <Button onClick={applyToAll} loading={applying} disabled={!chosen || total === 0}>
                {`Apply to all ${total} product${total === 1 ? '' : 's'}`}
              </Button>
            </div>
            <Text as="p" tone="subdued" variant="bodySm">
              This replaces any basket these products already have.
            </Text>
          </>
        )}
      </BlockStack>
      <IndexTable
        selectable={false}
        loading={loading}
        itemCount={items.length}
        resourceName={{ singular: 'product', plural: 'products' }}
        headings={[{ title: 'Product' }, { title: 'Basket' }]}
        pagination={{
          hasPrevious: page > 1,
          hasNext: page * PAGE_SIZE < total,
          onPrevious: () => setPage((p) => Math.max(1, p - 1)),
          onNext: () => setPage((p) => p + 1),
        }}
      >
        {items.map((item, index) => (
          <IndexTable.Row
            id={String(item.shopifyProductId)}
            key={item.shopifyProductId}
            position={index}
          >
            <IndexTable.Cell>
              <InlineStack gap="300" blockAlign="center">
                <Thumbnail source={item.thumbnailUrl} alt={item.title ?? 'Product'} size="small" />
                <Text as="span" fontWeight="semibold">
                  {item.title}
                </Text>
                {/* Explains why e.g. a product with no image is listed: it is
                    enabled, so it still needs a basket, even though try-on
                    can't run on it until it syncs successfully. */}
                {item.status !== 'active' && <Badge tone="attention">{item.status}</Badge>}
              </InlineStack>
            </IndexTable.Cell>
            <IndexTable.Cell>
              <Select
                label="Basket"
                labelHidden
                options={basketOptions}
                value={item.basket?.id ?? ''}
                disabled={busyRow === item.shopifyProductId || applying || baskets.length === 0}
                onChange={(value) => changeRow(item.shopifyProductId, value)}
              />
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>
    </BlockStack>
  );
}
