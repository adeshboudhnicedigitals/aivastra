import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  ContextualSaveBar,
  EmptyState,
  IndexTable,
  InlineGrid,
  InlineStack,
  Modal,
  Page,
  Pagination,
  Select,
  Tabs,
  Text,
  TextField,
  Thumbnail,
  Toast,
} from '@shopify/polaris';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorBanner } from '../components/ErrorBanner';
import {
  type DraftList,
  diffActions,
  emptyDraftList,
  mergeById,
  type PendingAction,
} from '../lib/activationDraft';
import { isTabEditable } from '../lib/activationTabState';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { setNavGuard } from '../lib/navGuard';
import type { ShopifyProductListItem } from '../types';
import RoutingTab from './RoutingPage';

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

interface Basket {
  id: string;
  label: string;
}

type BasketSource = 'manual' | 'rule';

const BASKET_SOURCE_LABEL: Record<BasketSource, string> = {
  manual: 'Pinned',
  rule: 'Rule',
};

const BASKET_SOURCE_TONE: Record<BasketSource, 'success' | 'info'> = {
  manual: 'success',
  rule: 'info',
};

interface ProductSyncStatus {
  state: 'running' | 'idle';
  startedAt: number;
  completedAt: number | null;
}

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

// Subset of GET /v1/shopify/funnel-rules's response consumed here — the full
// shape (storeRules, globalRules) belongs to RoutingTab, which fetches the
// same endpoint separately for its own rule tables.
interface FunnelRulesSummary {
  counts: Record<string, number>;
  countsOmitted: boolean;
  // null when countsOmitted — the catalog was never scanned, so there is no
  // count to report either way.
  unrouted: number | null;
  // Subset of `unrouted` that's also effectively enabled for Try-On — this is
  // what the banner above the tabs warns about.
  unroutedEnabled: number | null;
}

function basketLabelFor(baskets: Basket[], id: string): string {
  return baskets.find((b) => b.id === id)?.label ?? 'Unknown basket';
}

interface CollectionRow {
  shopifyCollectionId: number;
  title: string;
  // null only for a collection staged locally and not yet saved — Shopify
  // hasn't been asked to sync its membership yet, so there's no count to show.
  productCount: number | null;
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
  { id: 'exclusion', content: 'Exclusion' },
  { id: 'collections', content: 'Collections' },
  { id: 'individual', content: 'Individual Products' },
] as const;

const OUTER_TABS = [
  { id: 'routing', content: 'Routing' },
  { id: 'eligibility', content: 'Eligibility' },
] as const;

// Draft staging (mergeById, diffActions, DraftList — see lib/activationDraft.ts)
// — nothing there calls the API. Every Add/Remove click below just records
// intent; the actual PATCH/POST/DELETE calls only fire from saveChanges, when
// the merchant clicks Save.

function CollectionPickerModal({
  onClose,
  onPicked,
  setError,
}: {
  onClose: () => void;
  onPicked: (result: CollectionSearchResult) => void;
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
              <Button size="slim" onClick={() => onPicked(r)}>
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
  refreshToken,
  draft,
  onAdd,
  onRemove,
  setError,
}: {
  basePath: string;
  editable: boolean;
  addLabel: string;
  emptyHeading: string;
  refreshToken: number;
  draft: DraftList<CollectionRow>;
  onAdd: (result: CollectionSearchResult) => void;
  onRemove: (shopifyCollectionId: number) => void;
  setError: (e: ClassifiedError) => void;
}) {
  const [baseItems, setBaseItems] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is a deliberate refetch trigger (bumps after a successful Save), not referenced in the body
  useEffect(() => {
    setLoading(true);
    apiFetch<{ items: CollectionRow[] }>(basePath)
      .then((res) => setBaseItems(res.items))
      .catch((err) => setError(classifyError(err)))
      .finally(() => setLoading(false));
  }, [basePath, refreshToken, setError]);

  const items = useMemo(
    () => mergeById(baseItems, (i) => i.shopifyCollectionId, draft),
    [baseItems, draft],
  );

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
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" fontWeight="semibold">
                  {item.title}
                </Text>
                {draft.actions.get(item.shopifyCollectionId) === 'add' && (
                  <Badge tone="info">Pending</Badge>
                )}
              </InlineStack>
            </IndexTable.Cell>
            <IndexTable.Cell>{item.productCount ?? '—'}</IndexTable.Cell>
            <IndexTable.Cell>
              <Button
                size="slim"
                disabled={!editable}
                onClick={() => onRemove(item.shopifyCollectionId)}
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
          onPicked={(result) => {
            onAdd(result);
            setPickerOpen(false);
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
  onPicked: (item: ShopifyProductListItem) => void;
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
              <Button size="slim" onClick={() => onPicked(r)}>
                {actionLabel}
              </Button>
            </InlineStack>
          ))}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

