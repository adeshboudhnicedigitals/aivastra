import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  EmptyState,
  IndexTable,
  InlineGrid,
  InlineStack,
  Modal,
  Page,
  Pagination,
  Tabs,
  Text,
  TextField,
  Thumbnail,
  Toast,
} from '@shopify/polaris';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { ErrorBanner } from '../components/ErrorBanner';
import { isTabEditable } from '../lib/activationTabState';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import type { ShopifyProductListItem } from '../types';

type DisplayStatus = 'active' | 'processing' | 'failed' | 'disabled' | 'excluded';

function displayStatus(item: ShopifyProductListItem): DisplayStatus {
  // Excluded takes priority: a product can be individually enabled (or
  // enabled via a collection) AND excluded at the same time — exclusion
  // always wins at the actual try-on gate (see activation.ts), so the badge
  // must reflect that rather than showing a misleading "Active" state.
  if (item.excluded) return 'excluded';
  if (!item.enabled || item.status === 'deleted') return 'disabled';
  return item.status as DisplayStatus;
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  active: 'Active',
  processing: 'Processing',
  failed: 'Failed',
  disabled: 'Disabled',
  excluded: 'Excluded',
};

const STATUS_TONE: Record<
  DisplayStatus,
  'success' | 'attention' | 'critical' | 'info' | 'warning'
> = {
  active: 'success',
  processing: 'attention',
  failed: 'critical',
  disabled: 'info',
  excluded: 'warning',
};

interface ActivationSummary {
  mode: 'global' | 'selective';
  counts: {
    enabledCollections: number;
    excludedCollections: number;
    failedToSync: number;
    // Products whose try-on is effectively on — global mode or an enabled
    // collection counts, exclusion always removes. Deliberately not a count of
    // the per-product `enabled` flag: that number excluded everything turned on
    // by global mode or a collection, which made it misleading on its own.
    tryonEnabledProducts: number;
    syncedProductCount: number;
    // null when the live Shopify lookup this needs failed (rate limit,
    // reauth needed, etc.) — the rest of the page still works without it,
    // just without a denominator to show alongside syncedProductCount.
    totalProductCount: number | null;
  };
}

interface CollectionListItem {
  shopifyCollectionId: number;
  title: string;
  productCount: number;
}

interface CollectionSearchResult {
  shopifyCollectionId: number;
  title: string;
}

interface ProductListResponse {
  page: number;
  pageSize: number;
  total: number;
  items: ShopifyProductListItem[];
}

const PAGE_SIZE = 20;

const TABS = [
  { id: 'collections', content: 'Collections' },
  { id: 'individual', content: 'Individual Products' },
  { id: 'exclusion', content: 'Exclusion' },
] as const;

