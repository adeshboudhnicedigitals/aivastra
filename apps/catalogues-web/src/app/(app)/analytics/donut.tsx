import { C } from '@/components/tokens';
import { SLICE_COLORS, SLICE_OTHER } from './styles';

const R = 70;
const CIRC = 2 * Math.PI * R;
const GAP = 2; // visual gap between slices, as in the design's dash arrays

/** Shared by slices and legend dots so each legend row maps to its slice. */
export const sliceColor = (i: number): string => SLICE_COLORS[i] ?? SLICE_OTHER;

export function Donut({
  slices,
  centerValue,
  centerLabel,
}: {
  slices: { name: string; pct: number }[];
  centerValue: string;
  centerLabel: string;
}) {
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: 210, height: 210, flex: 'none' }}>
      <svg
        width="210"
        height="210"
        viewBox="0 0 200 200"
        role="img"
        aria-label={`Donut chart of try-ons by garment category: ${slices
          .map((s) => `${s.name} ${s.pct}%`)
          .join(', ')}`}
        style={{ display: 'block' }}
      >
        <g transform="rotate(-90 100 100)" fill="none" strokeWidth="28">
          {slices.map((s, i) => {
            const len = (s.pct / 100) * CIRC;
            const drawn = slices.length > 1 ? Math.max(len - GAP, 0) : len;
            const el = (
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: names are not guaranteed unique and the list is static per render
                key={`${s.name}-${i}`}
                cx="100"
                cy="100"
                r={R}
                stroke={sliceColor(i)}
                strokeDasharray={`${drawn} ${CIRC - drawn}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </g>
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            color: C.text,
          }}
        >
          {centerValue}
        </span>
        <span style={{ fontSize: 14, color: C.mid }}>{centerLabel}</span>
      </div>
    </div>
  );
}
