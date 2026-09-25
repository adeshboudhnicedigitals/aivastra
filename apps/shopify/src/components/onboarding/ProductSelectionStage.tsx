import {
  Badge,
  BlockStack,
  ChoiceList,
  IndexFilters,
  IndexFiltersMode,
  IndexTable,
  IndexTableSelectionType,
  InlineStack,
  Text,
  Thumbnail,
} from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { type ClassifiedError, classifyError } from '../../lib/errors';
import {
  EMPTY_SELECTION,
  isSelected,
  type Selection,
  selectAllMatching,
  selectedCount,
  setMany,
} from '../../lib/productSelection';
import {
  CLEARED_FILTER,
  DEFAULT_SELECTION_FILTER,
  filterToParams,
  type ProductFilterState,
} from '../../lib/products';
import type {
  FacetList,
  ShopifyProductFacets,
  ShopifyProductListItem,
  ShopifyProductsResponse,
} from '../../types';
import { ErrorBanner } from '../ErrorBanner';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export interface StagePick {
  selection: Selection;
  filter: ProductFilterState;
  total: number;
  /** Every product the picker has loaded, so the page can list the ticked ones without refetching. */
  items: ShopifyProductListItem[];
}

type ListKey = 'productType' | 'vendor' | 'tag' | 'collection' | 'category';

const LIST_FILTERS: Array<{ key: ListKey; label: string; facet: keyof ShopifyProductFacets }> = [
  { key: 'productType', label: 'Product type', facet: 'productTypes' },
  { key: 'vendor', label: 'Vendor', facet: 'vendors' },
  { key: 'tag', label: 'Tag', facet: 'tags' },
  { key: 'collection', label: 'Collection', facet: 'collections' },
  { key: 'category', label: 'Category', facet: 'categories' },
];

const STATUS_CHOICES = [
  { label: 'Active', value: 'active' },
  { label: 'Processing', value: 'processing' },
  { label: 'Failed', value: 'failed' },
];

const STATUS_TONE: Record<string, 'success' | 'attention' | 'critical'> = {
  active: 'success',
  processing: 'attention',
  failed: 'critical',
};