function CollectionPickerModal({
  onClose,
  onPicked,
  setError,
}: {
  onClose: () => void;
  onPicked: (shopifyCollectionId: number) => void;
  setError: (e: ClassifiedError) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CollectionSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      apiFetch<{ items: CollectionSearchResult[] }>(
        `/v1/shopify/activation/collections/search?q=${encodeURIComponent(query)}`,
      )
        .then((res) => setResults(res.items))
        .catch((err) => setError(classifyError(err)))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, setError]);

  return (
    <Modal open title="Add a collection" onClose={onClose}>
      <Modal.Section>
        <BlockStack gap="300">
          <TextField
            label="Search collections"
            labelHidden
            autoComplete="off"
            placeholder="Search by collection name"
            value={query}
            onChange={setQuery}
          />
          {searching && (
            <Text as="p" tone="subdued">
              Searching…
            </Text>
          )}
          {results.map((r) => (
            <InlineStack key={r.shopifyCollectionId} align="space-between" blockAlign="center">
              <Text as="span">{r.title}</Text>
              <Button size="slim" onClick={() => onPicked(r.shopifyCollectionId)}>
                Add
              </Button>
            </InlineStack>
          ))}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function CollectionsPanel({
  basePath,
  editable,
  addLabel,
  emptyHeading,
  onChanged,
  setError,
}: {
  basePath: string;
  editable: boolean;
  addLabel: string;
  emptyHeading: string;
  onChanged: () => void;
  setError: (e: ClassifiedError) => void;
}) {
  const [items, setItems] = useState<CollectionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ items: CollectionListItem[] }>(basePath)
      .then((res) => setItems(res.items))
      .catch((err) => setError(classifyError(err)))
      .finally(() => setLoading(false));
  }, [basePath, setError]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(shopifyCollectionId: number) {
    try {
      await apiFetch(`${basePath}/${shopifyCollectionId}`, { method: 'DELETE' });
      load();
      onChanged();
    } catch (err) {
      setError(classifyError(err));
    }
  }

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between">
        <Text as="h2" variant="headingMd">
          Collections
        </Text>
        <Button disabled={!editable} onClick={() => setPickerOpen(true)}>
          {addLabel}
        </Button>
      </InlineStack>
      <IndexTable
        selectable={false}
        loading={loading}
        itemCount={items.length}
        resourceName={{ singular: 'collection', plural: 'collections' }}
        headings={[{ title: 'Collection' }, { title: 'Products' }, { title: '' }]}
        emptyState={<EmptyState heading={emptyHeading} image="" />}
      >
        {items.map((item, index) => (
          <IndexTable.Row
            id={String(item.shopifyCollectionId)}
            key={item.shopifyCollectionId}
            position={index}
          >
            <IndexTable.Cell>
              <Text as="span" fontWeight="semibold">
                {item.title}
              </Text>
            </IndexTable.Cell>
            <IndexTable.Cell>{item.productCount}</IndexTable.Cell>
            <IndexTable.Cell>
              <Button
                size="slim"
                disabled={!editable}
                onClick={() => remove(item.shopifyCollectionId)}
              >
                Remove
              </Button>
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>

      {pickerOpen && (
        <CollectionPickerModal
          onClose={() => setPickerOpen(false)}
          setError={setError}
          onPicked={async (shopifyCollectionId) => {
            try {
              await apiFetch(basePath, {
                method: 'POST',
                body: JSON.stringify({ shopifyCollectionIds: [shopifyCollectionId] }),
              });
              setPickerOpen(false);
              load();
              onChanged();
            } catch (err) {
              setError(classifyError(err));
            }
          }}
        />
      )}
    </BlockStack>
  );
}

function ProductPickerModal({
  title,
  searchParams,
  actionLabel,
  onClose,
  onPicked,
  setError,
}: {
  title: string;
  searchParams: Record<string, string>;
  actionLabel: string;
  onClose: () => void;
  onPicked: (shopifyProductId: number) => void;
  setError: (e: ClassifiedError) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ShopifyProductListItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearching(true);
      const params = new URLSearchParams({
        ...searchParams,
        pageSize: '20',
        ...(query ? { q: query } : {}),
      });
      apiFetch<ProductListResponse>(`/v1/shopify/products?${params}`)
        .then((res) => setResults(res.items))
        .catch((err) => setError(classifyError(err)))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, searchParams, setError]);

  return (
    <Modal open title={title} onClose={onClose}>
      <Modal.Section>
        <BlockStack gap="300">
          <TextField
            label="Search products"
            labelHidden
            autoComplete="off"
            placeholder="Search by product name"
            value={query}
            onChange={setQuery}
          />
          {searching && (
            <Text as="p" tone="subdued">
              Searching…
            </Text>
          )}
          {results.map((r) => (
            <InlineStack key={r.shopifyProductId} align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Thumbnail source={r.thumbnailUrl} alt={r.title ?? 'Product'} size="small" />
                <Text as="span">{r.title}</Text>
              </InlineStack>
              <Button size="slim" onClick={() => onPicked(r.shopifyProductId)}>
                {actionLabel}
              </Button>
            </InlineStack>
          ))}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function IndividualProductsPanel({
  editable,
  onChanged,
  setToastMessage,
  setError,
}: {
  editable: boolean;
  onChanged: () => void;
  setToastMessage: (m: string) => void;
  setError: (e: ClassifiedError) => void;
}) {
  const [items, setItems] = useState<ShopifyProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      enabled: 'true',
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...(query ? { q: query } : {}),
    });
    apiFetch<ProductListResponse>(`/v1/shopify/products?${params}`)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(classifyError(err)))
      .finally(() => setLoading(false));
  }, [page, query, setError]);

  useEffect(() => {
    load();
  }, [load]);

  async function removeProduct(shopifyProductId: number) {
    try {
      await apiFetch(`/v1/shopify/products/${shopifyProductId}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      });
      setToastMessage('Removed from Try-On.');
      load();
      onChanged();
    } catch (err) {
      setError(classifyError(err));
    }
  }

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between">
        <TextField
          label="Search"
          labelHidden
          autoComplete="off"
          placeholder="Search products"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
        />
        <Button disabled={!editable} onClick={() => setPickerOpen(true)}>
          Add products
        </Button>
      </InlineStack>
      <IndexTable
        selectable={false}
        loading={loading}
        itemCount={items.length}
        resourceName={{ singular: 'product', plural: 'products' }}
        headings={[{ title: 'Product' }, { title: 'Status' }, { title: '' }]}
        emptyState={<EmptyState heading="No individually enabled products" image="" />}
      >
        {items.map((item, index) => {
          const status = displayStatus(item);
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
                  disabled={!editable}
                  onClick={() => removeProduct(item.shopifyProductId)}
                >
                  Remove
                </Button>
              </IndexTable.Cell>
            </IndexTable.Row>
          );
        })}
      </IndexTable>
      <InlineStack align="center">
        <Pagination
          hasPrevious={page > 1}
          onPrevious={() => setPage((p) => p - 1)}
          hasNext={page * PAGE_SIZE < total}
          onNext={() => setPage((p) => p + 1)}
        />
      </InlineStack>

      {pickerOpen && (
        <ProductPickerModal
          title="Add products"
          searchParams={{ enabled: 'false', status: 'active' }}
          actionLabel="Add"
          onClose={() => setPickerOpen(false)}
          setError={setError}
          onPicked={async (shopifyProductId) => {
            try {
              await apiFetch(`/v1/shopify/products/${shopifyProductId}`, {
                method: 'PATCH',
                body: JSON.stringify({ enabled: true }),
              });
              setPickerOpen(false);
              load();
              onChanged();
            } catch (err) {
              setError(classifyError(err));
            }
          }}
        />
      )}
    </BlockStack>
  );
}

function ExclusionPanel({
  mode,
  onChanged,
  setToastMessage,
  setError,
}: {
  mode: 'global' | 'selective';
  onChanged: () => void;
  setToastMessage: (m: string) => void;
  setError: (e: ClassifiedError) => void;
}) {
  const [excludedProducts, setExcludedProducts] = useState<ShopifyProductListItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  const loadProducts = useCallback(() => {
    setLoadingProducts(true);
    apiFetch<ProductListResponse>('/v1/shopify/products?excluded=true&pageSize=100')
      .then((res) => setExcludedProducts(res.items))
      .catch((err) => setError(classifyError(err)))
      .finally(() => setLoadingProducts(false));
  }, [setError]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  async function unexclude(shopifyProductId: number) {
    try {
      await apiFetch(`/v1/shopify/products/${shopifyProductId}`, {
        method: 'PATCH',
        body: JSON.stringify({ excluded: false }),
      });
      setToastMessage('Removed from exclusions.');
      loadProducts();
      onChanged();
    } catch (err) {
      setError(classifyError(err));
    }
  }

  const editable = isTabEditable(mode, 'exclusion');

  return (
    <BlockStack gap="600">
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            Excluded Products
          </Text>
          <Button disabled={!editable} onClick={() => setProductPickerOpen(true)}>
            Exclude products
          </Button>
        </InlineStack>
        <IndexTable
          selectable={false}
          loading={loadingProducts}
          itemCount={excludedProducts.length}
          resourceName={{ singular: 'product', plural: 'products' }}
          headings={[{ title: 'Product' }, { title: '' }]}
          emptyState={<EmptyState heading="No excluded products" image="" />}
        >
          {excludedProducts.map((item, index) => (
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
                <Button
                  size="slim"
                  disabled={!editable}
                  onClick={() => unexclude(item.shopifyProductId)}
                >
                  Remove
                </Button>
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </BlockStack>

      <CollectionsPanel
        basePath="/v1/shopify/activation/exclusions/collections"
        editable={editable}
        addLabel="Exclude collections"
        emptyHeading="No excluded collections"
        onChanged={onChanged}
        setError={setError}
      />

      {productPickerOpen && (
        <ProductPickerModal
          title="Exclude products"
          searchParams={{ excluded: 'false' }}
          actionLabel="Exclude"
          onClose={() => setProductPickerOpen(false)}
          setError={setError}
          onPicked={async (shopifyProductId) => {
            try {
              await apiFetch(`/v1/shopify/products/${shopifyProductId}`, {
                method: 'PATCH',
                body: JSON.stringify({ excluded: true }),
              });
              setProductPickerOpen(false);
              loadProducts();
              onChanged();
            } catch (err) {
              setError(classifyError(err));
            }
          }}
        />
      )}
    </BlockStack>
  );
}

function FailedProductsModal({
  onClose,
  setError,
}: {
  onClose: () => void;
  setError: (e: ClassifiedError) => void;
}) {
  const [items, setItems] = useState<ShopifyProductListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<ProductListResponse>('/v1/shopify/products?status=failed&pageSize=100')
      .then((res) => setItems(res.items))
      .catch((err) => setError(classifyError(err)))
      .finally(() => setLoading(false));
  }, [setError]);

  return (
    <Modal open title="Failed to sync" onClose={onClose}>
      <Modal.Section>
        <IndexTable
          selectable={false}
          loading={loading}
          itemCount={items.length}
          resourceName={{ singular: 'product', plural: 'products' }}
          headings={[{ title: 'Product' }]}
          emptyState={<EmptyState heading="Nothing failed to sync" image="" />}
        >
          {items.map((item, index) => (
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
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Modal.Section>
    </Modal>
  );
}

// Collections and Individual Products are moot under global mode — everything
// is already enabled. The Tabs bar itself blocks switching into either one
// (per-tab `disabled`, set from the same isTabEditable check below), but a
// merchant already sitting on one of these tabs when the checkbox flips to
// global stays on it — Tabs has no "eject the active disabled tab" behavior —
// so the content still needs its own dimmed/inert treatment here. Exclusion
// is never wrapped in this: it stays fully live under global mode (see
// isTabEditable), so it must never go through this.
function DisabledTabView({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  if (!disabled) return <>{children}</>;
  return (
    <BlockStack gap="300">
      <Banner tone="info">
        Inactive while Try-On is enabled on all products. Turn that off above to manage this list.
      </Banner>
      <div style={{ opacity: 0.5, pointerEvents: 'none' }} aria-hidden="true">
        {children}
      </div>
    </BlockStack>
  );
}

export default function ManagePage() {
  const [summary, setSummary] = useState<ActivationSummary | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [failedModalOpen, setFailedModalOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadSummary = useCallback(() => {
    apiFetch<ActivationSummary>('/v1/shopify/activation')
      .then(setSummary)
      .catch((err) => setError(classifyError(err)));
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Unlike Dashboard's syncProducts, this never auto-switches activation mode
  // to global — this page already exposes that toggle directly, so silently
  // flipping it out from under a merchant who deliberately chose selective
  // mode would undo their own setting.
  async function syncProducts() {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      setToastMessage('Products synced from Shopify.');
      loadSummary();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSyncing(false);
    }
  }

  const toggleGlobalMode = useCallback(
    async (checked: boolean) => {
      const nextMode = checked ? 'global' : 'selective';
      const previous = summary;
      setSummary((s) => (s ? { ...s, mode: nextMode } : s));
      // Turning global mode on locks the Collections and Individual Products
      // tabs (isTabEditable) — sitting on one of those now shows a dimmed,
      // inert view for a setting that no longer applies. Jump to Exclusion,
      // the one tab that stays live and does anything under global mode.
      const currentTabId = TABS[selectedTab].id;
      if (
        nextMode === 'global' &&
        (currentTabId === 'collections' || currentTabId === 'individual')
      ) {
        setSelectedTab(TABS.findIndex((t) => t.id === 'exclusion'));
      }
      try {
        await apiFetch('/v1/shopify/activation/mode', {
          method: 'PATCH',
          body: JSON.stringify({ mode: nextMode }),
        });
        setToastMessage(
          nextMode === 'global'
            ? 'Try-On enabled on all products.'
            : 'Switched to selective activation.',
        );
      } catch (err) {
        setSummary(previous);
        setError(classifyError(err));
      }
    },
    [summary, selectedTab],
  );

  if (!summary) {
    return (
      <Page title="Manage">
        <Card>
          <Text as="p">Loading…</Text>
        </Card>
      </Page>
    );
  }

  const mode = summary.mode;
  const activeTabId = TABS[selectedTab].id;

  return (
    <Page
      title="Manage"
      subtitle="Control which products offer Try-On."
      primaryAction={{ content: 'Sync products', onAction: syncProducts, loading: syncing }}
    >
      <BlockStack gap="400">
        <ErrorBanner error={error} onRetry={loadSummary} onDismiss={() => setError(null)} />

        <Card>
          <BlockStack gap="200">
            <Checkbox
              label="Enable Try-On on all products (except exclusions)"
              checked={mode === 'global'}
              onChange={toggleGlobalMode}
            />
            <Text as="p" tone="subdued">
              When on, every synced product offers Try-On unless it — or a collection it belongs to
              — is excluded below.
            </Text>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, sm: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Products Synced
              </Text>
              <Text as="p" variant="heading2xl">
                {summary.counts.syncedProductCount}
                {summary.counts.totalProductCount !== null && (
                  <Text as="span" tone="subdued">
                    {' '}
                    / {summary.counts.totalProductCount}
                  </Text>
                )}
              </Text>
              {summary.counts.totalProductCount !== null &&
                summary.counts.syncedProductCount < summary.counts.totalProductCount && (
                  <Text as="p" tone="subdued">
                    Use Sync products above to import the rest.
                  </Text>
                )}
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Try-On Enabled
              </Text>
              <Text as="p" variant="heading2xl">
                {summary.counts.tryonEnabledProducts}
                <Text as="span" tone="subdued">
                  {' '}
                  / {summary.counts.syncedProductCount}
                </Text>
              </Text>
              <Text as="p" tone="subdued">
                {mode === 'global'
                  ? 'All synced products, minus exclusions.'
                  : 'Enabled individually or via a collection, minus exclusions.'}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Collections
              </Text>
              <Text as="p" variant="heading2xl">
                {summary.counts.enabledCollections}
                <Text as="span" tone="subdued">
                  {' '}
                  enabled
                </Text>
              </Text>
              <Text as="p" tone="subdued">
                {summary.counts.excludedCollections} excluded
              </Text>
            </BlockStack>
          </Card>
          <Card>
            {/* Deviation from the brief: Polaris `Button`'s `children` type is
                `string | string[]` (Button.d.ts), so it cannot wrap the
                BlockStack/Text stat block below — the brief's literal
                `<Button variant="plain">…</Button>` here fails to typecheck
                (TS2322). A native `<button>` is used instead. Reset to
                block-level, full-width, no default chrome so it reads as the
                same plain clickable stat card the brief intended. */}
            <button
              type="button"
              onClick={() => setFailedModalOpen(true)}
              style={{
                all: 'unset',
                display: 'block',
                width: '100%',
                cursor: 'pointer',
              }}
            >
              <BlockStack gap="200">
                <Text as="p" tone="subdued">
                  Failed to Sync
                </Text>
                <Text as="p" variant="heading2xl" tone="critical">
                  {summary.counts.failedToSync}
                </Text>
              </BlockStack>
            </button>
          </Card>
        </InlineGrid>

        <Card>
          <Tabs
            tabs={TABS.map((t) => ({ ...t, disabled: !isTabEditable(mode, t.id) }))}
            selected={selectedTab}
            onSelect={setSelectedTab}
          >
            <Box padding="400">
              {activeTabId === 'collections' && (
                <DisabledTabView disabled={!isTabEditable(mode, 'collections')}>
                  <CollectionsPanel
                    basePath="/v1/shopify/activation/collections"
                    editable={isTabEditable(mode, 'collections')}
                    addLabel="Add collections"
                    emptyHeading="No enabled collections"
                    onChanged={loadSummary}
                    setError={setError}
                  />
                </DisabledTabView>
              )}
              {activeTabId === 'individual' && (
                <DisabledTabView disabled={!isTabEditable(mode, 'individual')}>
                  <IndividualProductsPanel
                    editable={isTabEditable(mode, 'individual')}
                    onChanged={loadSummary}
                    setToastMessage={setToastMessage}
                    setError={setError}
                  />
                </DisabledTabView>
              )}
              {activeTabId === 'exclusion' && (
                <ExclusionPanel
                  mode={mode}
                  onChanged={loadSummary}
                  setToastMessage={setToastMessage}
                  setError={setError}
                />
              )}
            </Box>
          </Tabs>
        </Card>
      </BlockStack>

      {failedModalOpen && (
        <FailedProductsModal onClose={() => setFailedModalOpen(false)} setError={setError} />
      )}

      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
}
