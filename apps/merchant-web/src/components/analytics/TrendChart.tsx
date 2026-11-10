import type { AnalyticsPoint } from '@aivastra/types';
import { C, M } from '@/components/tokens';
import { formatCredits, scaleSeries } from '@/lib/chart-scale';

// Series colours come from the existing token set (no raw hex): sessions = blue status,
// try-ons = amber, sold = success green.
const SERIES = [
  { key: 'sessions', label: 'Sessions', color: M.statusBlue },
  { key: 'tried', label: 'Try-ons', color: C.amber },
  { key: 'sold', label: 'Sold', color: M.success },
] as const;

const W = 720;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 28, left: 40 };
const MAX_LABELS = 8;

function shortDate(d: string): string {
  const [, m, day] = d.split('-');
  return `${Number(day)}/${Number(m)}`;
}

/** Grouped SVG bars per day. Labels are thinned so 366 points stay readable. */
export function TrendChart({ points }: { points: AnalyticsPoint[] }): React.ReactElement {
  const n = points.length;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const flat = points.flatMap((p) => [p.sessions, p.tried, p.sold]);
  const heights = scaleSeries(flat, plotH);
  const max = Math.max(0, ...flat.filter((v) => Number.isFinite(v)));
  const group = n > 0 ? plotW / n : plotW;
  const gap = Math.min(group * 0.2, 6);
  const barW = Math.max((group - gap) / SERIES.length, 0.5);
  const labelEvery = Math.max(1, Math.ceil(n / MAX_LABELS));

  const totals = SERIES.map((s) => {
    const sum = points.reduce((a, p) => a + p[s.key], 0);
    return `${formatCredits(sum)} ${s.label.toLowerCase()}`;
  }).join(', ');
  const summary = `Daily sessions, try-ons and sold items from ${points[0]?.date ?? ''} to ${
    points[n - 1]?.date ?? ''
  }: ${totals}.`;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
        {SERIES.map((s) => (
          <span
            key={s.key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: C.mid,
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 10, height: 10, borderRadius: 2, background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        {/* min-width keeps the labels legible on a phone; the wrapper scrolls instead of shrinking text. */}
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', minWidth: 520, height: 'auto', display: 'block' }}
        >
          <title>{summary}</title>
          {[0, 0.5, 1].map((f) => {
            const y = PAD.top + plotH - f * plotH;
            return (
              <g key={f}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y}
                  y2={y}
                  stroke={C.border}
                  strokeWidth={1}
                />
                <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={11} fill={C.light}>
                  {formatCredits(max * f)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) => {
            const x0 = PAD.left + i * group + gap / 2;
            return (
              <g key={p.date}>
                <title>{`${p.date}: ${p.sessions} sessions, ${p.tried} try-ons, ${p.sold} sold`}</title>
                {SERIES.map((s, si) => {
                  const h = heights[i * SERIES.length + si] ?? 0;
                  return (
                    <rect
                      key={s.key}
                      x={x0 + si * barW}
                      y={PAD.top + plotH - h}
                      width={barW}
                      height={h}
                      fill={s.color}
                    />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text
                    x={x0 + (barW * SERIES.length) / 2}
                    y={H - 8}
                    textAnchor="middle"
                    fontSize={11}
                    fill={C.light}
                  >
                    {shortDate(p.date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <table
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        <caption>Daily sessions, try-ons and sold items</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Sessions</th>
            <th scope="col">Try-ons</th>
            <th scope="col">Sold</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{p.date}</th>
              <td>{p.sessions}</td>
              <td>{p.tried}</td>
              <td>{p.sold}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