interface UnroutedProductItem {
  shopifyProductId: number;
  title: string | null;
}

interface UnroutedProductsResponse {
  items: UnroutedProductItem[];
  truncated: boolean;
  omitted: boolean;
}

function UnroutedProductsModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<UnroutedProductItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClassifiedError | null>(null);

  useEffect(() => {
    apiFetch<UnroutedProductsResponse>('/v1/shopify/funnel-rules/unrouted')
      .then((res) => {
        setItems(res.items);
        setTruncated(res.truncated);
      })
      .catch((err) => setError(classifyError(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Modal open title="Not routed (try-on unavailable)" onClose={onClose}>
      <Modal.Section>
        {loading ? (
          <Text as="p" tone="subdued">
            Loading…
          </Text>
        ) : error ? (
          <ErrorBanner error={error} />
        ) : items.length === 0 ? (
          <Text as="p" tone="subdued">
            No unrouted products.
          </Text>
        ) : (
          <BlockStack gap="200">
            {items.map((item) => (
              <Text as="p" key={item.shopifyProductId}>
                {item.title ?? `Product ${item.shopifyProductId}`}
              </Text>
            ))}
            {truncated && (
              <Text as="p" tone="subdued">
                More not shown — add a routing rule or pin these individually to narrow the list.
              </Text>
            )}
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}

function IndividualProductsPanel({
  editable,
  refreshToken,
  draft,
  onAdd,
  onRemove,
  onBasketChanged,
  setError,
}: {
  editable: boolean;
  refreshToken: number;
  draft: DraftList<ShopifyProductListItem>;
  onAdd: (item: ShopifyProductListItem) => void;
  onRemove: (shopifyProductId: number) => void;
  // Called after a basket PATCH succeeds so the parent can refresh the
  // unrouted banner — pinning a product here can change whether it's
  // routed, and this is an immediate mutation, not staged behind Save.
  onBasketChanged: () => void;
  setError: (e: ClassifiedError) => void;
}) {
  const [baseItems, setBaseItems] = useState<ShopifyProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [baskets, setBaskets] = useState<Basket[]>([]);
  // The product whose basket PATCH is currently in flight — disables just
  // that row's controls rather than the whole table, since the change is
  // immediate (not staged behind the Save bar like enabled/excluded).
  const [basketBusyId, setBasketBusyId] = useState<number | null>(null);

  // silent: true skips the loading spinner — used for the refetch after a
  // basket PATCH, so one row's pin doesn't flash the whole table.
  const loadProducts = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const params = new URLSearchParams({
        enabled: 'true',
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(query ? { q: query } : {}),
      });
      return apiFetch<ProductListResponse>(`/v1/shopify/products?${params}`)
        .then((res) => {
          setBaseItems(res.items);
          setTotal(res.total);
        })
        .catch((err) => setError(classifyError(err)))
        .finally(() => {
          if (!opts?.silent) setLoading(false);
        });
    },
    [page, query, setError],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is a deliberate refetch trigger (bumps after a successful Save), not referenced in the body
  useEffect(() => {
    loadProducts();
  }, [loadProducts, refreshToken]);

  useEffect(() => {
    apiFetch<{ items: Basket[] }>('/v1/shopify/baskets')
      .then((res) => setBaskets(res.items))
      .catch((err) => setError(classifyError(err)));
  }, [setError]);

  const items = useMemo(
    () => mergeById(baseItems, (i) => i.shopifyProductId, draft),
    [baseItems, draft],
  );

  // funnelTemplateId null resets to automatic routing (rule).
  // No optimistic update: the effective source after a reset is decided
  // server-side by funnel-resolution.ts, which the client doesn't replicate
  // — a silent refetch is the only accurate way to show the real result.
  async function updateBasket(shopifyProductId: number, funnelTemplateId: string | null) {
    setBasketBusyId(shopifyProductId);
    try {
      await apiFetch(`/v1/shopify/products/${shopifyProductId}`, {
        method: 'PATCH',
        body: JSON.stringify({ funnelTemplateId }),
      });
      await loadProducts({ silent: true });
      onBasketChanged();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setBasketBusyId(null);
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
        headings={[{ title: 'Product' }, { title: 'Status' }, { title: 'Basket' }, { title: '' }]}
        emptyState={<EmptyState heading="No individually enabled products" image="" />}
      >
        {items.map((item, index) => {
          const status = displayStatus(item);
          const pending = draft.actions.get(item.shopifyProductId) === 'add';
          const basketBusy = basketBusyId === item.shopifyProductId;
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
                <InlineStack gap="200">
                  {pending ? (
                    <Badge tone="info">Pending</Badge>
                  ) : (
                    <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                  )}
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell>
                {item.basket === null ? (
                  <BlockStack gap="100">
                    <Text as="span" tone="subdued">
                      Unavailable
                    </Text>
                    {item.pinnedBasketId !== null && (
                      <Text as="span" tone="subdued">
                        Pinned basket unavailable, no fallback configured
                      </Text>
                    )}
                    {item.pinnedBasketId !== null && (
                      <Button
                        size="slim"
                        disabled={!editable || basketBusy}
                        onClick={() => updateBasket(item.shopifyProductId, null)}
                      >
                        Reset to automatic
                      </Button>
                    )}
                  </BlockStack>
                ) : (
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span">{item.basket.label}</Text>
                      <Badge tone={BASKET_SOURCE_TONE[item.basket.source]}>
                        {BASKET_SOURCE_LABEL[item.basket.source]}
                      </Badge>
                    </InlineStack>
                    {/* A pin whose basket was deactivated falls through to a rule —
                        source is no longer 'manual', so the badge above looks identical to a
                        product that was never pinned. Surface the fallen-through pin so the
                        merchant knows why this product isn't on the basket they set, and so
                        "Reset to automatic" (below) has a reason to still be offered. */}
                    {item.pinnedBasketId !== null && item.basket.source !== 'manual' && (
                      <Text as="span" tone="subdued">
                        Pinned basket unavailable, using {item.basket.label}
                      </Text>
                    )}
                    <InlineStack gap="200" blockAlign="center">
                      <Select
                        label="Basket"
                        labelHidden
                        disabled={!editable || basketBusy || baskets.length === 0}
                        options={baskets.map((b) => ({ value: b.id, label: b.label }))}
                        value={item.basket.id}
                        onChange={(value) => updateBasket(item.shopifyProductId, value)}
                      />
                      {item.pinnedBasketId !== null && (
                        <Button
                          size="slim"
                          disabled={!editable || basketBusy}
                          onClick={() => updateBasket(item.shopifyProductId, null)}
                        >
                          Reset to automatic
                        </Button>
                      )}
                    </InlineStack>
                  </BlockStack>
                )}
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Button
                  size="slim"
                  disabled={!editable}
                  onClick={() => onRemove(item.shopifyProductId)}
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
          onPicked={(item) => {
            onAdd(item);
            setPickerOpen(false);
          }}
        />
      )}
    </BlockStack>
  );
}

function ExclusionPanel({
  mode,
  refreshToken,
  productDraft,
  collectionDraft,
  onAddProduct,
  onRemoveProduct,
  onAddCollection,
  onRemoveCollection,
  setError,
}: {
  mode: 'global' | 'selective';
  refreshToken: number;
  productDraft: DraftList<ShopifyProductListItem>;
  collectionDraft: DraftList<CollectionRow>;
  onAddProduct: (item: ShopifyProductListItem) => void;
  onRemoveProduct: (shopifyProductId: number) => void;
  onAddCollection: (result: CollectionSearchResult) => void;
  onRemoveCollection: (shopifyCollectionId: number) => void;
  setError: (e: ClassifiedError) => void;
}) {
  const [baseProducts, setBaseProducts] = useState<ShopifyProductListItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is a deliberate refetch trigger (bumps after a successful Save), not referenced in the body
  useEffect(() => {
    setLoadingProducts(true);
    apiFetch<ProductListResponse>('/v1/shopify/products?excluded=true&pageSize=100')
      .then((res) => setBaseProducts(res.items))
      .catch((err) => setError(classifyError(err)))
      .finally(() => setLoadingProducts(false));
  }, [refreshToken, setError]);

  const excludedProducts = useMemo(
    () => mergeById(baseProducts, (i) => i.shopifyProductId, productDraft),
    [baseProducts, productDraft],
  );

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
                  {productDraft.actions.get(item.shopifyProductId) === 'add' && (
                    <Badge tone="info">Pending</Badge>
                  )}
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Button
                  size="slim"
                  disabled={!editable}
                  onClick={() => onRemoveProduct(item.shopifyProductId)}
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
        refreshToken={refreshToken}
        draft={collectionDraft}
        onAdd={onAddCollection}
        onRemove={onRemoveCollection}
        setError={setError}
      />

      {productPickerOpen && (
        <ProductPickerModal
          title="Exclude products"
          searchParams={{ excluded: 'false' }}
          actionLabel="Exclude"
          onClose={() => setProductPickerOpen(false)}
          setError={setError}
          onPicked={(item) => {
            onAddProduct(item);
            setProductPickerOpen(false);
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
  const [outerTabIndex, setOuterTabIndex] = useState(0);
  const [rulesSummary, setRulesSummary] = useState<FunnelRulesSummary | null>(null);
  const [landingBaskets, setLandingBaskets] = useState<Basket[]>([]);
  // Bumped by any routing mutation (rule add/edit/delete, global rule
  // toggle, individual product pin) that isn't already covered by
  // refreshToken (Sync / Eligibility Save) — so the banner and the "Where
  // your products land" card reflect the merchant's own fix without
  // requiring another Sync.
  const [unroutedRefreshToken, setUnroutedRefreshToken] = useState(0);
  const [failedModalOpen, setFailedModalOpen] = useState(false);
  const [unroutedModalOpen, setUnroutedModalOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  // null = untouched this session — the effective mode is summary.mode.
  const [draftMode, setDraftMode] = useState<'global' | 'selective' | null>(null);
  const [enabledCollections, setEnabledCollections] =
    useState<DraftList<CollectionRow>>(emptyDraftList);
  const [excludedCollections, setExcludedCollections] =
    useState<DraftList<CollectionRow>>(emptyDraftList);
  const [individualProducts, setIndividualProducts] =
    useState<DraftList<ShopifyProductListItem>>(emptyDraftList);
  const [excludedProducts, setExcludedProducts] =
    useState<DraftList<ShopifyProductListItem>>(emptyDraftList);
  // Bumped after a successful save so every panel re-fetches its base list —
  // the draft entries that just got cleared are now real server rows.
  const [refreshToken, setRefreshToken] = useState(0);

  const loadSummary = useCallback(() => {
    apiFetch<ActivationSummary>('/v1/shopify/activation')
      .then(setSummary)
      .catch((err) => setError(classifyError(err)));
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Lightweight, independent of RoutingTab's own fetch — feeds both the
  // unrouted banner below and the "Where your products land" card, so
  // switching to the Routing tab isn't required to see either, and enabling
  // this second GET doesn't require lifting RoutingTab's full state (its own
  // loading/error/toast, rule editor) up into this component.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken and unroutedRefreshToken are deliberate refetch triggers (bump after a successful Save/Sync or a routing mutation), not referenced in the body
  useEffect(() => {
    Promise.all([
      apiFetch<{ items: Basket[] }>('/v1/shopify/baskets'),
      apiFetch<FunnelRulesSummary>('/v1/shopify/funnel-rules'),
    ])
      .then(([basketsRes, rulesRes]) => {
        setLandingBaskets(basketsRes.items);
        setRulesSummary(rulesRes);
      })
      .catch(() => setRulesSummary(null));
  }, [refreshToken, unroutedRefreshToken]);

  const unrouted = rulesSummary?.countsOmitted ? null : (rulesSummary?.unroutedEnabled ?? null);

  const isDirty =
    (draftMode !== null && draftMode !== summary?.mode) ||
    enabledCollections.actions.size > 0 ||
    excludedCollections.actions.size > 0 ||
    individualProducts.actions.size > 0 ||
    excludedProducts.actions.size > 0;

  // Standing infrastructure in lib/navGuard.ts for exactly this: block
  // programmatic in-app navigation (nav menu, dev sidebar) while there are
  // unsaved changes, same as leaving any other unsaved form in this app.
  useEffect(() => {
    setNavGuard(
      isDirty ? () => window.confirm('You have unsaved changes. Leave without saving?') : null,
    );
    return () => setNavGuard(null);
  }, [isDirty]);

  // Sync now already reconciles deletions as of the products-resync backstop
  // (products.sync.ts) — every full sync, not just the hourly scheduled one,
  // marks any product Shopify no longer returns as deleted. Nothing extra to
  // wire up here: this button already enqueues a 'full' sync task, which is
  // the same path.
  //
  // The POST only enqueues — the actual sync runs in a background consumer
  // and can take well past a single refetch's worth of time (throttled
  // Shopify calls, paginated). Refetching right after the 202 used to show
  // stale data until a later manual page reload happened to land after the
  // background job finished. Polling /sync/status until it reports 'idle'
  // is what makes the button's own refetch trustworthy.
  async function syncProducts() {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });

      const pollIntervalMs = 1500;
      const maxAttempts = 120; // ~3 minutes — generous over any full sync seen in practice
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        const status = await apiFetch<ProductSyncStatus>('/v1/shopify/products/sync/status');
        if (status.state === 'idle') break;
      }

      setToastMessage('Products synced from Shopify.');
      loadSummary();
      setRefreshToken((t) => t + 1);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSyncing(false);
    }
  }

  const stageMode = useCallback(
    (checked: boolean) => {
      const nextMode = checked ? 'global' : 'selective';
      setDraftMode(nextMode);
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
    },
    [selectedTab],
  );

  function discardChanges() {
    setDraftMode(null);
    setEnabledCollections(emptyDraftList());
    setExcludedCollections(emptyDraftList());
    setIndividualProducts(emptyDraftList());
    setExcludedProducts(emptyDraftList());
  }

  async function saveCollectionList(
    basePath: string,
    list: DraftList<CollectionRow>,
    setList: (d: DraftList<CollectionRow>) => void,
    failLabel: string,
    failures: string[],
  ) {
    const { toAdd, toRemove } = diffActions(list.actions);
    const stillActions = new Map<number, PendingAction>();
    const stillMeta = new Map<number, CollectionRow>();

    if (toAdd.length > 0) {
      try {
        await apiFetch(basePath, {
          method: 'POST',
          body: JSON.stringify({ shopifyCollectionIds: toAdd }),
        });
      } catch {
        for (const id of toAdd) {
          stillActions.set(id, 'add');
          const meta = list.meta.get(id);
          if (meta) stillMeta.set(id, meta);
        }
        failures.push(failLabel);
      }
    }
    const removeResults = await Promise.allSettled(
      toRemove.map((id) => apiFetch(`${basePath}/${id}`, { method: 'DELETE' })),
    );
    removeResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        stillActions.set(toRemove[i], 'remove');
        failures.push(failLabel);
      }
    });
    setList({ actions: stillActions, meta: stillMeta });
  }

  async function saveProductList(
    fieldName: 'enabled' | 'excluded',
    list: DraftList<ShopifyProductListItem>,
    setList: (d: DraftList<ShopifyProductListItem>) => void,
    failLabel: string,
    failures: string[],
  ) {
    const entries = [...list.actions];
    const results = await Promise.allSettled(
      entries.map(([id, action]) =>
        apiFetch(`/v1/shopify/products/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ [fieldName]: action === 'add' }),
        }),
      ),
    );
    const stillActions = new Map<number, PendingAction>();
    const stillMeta = new Map<number, ShopifyProductListItem>();
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const [id, action] = entries[i];
        stillActions.set(id, action);
        const meta = list.meta.get(id);
        if (meta) stillMeta.set(id, meta);
        failures.push(failLabel);
      }
    });
    setList({ actions: stillActions, meta: stillMeta });
  }

  async function saveChanges() {
    setSaving(true);
    setError(null);
    const failures: string[] = [];

    if (draftMode !== null && draftMode !== summary?.mode) {
      try {
        await apiFetch('/v1/shopify/activation/mode', {
          method: 'PATCH',
          body: JSON.stringify({ mode: draftMode }),
        });
        setDraftMode(null);
      } catch {
        failures.push('activation mode');
      }
    }

    await Promise.all([
      saveCollectionList(
        '/v1/shopify/activation/collections',
        enabledCollections,
        setEnabledCollections,
        'enabled collections',
        failures,
      ),
      saveCollectionList(
        '/v1/shopify/activation/exclusions/collections',
        excludedCollections,
        setExcludedCollections,
        'excluded collections',
        failures,
      ),
      saveProductList(
        'enabled',
        individualProducts,
        setIndividualProducts,
        'individually enabled products',
        failures,
      ),
      saveProductList(
        'excluded',
        excludedProducts,
        setExcludedProducts,
        'excluded products',
        failures,
      ),
    ]);

    loadSummary();
    setRefreshToken((t) => t + 1);
    setSaving(false);

    if (failures.length > 0) {
      const unique = [...new Set(failures)];
      setError(
        classifyError(
          new Error(
            `Some changes couldn't be saved (${unique.join(', ')}). They're still pending — try Save again.`,
          ),
        ),
      );
    } else {
      setToastMessage('Changes saved.');
    }
  }

  if (!summary) {
    return (
      <Page title="Manage">
        <Card>
          <Text as="p">Loading…</Text>
        </Card>
      </Page>
    );
  }

  const mode = draftMode ?? summary.mode;
  const activeTabId = TABS[selectedTab].id;

  return (
    <Page
      title="Manage"
      subtitle="Control which products offer Try-On."
      primaryAction={{ content: 'Sync products', onAction: syncProducts, loading: syncing }}
    >
      {isDirty && (
        <ContextualSaveBar
          message="Unsaved changes"
          saveAction={{ content: 'Save', onAction: saveChanges, loading: saving }}
          discardAction={{ content: 'Discard', onAction: discardChanges, disabled: saving }}
        />
      )}
      <BlockStack gap="400">
        <ErrorBanner error={error} onRetry={loadSummary} onDismiss={() => setError(null)} />

        {unrouted !== null && unrouted > 0 && (
          <Banner tone="warning">
            {unrouted} product{unrouted === 1 ? ' has' : 's have'} no basket assigned — Try-On won't
            work for {unrouted === 1 ? 'it' : 'them'} until you add a routing rule or pin{' '}
            {unrouted === 1 ? 'it' : 'them'} individually.
          </Banner>
        )}

        <Card>
          <BlockStack gap="200">
            <Checkbox
              label="Enable Try-On on all products (except exclusions)"
              checked={mode === 'global'}
              onChange={stageMode}
            />
            <Text as="p" tone="subdued">
              When on, every synced product offers Try-On unless it — or a collection it belongs to
              — is excluded below. Click Save above to apply.
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
                  ? 'All synced products, minus exclusions and unrouted products.'
                  : 'Enabled individually or via a collection, minus exclusions and unrouted products.'}
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

        {rulesSummary && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Where your products land
              </Text>
              {rulesSummary.countsOmitted ? (
                <Text as="p" tone="subdued">
                  Catalog too large to summarize.
                </Text>
              ) : Object.keys(rulesSummary.counts).length === 0 && !rulesSummary.unrouted ? (
                <Text as="p" tone="subdued">
                  No products have matched a rule yet.
                </Text>
              ) : (
                <BlockStack gap="200">
                  {Object.entries(rulesSummary.counts)
                    .sort(([a], [b]) =>
                      basketLabelFor(landingBaskets, a).localeCompare(
                        basketLabelFor(landingBaskets, b),
                      ),
                    )
                    .map(([basketId, productCount]) => (
                      <InlineStack key={basketId} align="space-between">
                        <Text as="span">{basketLabelFor(landingBaskets, basketId)}</Text>
                        <Text as="span" fontWeight="semibold">
                          {productCount}
                        </Text>
                      </InlineStack>
                    ))}
                  {rulesSummary.unrouted !== null && (
                    <InlineStack align="space-between">
                      {rulesSummary.unrouted > 0 ? (
                        <button
                          type="button"
                          onClick={() => setUnroutedModalOpen(true)}
                          style={{
                            all: 'unset',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                          }}
                        >
                          <Text as="span" tone="critical">
                            Not routed (try-on unavailable)
                          </Text>
                        </button>
                      ) : (
                        <Text as="span" tone="subdued">
                          Not routed (try-on unavailable)
                        </Text>
                      )}
                      <Text
                        as="span"
                        fontWeight="semibold"
                        tone={rulesSummary.unrouted > 0 ? 'critical' : 'subdued'}
                      >
                        {rulesSummary.unrouted}
                      </Text>
                    </InlineStack>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}

        <Card>
          <Tabs
            // Polaris's TabProps[] is mutable; OUTER_TABS's `as const` tuple
            // is readonly (TS4104), same reason TABS below is never passed
            // directly either — .map(...) produces a fresh mutable array.
            tabs={OUTER_TABS.map((t) => ({ ...t }))}
            selected={outerTabIndex}
            onSelect={setOuterTabIndex}
          >
            <Box padding="400">
              {OUTER_TABS[outerTabIndex].id === 'eligibility' && (
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
                          refreshToken={refreshToken}
                          draft={enabledCollections}
                          onAdd={(result) =>
                            setEnabledCollections((d) => {
                              const actions = new Map(d.actions).set(
                                result.shopifyCollectionId,
                                'add',
                              );
                              const meta = new Map(d.meta).set(result.shopifyCollectionId, {
                                ...result,
                                productCount: null,
                              });
                              return { actions, meta };
                            })
                          }
                          onRemove={(id) =>
                            setEnabledCollections((d) => ({
                              actions: new Map(d.actions).set(id, 'remove'),
                              meta: d.meta,
                            }))
                          }
                          setError={setError}
                        />
                      </DisabledTabView>
                    )}
                    {activeTabId === 'individual' && (
                      <DisabledTabView disabled={!isTabEditable(mode, 'individual')}>
                        <IndividualProductsPanel
                          editable={isTabEditable(mode, 'individual')}
                          refreshToken={refreshToken}
                          draft={individualProducts}
                          onAdd={(item) =>
                            setIndividualProducts((d) => ({
                              actions: new Map(d.actions).set(item.shopifyProductId, 'add'),
                              meta: new Map(d.meta).set(item.shopifyProductId, item),
                            }))
                          }
                          onRemove={(id) =>
                            setIndividualProducts((d) => ({
                              actions: new Map(d.actions).set(id, 'remove'),
                              meta: d.meta,
                            }))
                          }
                          onBasketChanged={() => setUnroutedRefreshToken((n) => n + 1)}
                          setError={setError}
                        />
                      </DisabledTabView>
                    )}
                    {activeTabId === 'exclusion' && (
                      <ExclusionPanel
                        mode={mode}
                        refreshToken={refreshToken}
                        productDraft={excludedProducts}
                        collectionDraft={excludedCollections}
                        onAddProduct={(item) =>
                          setExcludedProducts((d) => ({
                            actions: new Map(d.actions).set(item.shopifyProductId, 'add'),
                            meta: new Map(d.meta).set(item.shopifyProductId, item),
                          }))
                        }
                        onRemoveProduct={(id) =>
                          setExcludedProducts((d) => ({
                            actions: new Map(d.actions).set(id, 'remove'),
                            meta: d.meta,
                          }))
                        }
                        onAddCollection={(result) =>
                          setExcludedCollections((d) => {
                            const actions = new Map(d.actions).set(
                              result.shopifyCollectionId,
                              'add',
                            );
                            const meta = new Map(d.meta).set(result.shopifyCollectionId, {
                              ...result,
                              productCount: null,
                            });
                            return { actions, meta };
                          })
                        }
                        onRemoveCollection={(id) =>
                          setExcludedCollections((d) => ({
                            actions: new Map(d.actions).set(id, 'remove'),
                            meta: d.meta,
                          }))
                        }
                        setError={setError}
                      />
                    )}
                  </Box>
                </Tabs>
              )}
              {OUTER_TABS[outerTabIndex].id === 'routing' && (
                <RoutingTab
                  refreshToken={refreshToken}
                  onChanged={() => setUnroutedRefreshToken((n) => n + 1)}
                />
              )}
            </Box>
          </Tabs>
        </Card>
      </BlockStack>

      {failedModalOpen && (
        <FailedProductsModal onClose={() => setFailedModalOpen(false)} setError={setError} />
      )}

      {unroutedModalOpen && <UnroutedProductsModal onClose={() => setUnroutedModalOpen(false)} />}

      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
}
