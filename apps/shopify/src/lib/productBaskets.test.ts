import { describe, expect, it } from 'vitest';
import { basketsComplete, selectAllMatching, toBasketedBulkBodies } from './productSelection';
import { CLEARED_FILTER } from './products';

const ids = (...n: number[]) => ({ kind: 'ids' as const, ids: new Set(n) });

describe('basketsComplete', () => {
  it('needs a basket, its own or the one for everything, for every picked product', () => {
    expect(basketsComplete(ids(1, 2), { 1: 'a' }, '')).toBe(false);
    expect(basketsComplete(ids(1, 2), { 1: 'a', 2: 'b' }, '')).toBe(true);
    expect(basketsComplete(ids(1, 2), { 1: 'a' }, 'z')).toBe(true);
  });

  it('needs the basket for everything when "all matching" is picked', () => {
    expect(basketsComplete(selectAllMatching(), { 1: 'a' }, '')).toBe(false);
    expect(basketsComplete(selectAllMatching(), {}, 'z')).toBe(true);
  });
});

describe('toBasketedBulkBodies', () => {
  it('makes one enabling call per distinct basket for ticked products', () => {
    const bodies = toBasketedBulkBodies(ids(1, 2, 3), CLEARED_FILTER, { 2: 'b' }, 'a');
    expect(bodies).toEqual([
      { target: { ids: [1, 3] }, enabled: true, funnelTemplateId: 'a' },
      { target: { ids: [2] }, enabled: true, funnelTemplateId: 'b' },
    ]);
  });

  it('enables "all matching" under the default basket, then re-pins the others by id', () => {
    const selection = { kind: 'all' as const, excluded: new Set([9]) };
    const bodies = toBasketedBulkBodies(selection, CLEARED_FILTER, { 2: 'b', 3: 'a', 9: 'b' }, 'a');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ enabled: true, funnelTemplateId: 'a' });
    expect(bodies[0].target).toMatchObject({ excludeIds: [9] });
    // 3 already has the default basket and 9 is excluded, so only 2 is re-pinned.
    expect(bodies[1]).toEqual({ target: { ids: [2] }, enabled: true, funnelTemplateId: 'b' });
  });
});
