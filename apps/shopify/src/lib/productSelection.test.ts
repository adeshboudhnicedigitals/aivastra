import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  isSelected,
  selectAllMatching,
  selectedCount,
  setMany,
  toBulkTarget,
} from './productSelection';
import { CLEARED_FILTER } from './products';

describe('explicit selection', () => {
  it('selects and deselects ids', () => {
    let s = setMany(EMPTY_SELECTION, [1, 2, 3], true);
    expect(selectedCount(s, 100)).toBe(3);
    s = setMany(s, [2], false);
    expect(isSelected(s, 2)).toBe(false);
    expect(isSelected(s, 1)).toBe(true);
    expect(selectedCount(s, 100)).toBe(2);
  });

  it('does not mutate the previous selection', () => {
    const before = setMany(EMPTY_SELECTION, [1], true);
    setMany(before, [2], true);
    expect(selectedCount(before, 100)).toBe(1);
  });

  it('becomes a plain { ids } bulk target', () => {
    const s = setMany(EMPTY_SELECTION, [3, 1], true);
    expect(toBulkTarget(s, CLEARED_FILTER)).toEqual({ ids: [3, 1] });
  });
});

describe('select all matching', () => {
  it('counts every match, minus the ones deselected afterwards', () => {
    let s = selectAllMatching();
    expect(selectedCount(s, 137)).toBe(137);
    expect(isSelected(s, 42)).toBe(true);
    s = setMany(s, [42, 43], false);
    expect(isSelected(s, 42)).toBe(false);
    expect(isSelected(s, 44)).toBe(true);
    expect(selectedCount(s, 137)).toBe(135);
  });

  it('re-selecting a deselected row removes it from the exclusions', () => {
    let s = setMany(selectAllMatching(), [7], false);
    s = setMany(s, [7], true);
    expect(isSelected(s, 7)).toBe(true);
    expect(toBulkTarget(s, CLEARED_FILTER)).toEqual({ filter: {} });
  });

  it('becomes a filter target carrying the exclusions', () => {
    const s = setMany(selectAllMatching(), [9], false);
    expect(toBulkTarget(s, { ...CLEARED_FILTER, status: 'active', vendor: ['Acme'] })).toEqual({
      filter: { status: 'active', vendor: ['Acme'] },
      excludeIds: [9],
    });
  });

  it('never reports a negative count', () => {
    const s = setMany(selectAllMatching(), [1, 2, 3], false);
    expect(selectedCount(s, 2)).toBe(0);
  });
});
