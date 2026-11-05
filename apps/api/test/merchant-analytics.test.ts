import { describe, expect, it } from 'vitest';
import { foldCategories, rankCounted } from '../src/modules/merchant/analytics';

describe('rankCounted', () => {
  it('sorts by tryOns desc and breaks ties by name asc', () => {
    expect(
      rankCounted([
        { name: 'b', tryOns: 2 },
        { name: 'a', tryOns: 2 },
        { name: 'c', tryOns: 5 },
      ]).map((r) => r.name),
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('foldCategories', () => {
  it('returns [] for no rows', () => {
    expect(foldCategories([])).toEqual([]);
  });

  it('computes pct over the full total', () => {
    expect(
      foldCategories([
        { name: 'Saree', tryOns: 3 },
        { name: 'Kurta', tryOns: 1 },
      ]),
    ).toEqual([
      { name: 'Saree', tryOns: 3, pct: 75 },
      { name: 'Kurta', tryOns: 1, pct: 25 },
    ]);
  });

  it('folds everything past the top 6 into Other', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ name: `c${i}`, tryOns: 8 - i }));
    const out = foldCategories(rows);
    expect(out).toHaveLength(7);
    expect(out[6]).toMatchObject({ name: 'Other', tryOns: 2 + 1 });
    expect(out.reduce((n, r) => n + r.tryOns, 0)).toBe(36);
  });
});
