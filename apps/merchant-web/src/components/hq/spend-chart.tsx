import { C, M } from '@/components/tokens';
import { formatCredits, scaleSeries } from '@/lib/chart-scale';

const W = 720;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 28, left: 44 };
const MAX_LABELS = 8;

const shortDate = (d: string) => {
  const [, m, day] = d.split('-');
  return `${Number(day)}/${Number(m)}`;
};

/** One series of daily bars (credits spent). Labels are thinned so a long range stays readable. */
export function SpendChart({ points }: { points: { date: string; spent: number }[] }) {
  const n = points.length;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const heights = scaleSeries(
    points.map((p) => p.spent),
    plotH,
  );
  const max = Math.max(0, ...points.map((p) => p.spent));
  const group = n > 0 ? plotW / n : plotW;
  const barW = Math.max(group - Math.min(group * 0.25, 6), 0.5);
  const every = Math.max(1, Math.ceil(n / MAX_LABELS));
  const total = points.reduce((a, p) => a + p.spent, 0);
  const summary = `Credits spent per day from ${points[0]?.date ?? ''} to ${points[n - 1]?.date ?? ''}: ${formatCredits(total)} in total.`;

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', minWidth: 480, height: 'auto', display: 'block' }}
        >
          <title>{summary}</title>
          {[0, 0.5, 1].map((f) => {
            const y = PAD.top + plotH - f * plotH;
            return (
              <g key={f}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={C.border} />
                <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={11} fill={C.light}>
                  {formatCredits(max * f)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) => {
            const x = PAD.left + i * group + (group - barW) / 2;
            const h = heights[i] ?? 0;
            return (
              <g key={p.date}>
                <title>{`${p.date}: ${formatCredits(p.spent)} credits`}</title>
                <rect
                  x={x}
                  y={PAD.top + plotH - h}
                  width={barW}
                  height={h}
                  rx={2}
                  fill={M.statusBlue}
                />
                {i % every === 0 && (
                  <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={C.light}>
                    {shortDate(p.date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {/* sr-only on a wrapper: a <table> ignores width/height/overflow (see TrendChart). */}
      <div className="sr-only">
        <table>
          <caption>Credits spent per day</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Credits</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <th scope="row">{p.date}</th>
                <td>{p.spent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
