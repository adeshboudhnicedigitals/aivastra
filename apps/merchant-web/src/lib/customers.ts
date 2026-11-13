import type { CustomerFilters } from '@aivastra/types';

// Pure helpers for the Customers screen (CRM phase 4).

export const EMPTY_FILTERS: CustomerFilters = { marketing: 'any' };

/** Only the filters actually set, so a URL and a saved segment stay short and stable. */
export function filtersToQuery(
  f: CustomerFilters,
  extra: Record<string, string | number | undefined> = {},
): string {
  const p = new URLSearchParams();
  if (f.q?.trim()) p.set('q', f.q.trim());
  if (f.branchId) p.set('branchId', f.branchId);
  if (f.marketing && f.marketing !== 'any') p.set('marketing', f.marketing);
  if (f.lastVisitFrom) p.set('lastVisitFrom', f.lastVisitFrom);
  if (f.lastVisitTo) p.set('lastVisitTo', f.lastVisitTo);
  if (f.minVisits) p.set('minVisits', String(f.minVisits));
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function hasFilters(f: CustomerFilters): boolean {
  return filtersToQuery(f) !== '';
}

export function consentLabel(v: boolean | null): string {
  return v === null ? 'Not asked' : v ? 'Yes' : 'No';
}

/** What the blank-name customers show as: they gave a number but no name. */
export function displayName(name: string | null): string {
  return name?.trim() || 'Unnamed';
}
