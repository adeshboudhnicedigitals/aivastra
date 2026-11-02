import { filterToBody, type ProductFilterState } from './products';

/**
 * What the merchant has ticked in the product picker. Two shapes because "Select
 * all N matching" must survive paging: `all` means "every product the filter
 * matches, except these", so a deselect after select-all is remembered without
 * ever loading the other pages.
 */
export type Selection =
  | { kind: 'ids'; ids: ReadonlySet<number> }
  | { kind: 'all'; excluded: ReadonlySet<number> };

export const EMPTY_SELECTION: Selection = { kind: 'ids', ids: new Set() };

export function selectAllMatching(): Selection {
  return { kind: 'all', excluded: new Set() };
}

export function isSelected(s: Selection, id: number): boolean {
  return s.kind === 'ids' ? s.ids.has(id) : !s.excluded.has(id);
}

/** `total` is the number of products the current filter matches. */
export function selectedCount(s: Selection, total: number): number {
  return s.kind === 'ids' ? s.ids.size : Math.max(0, total - s.excluded.size);
}

/** Select or deselect several ids at once. Returns a new Selection. */
export function setMany(s: Selection, ids: number[], selecting: boolean): Selection {
  if (s.kind === 'ids') {
    const next = new Set(s.ids);
    for (const id of ids) {
      if (selecting) next.add(id);
      else next.delete(id);
    }
    return { kind: 'ids', ids: next };
  }
  const next = new Set(s.excluded);
  for (const id of ids) {
    // In "all" mode, selecting means "no longer excluded".
    if (selecting) next.delete(id);
    else next.add(id);
  }
  return { kind: 'all', excluded: next };
}

/** The `target` for POST /v1/shopify/products/bulk. */
export function toBulkTarget(
  s: Selection,
  filter: ProductFilterState,
): { ids: number[] } | { filter: Record<string, unknown>; excludeIds?: number[] } {
  if (s.kind === 'ids') return { ids: [...s.ids] };
  return s.excluded.size > 0
    ? { filter: filterToBody(filter), excludeIds: [...s.excluded] }
    : { filter: filterToBody(filter) };
}
