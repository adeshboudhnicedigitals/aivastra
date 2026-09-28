import {
  Badge,
  BlockStack,
  ChoiceList,
  IndexFilters,
  IndexFiltersMode,
  IndexTable,
  IndexTableSelectionType,
  InlineStack,
  Select,
  Text,
  Thumbnail,
} from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { type Basket, basketOptions } from '../../lib/baskets';
import { type ClassifiedError, classifyError } from '../../lib/errors';
import { resolveImageUrl } from '../../lib/images';
import {
  EMPTY_SELECTION,
  effectiveBasket,
  isSelected,
  type Selection,
  selectAllMatching,
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
  /** Basket chosen for one product, by id; beats `defaultBasket`. Empty when the picker has no basket column. */
  baskets: Record<number, string>;
  /** Basket chosen for every selected product ('' = none). */
  defaultBasket: string;
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
  startFilter = DEFAULT_SELECTION_FILTER,
  locked,
  allowSelectAll = true,
  baskets,
}: {
  onPickChange: (pick: StagePick) => void;
  /** Where to start from — reopening the picker restores the last confirmed pick. */
  initial?: StagePick;
  /** The filter a fresh picker opens on (ignored when `initial` is given). */
  startFilter?: ProductFilterState;
  /**
   * Filter fields the merchant cannot change — e.g. the Manage page's "Add
   * products" only lists active, not-yet-enabled products. Applied over the
   * merchant's own filter on every request. Must be a stable reference (declare
   * it at module level). A locked `status` also hides the Status filter.
   */
  locked?: Partial<ProductFilterState>;
  /**
   * Offer "Select all N matching". Off ticks one page at a time (ticks survive
   * paging), for callers that need concrete product ids rather than a filter.
   */
  allowSelectAll?: boolean;
  /**
   * Adds a last "Try-on style" column plus one control that sets the basket for
   * every selected product. When given, this same table doubles as the one
   * place a merchant sees their products: an already-enabled row loads ticked
   * with its current style seeded in (see the fetch effect), so it reads and
   * behaves exactly like a fresh pick — ticking, unticking and changing style
   * are all just local draft edits here, nothing is sent to the server until
   * the caller commits the reported `selection`/`baskets` (onboarding's
   * Continue button does this once, not per edit — see OnboardingProductsPage).
   * Omit for pickers that only choose products and stage everything anyway
   * (Manage's eligibility lists).
   */
  baskets?: Basket[];
}) {
  const [userFilter, setFilter] = useState<ProductFilterState>(initial?.filter ?? startFilter);
  const filter = useMemo(() => ({ ...userFilter, ...locked }), [userFilter, locked]);
  const statusLocked = locked?.status != null;
  const [queryInput, setQueryInput] = useState(initial?.filter.q ?? '');
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<Selection>(initial?.selection ?? EMPTY_SELECTION);
  const [seen, setSeen] = useState<Map<number, ShopifyProductListItem>>(
    () => new Map((initial?.items ?? []).map((i) => [i.shopifyProductId, i])),
  );
  const [basketChoices, setBasketChoices] = useState<Record<number, string>>(
    initial?.baskets ?? {},
  );
  const [defaultBasket, setDefaultBasket] = useState(initial?.defaultBasket ?? '');
  const [data, setData] = useState<ShopifyProductsResponse | null>(null);
  const [facets, setFacets] = useState<ShopifyProductFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClassifiedError | null>(null);
  // Each already-enabled id is ticked (and its style seeded) the first time it's
  // seen, then never again — otherwise a page refetch after the merchant's own
  // untick would stomp the tick right back in.
  const seededRef = useRef<Set<number>>(new Set());

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // Report the latest pick upward. The caller commits it (bulk-enables/pins
  // everything ticked, individually disables an already-live id that got
  // unticked) once, on its own trigger — nothing here talks to the server.
  const seenItems = useMemo(() => [...seen.values()], [seen]);
  useEffect(() => {
    onPickChange({
      selection,
      filter,
      total,
      items: seenItems,
      baskets: basketChoices,
      defaultBasket,
    });
  }, [selection, filter, total, seenItems, basketChoices, defaultBasket, onPickChange]);

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
        // Seed ticks/styles for products that were already enabled before this
        // table ever loaded them, once each — only relevant when this table
        // doubles as the merchant's whole product list (baskets given).
        if (baskets) {
          for (const item of res.items) {
            if (seededRef.current.has(item.shopifyProductId)) continue;
            seededRef.current.add(item.shopifyProductId);
            if (!item.enabled) continue;
            const id = item.shopifyProductId;
            const basketId = item.basket?.id;
            setSelection((s) => (isSelected(s, id) ? s : setMany(s, [id], true)));
            if (basketId) setBasketChoices((prev) => ({ ...prev, [id]: basketId }));
          }
        }
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
  }, [filter, page, baskets]);

  const pageIds = items.map((i) => i.shopifyProductId);

  function handleSelectionChange(
    type: IndexTableSelectionType,
    selecting: boolean,
    arg?: string | [number, number],
  ) {
    switch (type) {
      case IndexTableSelectionType.All:
        // Only reachable from the "select all matching" banner, which is not
        // shown when allowSelectAll is off; guard anyway so it can never mean it.
        setSelection(selecting && allowSelectAll ? selectAllMatching() : EMPTY_SELECTION);
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

  // The basket for everything selected replaces any per-product choices made
  // before it, so the last thing the merchant did is what they see.
  function applyBasketToAll(basketId: string) {
    setDefaultBasket(basketId);
    setBasketChoices({});
  }

  // Picking a basket for a row is also picking the product.
  function chooseBasket(id: number, basketId: string) {
    setBasketChoices((prev) => ({ ...prev, [id]: basketId }));
    setSelection((s) => (isSelected(s, id) ? s : setMany(s, [id], true)));
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
    ...(statusLocked
      ? []
      : [
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
        ]),
  ];

  const appliedFilters = [
    ...LIST_FILTERS.filter(({ key }) => filter[key].length > 0).map(({ key, label }) => ({
      key,
      label: `${label}: ${filter[key].join(', ')}`,
      onRemove: () => updateFilter({ [key]: [] }),
    })),
    ...(filter.status && !statusLocked
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

  return (
    <BlockStack gap="300">
      {/* Polaris makes this sticky by default at >=48em (its own IndexTable.css
          media query) — pinned to the bottom of the viewport, it floats over
          the rows while scrolling. Force it back into normal flow at every
          width instead, using Polaris's own stable public class name. */}
      <style>{`.Polaris-IndexTable__PaginationWrapper {
        position: static;
      }
      /* Selecting a row switches Polaris into "select mode": a sticky
         BulkActionsWrapper bar (its own opaque surface, positioned over the
         real column headings) fades in and covers them — that's what read as
         "the table heading goes invisible". This table has no bulk actions
         and this app already dropped the selected-count line (see
         OnboardingProductsPage.tsx), so there is nothing useful the bar would
         show anyway — keep it permanently hidden instead of letting it cover
         the headings. */
      .Polaris-IndexTable__BulkActionsWrapper.Polaris-IndexTable__BulkActionsWrapperVisible {
        visibility: hidden !important;
        opacity: 0 !important;
      }`}</style>
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
      {baskets && (
        <InlineStack align="end" blockAlign="center" gap="300">
          <div style={{ minWidth: 260 }}>
            <Select
              label="Try-on style for all selected products"
              labelInline
              options={basketOptions(baskets)}
              value={defaultBasket}
              disabled={baskets.length === 0}
              onChange={applyBasketToAll}
            />
          </div>
        </InlineStack>
      )}
      <IndexTable
        resourceName={{ singular: 'product', plural: 'products' }}
        itemCount={items.length}
        selectedItemsCount={allSelectedNoExclusions ? 'All' : pageSelectedCount}
        onSelectionChange={handleSelectionChange}
        hasMoreItems={allowSelectAll && total > items.length}
        paginatedSelectAllText={`All ${total} matching products are selected`}
        // Polaris defaults this to "Select all {itemCount}", i.e. the page size, not the match count.
        paginatedSelectAllActionText={`Select all ${total} matching products`}
        loading={loading}
        headings={[
          { title: 'Product' },
          { title: 'Type' },
          { title: 'Vendor' },
          { title: 'Status' },
          ...(baskets ? [{ title: 'Try-on style' }] : []),
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
                <Thumbnail
                  source={resolveImageUrl(item.thumbnailUrl)}
                  alt={item.title ?? 'Product'}
                  size="small"
                />
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
            {baskets && (
              <IndexTable.Cell>
                {/* Keeps a click on the dropdown from also toggling the row's tick. */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: click is only stopped from bubbling to the row; the Select inside is the interactive control */}
                <div
                  role="presentation"
                  style={{ minWidth: 180 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Select
                    label="Try-on style"
                    labelHidden
                    options={basketOptions(baskets)}
                    value={effectiveBasket(item.shopifyProductId, basketChoices, defaultBasket)}
                    disabled={baskets.length === 0}
                    onChange={(value) => chooseBasket(item.shopifyProductId, value)}
                  />
                </div>
              </IndexTable.Cell>
            )}
          </IndexTable.Row>
        ))}
      </IndexTable>
    </BlockStack>
  );
}
