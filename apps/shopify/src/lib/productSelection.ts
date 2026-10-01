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

/**
 * The basket a picked product will get: its own choice, else the one chosen for
 * everything. the empty string means none yet.
 */
export function effectiveBasket(
  id: number,
  baskets: Readonly<Record<number, string>>,
  defaultBasket: string,
): string {
  return baskets[id] || defaultBasket;
}

/**
 * Every picked product has a basket. With "all matching" most products were
 * never loaded and cannot have a choice of their own, so the one for everything
 * has to be set.
 */
export function basketsComplete(
  s: Selection,
  baskets: Readonly<Record<number, string>>,
  defaultBasket: string,
): boolean {
  if (s.kind === 'all') return defaultBasket !== '';
  for (const id of s.ids) if (!effectiveBasket(id, baskets, defaultBasket)) return false;
  return true;
}

/**
 * The POST /v1/shopify/products/bulk calls that enable a pick and pin its
 * baskets: one call per distinct basket, since the endpoint applies one basket
 * to a target. "All matching" is enabled under the basket for everything first;
 * products with a different choice are then re-pinned by id.
 */
export function toBasketedBulkBodies(
  s: Selection,
  filter: ProductFilterState,
  baskets: Readonly<Record<number, string>>,
  defaultBasket: string,
): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  const byBasket = new Map<string, number[]>();
  const pin = (id: number) => {
    const basket = effectiveBasket(id, baskets, defaultBasket);
    if (basket && (s.kind === 'ids' || basket !== defaultBasket)) {
      byBasket.set(basket, [...(byBasket.get(basket) ?? []), id]);
    }
  };

  if (s.kind === 'ids') {
    for (const id of s.ids) pin(id);
  } else {
    bodies.push({
      target: toBulkTarget(s, filter),
      enabled: true,
      funnelTemplateId: defaultBasket,
    });
    for (const id of Object.keys(baskets).map(Number)) if (!s.excluded.has(id)) pin(id);
  }
  for (const [funnelTemplateId, ids] of byBasket) {
    bodies.push({ target: { ids }, enabled: true, funnelTemplateId });
  }
  return bodies;
}
