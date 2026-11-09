/**
 * Stable sort by one column. Numbers compare numerically, everything else via localeCompare.
 * null/undefined sort last in BOTH directions (a missing value is never "the biggest").
 * Returns a new array; the input is not mutated.
 */
export function sortRows<T>(rows: readonly T[], key: keyof T, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = a.row[key];
      const y = b.row[key];
      const xNil = x === null || x === undefined;
      const yNil = y === null || y === undefined;
      if (xNil || yNil) return xNil && yNil ? a.i - b.i : xNil ? 1 : -1;
      let c: number;
      if (typeof x === 'number' && typeof y === 'number') c = x - y;
      else c = String(x).localeCompare(String(y));
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((e) => e.row);
}
