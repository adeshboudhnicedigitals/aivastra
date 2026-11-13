'use client';
import type { AnalyticsHeatmapCell, AnalyticsHeatmapMetric } from '@aivastra/types';
import { useState } from 'react';
import { C, M } from '@/components/tokens';
import { formatCredits } from '@/lib/chart-scale';
import { HEAT_STEPS, heatGrid, heatLevel, hourLabel, peakLabel, WEEK_ROWS } from '@/lib/heat-scale';

// Weekday × hour grid of when the store is busy. Sequential, one hue per metric (the same
// hue the metric wears in the Try-on Performance chart), light → dark mixed into the card
// surface, so it re-steps itself in dark mode with no second palette. Zero is the divider
// grey, distinct from step 1, so "nothing happened" never reads as "a little happened".

const HUE: Record<AnalyticsHeatmapMetric, string> = { sessions: M.statusBlue, tryons: C.amber };
const NOUN: Record<AnalyticsHeatmapMetric, [string, string]> = {
  sessions: ['session', 'sessions'],
  tryons: ['try-on', 'try-ons'],
};

function fill(metric: AnalyticsHeatmapMetric, level: number): string {
  if (level === 0) return `color-mix(in srgb, ${M.divider} 45%, ${C.card})`;
  // 25% → 100% across the steps: step 1 still clears the zero grey.
  const pct = 25 + Math.round(((level - 1) / (HEAT_STEPS - 1)) * 75);
  return `color-mix(in srgb, ${HUE[metric]} ${pct}%, ${C.card})`;
}

// Values, not indexes, so each mapped element keys on what it is.
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const LEVELS = Array.from({ length: HEAT_STEPS + 1 }, (_, l) => l);

const count = (metric: AnalyticsHeatmapMetric, v: number) =>
  `${formatCredits(v)} ${NOUN[metric][v === 1 ? 0 : 1]}`;

export function PeakHoursHeatmap({
  cells,
  metric,
}: {
  cells: AnalyticsHeatmapCell[];
  metric: AnalyticsHeatmapMetric;
}): React.ReactElement {
  const grid = heatGrid(cells);
  const rows = WEEK_ROWS.map((row, r) => ({ ...row, r, values: grid[r] ?? [] }));
  const max = Math.max(0, ...grid.flat());
  const peak = peakLabel(grid);
  const [hover, setHover] = useState<[number, number] | null>(null);

  const hovered = hover ? rows[hover[0]] : undefined;
  const readout =
    hover && hovered
      ? `${hovered.label} ${hourLabel(hover[1])}: ${count(metric, hovered.values[hover[1]] ?? 0)}`
      : peak
        ? `Busiest: ${peak} (${count(metric, max)})`
        : `No ${NOUN[metric][1]} in this period yet.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <p
        aria-live="polite"
        style={{ margin: 0, fontSize: 12, fontWeight: 600, color: M.textSecondary, minHeight: 15 }}
      >
        {readout}
      </p>

      {/* The grid scrolls inside the card at phone width; the page never scrolls sideways. */}
      <div style={{ overflowX: 'auto', paddingBottom: 4 }} aria-hidden="true">
        <div
          onPointerLeave={() => setHover(null)}
          style={{
            display: 'grid',
            gridTemplateColumns: '34px repeat(24, minmax(16px, 1fr))',
            gap: 2,
            minWidth: 34 + 24 * 18,
          }}
        >
          {rows.map((row) => (
            <div key={row.weekday} style={{ display: 'contents' }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: M.textMuted,
                  alignSelf: 'center',
                }}
              >
                {row.label}
              </span>
              {HOURS.map((h) => {
                const v = row.values[h] ?? 0;
                const on = hover?.[0] === row.r && hover[1] === h;
                return (
                  <div
                    key={h}
                    onPointerEnter={() => setHover([row.r, h])}
                    style={{
                      height: 18,
                      borderRadius: 4,
                      background: fill(metric, heatLevel(v, max)),
                      outline: on ? `2px solid ${C.text}` : 'none',
                      outlineOffset: -1,
                    }}
                  />
                );
              })}
            </div>
          ))}
          <span />
          {HOURS.map((h) => (
            <span key={h} style={{ fontSize: 10, color: M.textMuted, textAlign: 'center' }}>
              {h % 3 === 0 ? hourLabel(h).replace(' ', '') : ''}
            </span>
          ))}
        </div>
      </div>

      <div
        aria-hidden="true"
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: M.textMuted }}
      >
        <span>Less</span>
        {LEVELS.map((l) => (
          <span
            key={l}
            style={{ width: 14, height: 10, borderRadius: 3, background: fill(metric, l) }}
          />
        ))}
        <span>More</span>
      </div>

      {/* The same numbers for screen readers: the grid above is colour-only. The wrapper
          carries sr-only because a <table> ignores width/overflow and would widen the page. */}
      <div className="sr-only">
        <table>
          <caption>
            {NOUN[metric][1]} by weekday and hour{peak ? `, busiest ${peak}` : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {HOURS.map((h) => (
                <th key={h} scope="col">
                  {hourLabel(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.weekday}>
                <th scope="row">{row.label}</th>
                {HOURS.map((h) => (
                  <td key={h}>{row.values[h] ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
