import { describe, expect, it } from 'vitest';
import { sortRows } from './table-sort';

type R = { id: string; name: string | null; n: number | null };

describe('sortRows', () => {
  it('sorts numbers numerically, not as strings', () => {
    const rows: R[] = [
      { id: 'a', name: 'x', n: 10 },
      { id: 'b', name: 'x', n: 9 },
      { id: 'c', name: 'x', n: 100 },
    ];
    expect(sortRows(rows, 'n', 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
  it('sorts strings with localeCompare', () => {
    const rows: R[] = [
      { id: '1', name: 'banana', n: 0 },
      { id: '2', name: 'Apple', n: 0 },
      { id: '3', name: 'cherry', n: 0 },
    ];
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['Apple', 'banana', 'cherry']);
  });
  it('sorts descending', () => {
    const rows: R[] = [
      { id: 'a', name: 'x', n: 1 },
      { id: 'b', name: 'x', n: 3 },
      { id: 'c', name: 'x', n: 2 },
    ];
    expect(sortRows(rows, 'n', 'desc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
  it('keeps ties in input order in both directions', () => {
    const rows: R[] = [
      { id: 'a', name: 'x', n: 1 },
      { id: 'b', name: 'x', n: 1 },
      { id: 'c', name: 'x', n: 1 },
    ];
    expect(sortRows(rows, 'n', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, 'n', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('does not mutate the input', () => {
    const rows: R[] = [
      { id: 'a', name: 'x', n: 2 },
      { id: 'b', name: 'x', n: 1 },
    ];
    const copy = structuredClone(rows);
    const out = sortRows(rows, 'n', 'asc');
    expect(rows).toEqual(copy);
    expect(out).not.toBe(rows);
  });
  it('puts null and undefined last in both directions', () => {
    const rows: R[] = [
      { id: 'a', name: 'x', n: null },
      { id: 'b', name: 'x', n: 5 },
      { id: 'c', name: 'x', n: undefined as unknown as null },
      { id: 'd', name: 'x', n: 1 },
    ];
    expect(sortRows(rows, 'n', 'asc').map((r) => r.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(sortRows(rows, 'n', 'desc').map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});
