import type { KpiDelta } from '@/components/analytics/KpiCard';

// Period-over-period change for a KPI card. `lowerIsBetter` flips which direction reads as good
// (failure rate, wait, credits spent), so a drop is green and a rise is red.

/** Percent change; null when the previous period gives nothing to compare with. */
export function pctChange(
  cur: number | null,
  prev: number | null,
  lowerIsBetter = false,
): KpiDelta | null {
  if (cur === null || prev === null || prev <= 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 1000) / 10;
  return { text: `${pct >= 0 ? '+' : ''}${pct}%`, positive: lowerIsBetter ? pct <= 0 : pct >= 0 };
}

/** Change of a rate that is itself a percentage, in percentage points. */
export function pointsChange(
  cur: number | null,
  prev: number | null,
  lowerIsBetter = false,
): KpiDelta | null {
  if (cur === null || prev === null) return null;
  const pts = Math.round((cur - prev) * 10000) / 100;
  return {
    text: `${pts >= 0 ? '+' : ''}${pts} percentage points`,
    positive: lowerIsBetter ? pts <= 0 : pts >= 0,
  };
}
