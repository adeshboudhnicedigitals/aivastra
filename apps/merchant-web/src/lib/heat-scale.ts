import type { AnalyticsHeatmapCell } from '@aivastra/types';

/** Number of non-zero colour steps in the Peak Hours heatmap. */
export const HEAT_STEPS = 5;

/**
 * The colour step of one cell: 0 only for a true zero, otherwise 1..steps, scaled against the
 * busiest cell. A cell with any activity never rounds down to the "nothing" colour, so a
 * single visit at an odd hour stays visible next to a busy Saturday.
 */
export function heatLevel(value: number, max: number, steps: number = HEAT_STEPS): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(steps, Math.max(1, Math.ceil((value / max) * steps)));
}

/** Monday-first weekday rows (API weekday: 0 = Sunday … 6 = Saturday). */
export const WEEK_ROWS = [
  { weekday: 1, label: 'Mon' },
  { weekday: 2, label: 'Tue' },
  { weekday: 3, label: 'Wed' },
  { weekday: 4, label: 'Thu' },
  { weekday: 5, label: 'Fri' },
  { weekday: 6, label: 'Sat' },
  { weekday: 0, label: 'Sun' },
] as const;

/** 7 rows × 24 hours of values, Monday first; missing cells are 0. */
export function heatGrid(cells: AnalyticsHeatmapCell[]): number[][] {
  const at = new Map(cells.map((c) => [c.weekday * 24 + c.hour, c.value]));
  return WEEK_ROWS.map((r) =>
    Array.from({ length: 24 }, (_, h) => at.get(r.weekday * 24 + h) ?? 0),
  );
}

/** "10 AM", "12 PM", "12 AM": the label a store manager reads. */
export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The busiest cell as "Sat 6 PM", or null when the grid is empty. */
export function peakLabel(grid: number[][]): string | null {
  let best = 0;
  let r = -1;
  let h = -1;
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] ?? [];
    for (let j = 0; j < row.length; j++) {
      const v = row[j] ?? 0;
      if (v > best) {
        best = v;
        r = i;
        h = j;
      }
    }
  }
  const day = WEEK_ROWS[r];
  return day ? `${day.label} ${hourLabel(h)}` : null;
}
