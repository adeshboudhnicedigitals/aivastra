export type PerformanceState = {
  tab: 'branches' | 'staff' | 'devices';
  branchId?: string;
  staffId?: string;
};

/**
 * The /performance URL for a state. Filters that the target tab does not apply are dropped, so a
 * chip never shows over an unfiltered table and a stale id cannot resurface on a later tab click:
 * branches keeps neither, staff keeps branchId only, devices keeps both.
 */
export function performanceUrl(s: PerformanceState): string {
  const p = new URLSearchParams({ tab: s.tab });
  if (s.tab !== 'branches' && s.branchId) p.set('branchId', s.branchId);
  if (s.tab === 'devices' && s.staffId) p.set('staffId', s.staffId);
  return `/performance?${p.toString()}`;
}