export function ProductSelectionStage({
  onPickChange,
  initial,
}: {
  onPickChange: (pick: StagePick) => void;
  /** Where to start from — reopening the picker restores the last confirmed pick. */
  initial?: StagePick;
}) {
  const [filter, setFilter] = useState<ProductFilterState>(
    initial?.filter ?? DEFAULT_SELECTION_FILTER,
  );
  const [queryInput, setQueryInput] = useState(initial?.filter.q ?? '');
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<Selection>(initial?.selection ?? EMPTY_SELECTION);
  const [seen, setSeen] = useState<Map<number, ShopifyProductListItem>>(
    () => new Map((initial?.items ?? []).map((i) => [i.shopifyProductId, i])),
  );
  const [data, setData] = useState<ShopifyProductsResponse | null>(null);
  const [facets, setFacets] = useState<ShopifyProductFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClassifiedError | null>(null);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // Report the latest pick upward so the picker's confirm button can act on it.
  const seenItems = useMemo(() => [...seen.values()], [seen]);
  useEffect(() => {
    onPickChange({ selection, filter, total, items: seenItems });
  }, [selection, filter, total, seenItems, onPickChange]);

  const updateFilter = useCallback((patch: Partial<ProductFilterState>) => {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(1);
    // "All matching" is bound to the filter it was made under; a different filter
    // would silently mean different products, so it is dropped. Ticked ids are
    // specific products and survive.
    setSelection((prev) => (prev.kind === 'all' ? EMPTY_SELECTION : prev));
  }, []);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    if (queryInput === filter.q) return;
    const t = setTimeout(() => updateFilter({ q: queryInput }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [queryInput, filter.q, updateFilter]);

  useEffect(() => {
    apiFetch<ShopifyProductFacets>('/v1/shopify/products/facets')
      .then(setFacets)
      // Filters are a convenience; the list still works without their options.
      .catch(() => setFacets(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<ShopifyProductsResponse>(
      `/v1/shopify/products?${filterToParams(filter, { page, pageSize: PAGE_SIZE })}`,
    )
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setSeen((prev) => {
          const next = new Map(prev);
          for (const item of res.items) next.set(item.shopifyProductId, item);
          return next;
        });
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(classifyError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, page]);

  const pageIds = items.map((i) => i.shopifyProductId);

  function handleSelectionChange(
    type: IndexTableSelectionType,
    selecting: boolean,
    arg?: string | [number, number],
  ) {
    switch (type) {
      case IndexTableSelectionType.All:
        setSelection(selecting ? selectAllMatching() : EMPTY_SELECTION);
        break;
      case IndexTableSelectionType.Page:
        setSelection((s) =>
          // Polaris's "Undo" on the select-all banner arrives as Page + selecting while
          // every match is selected (the header checkbox sends Page + false in that
          // state), and must fall back to just this page rather than stay on "all".
          selecting && s.kind === 'all' && s.excluded.size === 0
            ? { kind: 'ids', ids: new Set(pageIds) }
            : setMany(s, pageIds, selecting),
        );
        break;
      case IndexTableSelectionType.Single:
        setSelection((s) => setMany(s, [Number(arg)], selecting));
        break;
      default: {
        // Multi / Range: a [from, to] span of row positions on this page.
        const [from, to] = arg as [number, number];
        setSelection((s) => setMany(s, pageIds.slice(from, to + 1), selecting));
      }
    }
  }

  const facetOptions = (list: FacetList | undefined) =>
    (list?.values ?? []).map((v) => ({ label: v, value: v }));

  const filters = [
    ...LIST_FILTERS.filter(({ facet }) => (facets?.[facet].values.length ?? 0) > 0).map(
      ({ key, label, facet }) => ({
        key,
        label,
        filter: (
          <BlockStack gap="200">
            <ChoiceList
              title={label}
              titleHidden
              allowMultiple
              choices={facetOptions(facets?.[facet])}
              selected={filter[key]}
              onChange={(value) => updateFilter({ [key]: value })}
            />
            {facets?.[facet].truncated && (
              <Text as="p" tone="subdued" variant="bodySm">
                Showing the first values only — use search to narrow further.
              </Text>
            )}
          </BlockStack>
        ),
        shortcut: true,
      }),
    ),
    {
      key: 'status',
      label: 'Status',
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={STATUS_CHOICES}
          selected={filter.status ? [filter.status] : []}
          onChange={(value) => updateFilter({ status: value[0] ?? null })}
        />
      ),
      pinned: true,
    },
  ];

  const appliedFilters = [
    ...LIST_FILTERS.filter(({ key }) => filter[key].length > 0).map(({ key, label }) => ({
      key,
      label: `${label}: ${filter[key].join(', ')}`,
      onRemove: () => updateFilter({ [key]: [] }),
    })),
    ...(filter.status
      ? [
          {
            key: 'status',
            label: `Status: ${filter.status}`,
            onRemove: () => updateFilter({ status: null }),
          },
        ]
      : []),
  ];

  const allSelectedNoExclusions = selection.kind === 'all' && selection.excluded.size === 0;
  const pageSelectedCount = items.filter((i) => isSelected(selection, i.shopifyProductId)).length;
  const count = selectedCount(selection, total);

  return (
    <BlockStack gap="300">
      <ErrorBanner error={error} onRetry={() => updateFilter({})} />
      <IndexFilters
        tabs={[]}
        selected={0}
        onSelect={() => {}}
        canCreateNewView={false}
        // Pinned to Filtering so the search box and filter pills are always
        // showing instead of hiding behind the collapsed "search and filter"
        // button. No cancel/primary action is passed, so nothing in Polaris
        // offers a way out; the no-op setMode also absorbs its Escape handler.
        mode={IndexFiltersMode.Filtering}
        setMode={() => {}}
        queryValue={queryInput}
        queryPlaceholder="Search products by title"
        onQueryChange={setQueryInput}
        onQueryClear={() => {
          setQueryInput('');
          updateFilter({ q: '' });
        }}
        filters={filters}
        appliedFilters={appliedFilters}
        onClearAll={() => {
          setQueryInput('');
          updateFilter({ ...CLEARED_FILTER });
        }}
        loading={loading}
        disableStickyMode
      />
      <InlineStack align="space-between" blockAlign="center">
        <Text as="p" tone="subdued">
          {count} of {total} product{total === 1 ? '' : 's'} selected
        </Text>
      </InlineStack>
      <IndexTable
        resourceName={{ singular: 'product', plural: 'products' }}
        itemCount={items.length}
        selectedItemsCount={allSelectedNoExclusions ? 'All' : pageSelectedCount}
        onSelectionChange={handleSelectionChange}
        hasMoreItems={total > items.length}
        paginatedSelectAllText={`All ${total} matching products are selected`}
        // Polaris defaults this to "Select all {itemCount}", i.e. the page size, not the match count.
        paginatedSelectAllActionText={`Select all ${total} matching products`}
        loading={loading}
        headings={[
          { title: 'Product' },
          { title: 'Type' },
          { title: 'Vendor' },
          { title: 'Status' },
        ]}
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
            selected={isSelected(selection, item.shopifyProductId)}
          >
            <IndexTable.Cell>
              <InlineStack gap="300" blockAlign="center">
                <Thumbnail source={item.thumbnailUrl} alt={item.title ?? 'Product'} size="small" />
                <Text as="span" fontWeight="semibold">
                  {item.title}
                </Text>
              </InlineStack>
            </IndexTable.Cell>
            <IndexTable.Cell>{item.productType ?? '—'}</IndexTable.Cell>
            <IndexTable.Cell>{item.vendor ?? '—'}</IndexTable.Cell>
            <IndexTable.Cell>
              <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>
    </BlockStack>
  );
}
