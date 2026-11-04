import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

// Shared donut used by every graphical-analytics card on the dashboard (job
// success rate, worker pool breakdown, ticket status/channel) — one visual
// language for "share of a whole" across the whole page.

export const CHART_TOOLTIP_STYLE = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
};

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

export function Donut({
  data,
  centerLabel,
  centerValue,
  highlight,
  size = 160,
}: {
  data: DonutSlice[];
  centerLabel: string;
  /** Shown in the middle instead of the total — for a slice that matters more than the sum. */
  centerValue?: number;
  /** Legend row to emphasise. */
  highlight?: string;
  size?: number;
}) {
  const total = data.reduce((n, d) => n + d.value, 0);
  const inner = size * 0.325;
  const outer = size * 0.4625;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={total === 0 ? [{ name: 'none', value: 1, color: 'var(--border)' }] : data}
              dataKey="value"
              innerRadius={inner}
              outerRadius={outer}
              paddingAngle={total === 0 ? 0 : 2}
              stroke="none"
            >
              {(total === 0 ? [{ color: 'var(--border)' }] : data).map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static slice list
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            {total > 0 && <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />}
          </PieChart>
        </ResponsiveContainer>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)' }}>
            {centerValue ?? total}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{centerLabel}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 130, flex: 1 }}>
        {data.map((d) => {
          const on = d.name === highlight;
          return (
            <div
              key={d.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: on ? 14 : 13,
                padding: on ? '6px 8px' : '0 8px',
                borderRadius: 8,
                background: on ? `color-mix(in srgb, ${d.color} 16%, transparent)` : undefined,
                border: on ? `1px solid ${d.color}` : '1px solid transparent',
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: d.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  color: on ? 'var(--ink)' : 'var(--ink-2)',
                  fontWeight: on ? 700 : 400,
                }}
              >
                {d.name}
              </span>
              <b style={{ color: 'var(--ink)', fontSize: on ? 16 : undefined }}>{d.value}</b>
              <span style={{ color: 'var(--muted)', width: 38, textAlign: 'right', fontSize: 12 }}>
                {total ? `${Math.round((d.value / total) * 100)}%` : '0%'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
