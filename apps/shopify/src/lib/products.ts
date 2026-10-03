/** Everything the product filter UI can set. Mirrors the API's ProductFilter. */
export interface ProductFilterState {
  q: string;
  status: string | null;
  productType: string[];
  vendor: string[];
  tag: string[];
  collection: string[];
  category: string[];
  // Not user-facing controls — set by stage 2 to scope its list.
  enabled?: boolean;
  excluded?: boolean;
}

/** No filter at all. */
export const CLEARED_FILTER: ProductFilterState = {
  q: '',
  status: null,
  productType: [],
  vendor: [],
  tag: [],
  collection: [],
  category: [],
};

// Only active products can be enabled, so that is what the picker starts on —
// the merchant can remove the chip to see processing/failed ones.
export const DEFAULT_SELECTION_FILTER: ProductFilterState = {
  ...CLEARED_FILTER,
  status: 'active',
};

const LIST_KEYS = ['productType', 'vendor', 'tag', 'collection', 'category'] as const;

/** Query string for GET /v1/shopify/products. */
export function filterToParams(
  f: ProductFilterState,
  paging?: { page: number; pageSize: number },
): URLSearchParams {
  const params = new URLSearchParams();
  const q = f.q.trim();
  if (q) params.set('q', q);
  if (f.status) params.set('status', f.status);
  if (f.enabled !== undefined) params.set('enabled', String(f.enabled));
  if (f.excluded !== undefined) params.set('excluded', String(f.excluded));
  for (const key of LIST_KEYS) for (const value of f[key]) params.append(key, value);
  if (paging) {
    params.set('page', String(paging.page));
    params.set('pageSize', String(paging.pageSize));
  }
  return params;
}

/** The `filter` object for POST /v1/shopify/products/bulk — empty fields dropped. */
export function filterToBody(f: ProductFilterState): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const q = f.q.trim();
  if (q) body.q = q;
  if (f.status) body.status = f.status;
  if (f.enabled !== undefined) body.enabled = f.enabled;
  if (f.excluded !== undefined) body.excluded = f.excluded;
  for (const key of LIST_KEYS) if (f[key].length > 0) body[key] = f[key];
  return body;
}
