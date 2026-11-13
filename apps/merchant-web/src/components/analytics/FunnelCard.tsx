import { useId } from 'react';
import { C, M } from '@/components/tokens';
import { formatCredits, formatRatio } from '@/lib/chart-scale';

// Shade deepens as the funnel narrows, as in the design; the percentages carry the real proportions.
const shade = (pct: number) => `color-mix(in srgb, ${M.brand} ${pct}%, ${C.card})`;
const STEPS = [
  {
    key: 'sessions',
    label: 'Sessions Started',
    width: 230,
    from: shade(22),
    to: shade(34),
    dark: false,
  },
  {
    key: 'tried',
    label: 'Completed Try-ons',
    width: 208,
    from: shade(48),
    to: shade(62),
    dark: false,
  },
  { key: 'sold', label: 'Sold', width: 186, from: shade(86), to: shade(100), dark: true },
] as const;

const STEP_H = 84;
const RADIUS = 5;

/**
 * A trapezoid with rounded corners. clip-path would cut the corners square, so the shape is a
 * polygon inset by the radius and stroked with the same gradient using round line joins.
 */
function StepShape({
  id,
  width,
  from,
  to,
}: {
  id: string;
  width: number;
  from: string;
  to: string;
}) {
  const r = RADIUS;
  const slant = width * 0.06;
  const pts = [
    [r, r],
    [width - r, r],
    [width - slant - r, STEP_H - r],
    [slant + r, STEP_H - r],
  ]
    .map((p) => p.join(','))
    .join(' ');
  return (
    <svg
      width={width}
      height={STEP_H}
      viewBox={`0 0 ${width} ${STEP_H}`}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0 }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: from }} />
          <stop offset="1" style={{ stopColor: to }} />
        </linearGradient>
      </defs>
      <polygon
        points={pts}
        fill={`url(#${id})`}
        stroke={`url(#${id})`}
        strokeWidth={r * 2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

const arrow = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1 6h10M8 3l3 3-3 3" />
  </svg>
);

/** Sessions → try-ons → sold, with the step-to-step conversion beside it. */
export function FunnelCard({
  sessions,
  tried,
  sold,
}: {
  sessions: number;
  tried: number;
  sold: number;
}): React.ReactElement {
  const uid = useId();
  const values = { sessions, tried, sold };
  const rates = [
    { from: 'Start', to: 'Try-on', pct: formatRatio(tried, sessions) },
    { from: 'Try-on', to: 'Sold', pct: formatRatio(sold, tried) },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
      <div style={{ flex: '0 0 230px', display: 'flex', flexDirection: 'column' }}>
        {STEPS.map((s, i) => (
          <div
            key={s.key}
            style={{
              position: 'relative',
              width: s.width,
              height: STEP_H,
              margin: `${i === 0 ? 0 : -5}px auto 0`,
              color: s.dark ? C.onDark : C.text,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              textAlign: 'center',
            }}
          >
            <StepShape id={`${uid}-${s.key}`} width={s.width} from={s.from} to={s.to} />
            <span style={{ position: 'relative', fontSize: 12, fontWeight: 600 }}>{s.label}</span>
            <span style={{ position: 'relative', fontSize: 15, fontWeight: 800 }}>
              {formatCredits(values[s.key])}{' '}
              <span style={{ fontSize: 10, fontWeight: 600 }}>
                ({formatRatio(values[s.key], sessions)})
              </span>
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          flex: '1 1 140px',
          minWidth: 130,
          borderLeft: `1px solid ${C.border2}`,
          paddingLeft: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          fontSize: 12,
          fontWeight: 600,
          color: C.light,
        }}
      >
        <div style={{ fontWeight: 700, color: C.text }}>Conversion Rates</div>
        {rates.map((r) => (
          <div key={r.from} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {r.from}
              {arrow}
              {r.to}
            </span>
            <span style={{ fontSize: 10, color: C.text }}>{r.pct}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
