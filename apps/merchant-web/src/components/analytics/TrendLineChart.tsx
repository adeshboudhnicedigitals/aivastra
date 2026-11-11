import type { AnalyticsPoint } from '@aivastra/types';
import { C, M } from '@/components/tokens';
import { formatCredits } from '@/lib/chart-scale';

const SERIES = [
  { key: 'sessions', label: 'Sessions', color: M.statusBlue },
  { key: 'tried', label: 'Try-ons', color: C.amber },
  { key: 'sold', label: 'Sold', color: M.success },
] as const;

const W = 700;
const H = 150;
const PAD = { top: 12, right: 10, bottom: 28, left: 32 };
const GRID_STEPS = 6;
const MAX_LABELS = 10;

/** Catmull-Rom → cubic Bézier, the same smoothing the design's lines use. */
function smooth(pts: [number, number][]): string {
  const [first] = pts;
  if (!first) return '';
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i] ?? first;
    const p2 = pts[i + 1] ?? p1;
    const p0 = pts[i - 1] ?? p1;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function shortDate(d: string): string {
  const [, m, day] = d.split('-');
  return `${Number(day)}/${Number(m)}`;
}

/** Smooth daily lines for sessions, try-ons and sold, with the design's dashed grid. */
export function TrendLineChart({ points }: { points: AnalyticsPoint[] }): React.ReactElement {
  const n = points.length;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...points.flatMap((p) => [p.sessions, p.tried, p.sold]));
  const x = (i: number) => PAD.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(n / MAX_LABELS));
  const summary = `Daily sessions, try-ons and sold items from ${points[0]?.date ?? ''} to ${
    points[n - 1]?.date ?? ''
  }.`;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 18,
          flexWrap: 'wrap',
          fontSize: 12,
          color: M.textSecondary,
        }}
      >
        {SERIES.map((s) => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              aria-hidden="true"
              style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        style={{ width: '100%', height: 'auto', display: 'block', marginTop: 8 }}
      >
        <title>{summary}</title>
        {Array.from({ length: GRID_STEPS + 1 }, (_, i) => {
          const gy = PAD.top + (i * plotH) / GRID_STEPS;
          return (
            <g key={gy}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={gy}
                y2={gy}
                stroke={C.border}
                strokeDasharray="4 5"
              />
              <text x={PAD.left - 6} y={gy + 3} textAnchor="end" fontSize={10} fill={C.light}>
                {formatCredits(max - (i * max) / GRID_STEPS)}
              </text>
            </g>
          );
        })}
        {points.map(
          (p, i) =>
            i % labelEvery === 0 && (
              <text
                key={p.date}
                x={x(i)}
                y={H - 9}
                textAnchor="middle"
                fontSize={10}
                fill={C.light}
              >
                {shortDate(p.date)}
              </text>
            ),
        )}
        {SERIES.map((s) => (
          <path
            key={s.key}
            d={smooth(points.map((p, i) => [x(i), y(p[s.key])]))}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        ))}
        {points.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.sessions)} r={6} fill="transparent">
            <title>{`${p.date}: ${p.sessions} sessions, ${p.tried} try-ons, ${p.sold} sold`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
