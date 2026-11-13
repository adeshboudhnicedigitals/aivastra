import { type AnyColumn, and, ilike, or, type SQL } from 'drizzle-orm';

// A kiosk shopper types "red shirt", not the exact stored phrase. Every word has to
// appear (in any order, in any of the columns), so "red shirt" finds "Cotton Shirt - Red".
// Capped so a pasted paragraph can't turn into dozens of ILIKE clauses.
const MAX_TERMS = 8;

/** One AND-of-ORs condition for a free-text search over `columns`, or undefined when blank. */
export function catalogSearchCondition(columns: AnyColumn[], search: string): SQL | undefined {
  const terms = search.trim().split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);
  if (terms.length === 0) return undefined;
  return and(
    ...terms.map((term) => {
      // Escape LIKE metacharacters so "100%" searches for a literal percent sign.
      const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
      return or(...columns.map((c) => ilike(c, pattern)));
    }),
  );
}
