import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  IndexFilters,
  IndexTable,
  InlineStack,
  Page,
  Text,
  Thumbnail,
  Toast,
  useSetIndexFiltersMode,
} from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { ShopifyProductListItem } from '../types';

type DisplayStatus = 'active' | 'processing' | 'failed' | 'disabled';

// Reconciles two independent real-data axes (sync `status` and the `enabled`
// toggle) into the single status bucket shown in the UI: a disabled product
// always reads as "Disabled", regardless of its underlying sync status.
function displayStatus(item: ShopifyProductListItem): DisplayStatus {
  if (!item.enabled || item.status === 'deleted') return 'disabled';
  return item.status as DisplayStatus;
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  active: 'Active',
  processing: 'Processing',
  failed: 'Failed',
  disabled: 'Disabled',
};

const STATUS_TONE: Record<DisplayStatus, 'success' | 'attention' | 'critical' | 'info'> = {
  active: 'success',
  processing: 'attention',
  failed: 'critical',
  disabled: 'info',
};

type StatusFilter = 'all' | DisplayStatus;

const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'processing', 'failed', 'disabled'];

const TAB_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  active: 'Active',
  processing: 'Processing',
  failed: 'Failed',
  disabled: 'Disabled',
};

export default function ManagePage() {
  const [items, setItems] = useState<ShopifyProductListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [syncing, setSyncing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { mode, setMode } = useSetIndexFiltersMode();

  const filteredItems = useMemo(() => {
    return items
      .filter((item) => statusFilter === 'all' || displayStatus(item) === statusFilter)
      .filter((item) => (item.title ?? '').toLowerCase().includes(searchQuery.toLowerCase()));
  }, [items, statusFilter, searchQuery]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ items: ShopifyProductListItem[] }>('/v1/shopify/products?pageSize=100')
      .then((products) => setItems(products.items))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshProducts = useCallback(async () => {
    setError(null);
    setSyncing(true);
    try {
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      setToastMessage('Refreshing your catalog from Shopify — this can take a minute.');
      // Sync runs async on the server (Redis-queued, paginated against Shopify's
      // Admin API) — nothing to await here. Re-poll the list once, giving a
      // typical single-page catalog time to land before showing it.
      setTimeout(() => {
        load();
        setSyncing(false);
      }, 4000);
    } catch (err) {
      setError((err as Error).message);
      setSyncing(false);
    }
  }, [load]);

  async function toggleEnabled(shopifyProductId: number, enabled: boolean) {
    setError(null);
    try {
      const updated = await apiFetch<ShopifyProductListItem>(
        `/v1/shopify/products/${shopifyProductId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        },
      );
      setItems((prev) => prev.map((p) => (p.shopifyProductId === shopifyProductId ? updated : p)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('all');
  }, []);

  const tabs = STATUS_FILTERS.map((key) => ({ id: key, content: TAB_LABEL[key] }));

  return (
    <Page
      title="Manage"
      subtitle={`${items.length} product${items.length === 1 ? '' : 's'} synced from Shopify.`}
      primaryAction={{
        content: syncing ? 'Syncing…' : 'Sync now',
        onAction: refreshProducts,
        loading: syncing,
      }}
    >
      <BlockStack gap="400">
        {error && <Banner tone="critical">{error}</Banner>}

        {!loading && items.length === 0 ? (
          <Card>
            <EmptyState
              heading="No products synced yet"
              image=""
              action={{ content: 'Sync now', onAction: refreshProducts }}
            >
              Sync now to bring in your Shopify catalog.
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <IndexFilters
              queryValue={searchQuery}
              queryPlaceholder="Search products"
              onQueryChange={setSearchQuery}
              onQueryClear={() => setSearchQuery('')}
              filters={[]}
              onClearAll={clearFilters}
              selected={STATUS_FILTERS.indexOf(statusFilter)}
              onSelect={(index) => setStatusFilter(STATUS_FILTERS[index])}
              tabs={tabs}
              mode={mode}
              setMode={setMode}
              cancelAction={{ onAction: clearFilters }}
            />
            <IndexTable
              selectable={false}
              loading={loading}
              itemCount={filteredItems.length}
              resourceName={{ singular: 'product', plural: 'products' }}
              headings={[{ title: 'Product' }, { title: 'Status' }, { title: 'Try-on' }]}
              emptyState={
                <EmptyState
                  heading="No products match your filters"
                  image=""
                  action={{ content: 'Clear filters', onAction: clearFilters }}
                >
                  Try a different search term or status.
                </EmptyState>
              }
            >
              {filteredItems.map((item, index) => {
                const status = displayStatus(item);
                // The API rejects enabling a product that is not active
                // (products.routes.ts:125-127), so the control must not offer it.
                const locked = !item.enabled && item.status !== 'active';
                return (
                  <IndexTable.Row
                    id={String(item.shopifyProductId)}
                    key={item.shopifyProductId}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <InlineStack gap="300" blockAlign="center">
                        <Thumbnail
                          source={item.thumbnailUrl}
                          alt={item.title ?? 'Product'}
                          size="small"
                        />
                        <Text as="span" fontWeight="semibold">
                          {item.title}
                        </Text>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Button
                        size="slim"
                        onClick={() => toggleEnabled(item.shopifyProductId, !item.enabled)}
                        disabled={locked}
                      >
                        {item.enabled ? 'Disable' : 'Enable'}
                      </Button>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
          </Card>
        )}
      </BlockStack>

      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
}
