'use client';

import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import type { AnalyticsRange } from './api';
import { CalendarIcon } from './icons';

const RANGE_NAMES: Record<AnalyticsRange, string> = {
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  '90d': 'Last 90 Days',
};

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const longDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** "Oct 4 – Nov 2, 2026" from the API's window; null if either end is unparseable. */
export function formatWindow(from: string, to: string): string | null {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return `${shortDate.format(a)} – ${longDate.format(b)}`;
}

export function RangeSelect({
  range,
  onChange,
  window: windowLabel,
}: {
  range: AnalyticsRange;
  onChange: (r: AnalyticsRange) => void;
  /** Dates for the selected range once data has loaded. */
  window: string | null;
}) {
  // Dates are only known for the active range, so only that option carries them.
  const options = (Object.keys(RANGE_NAMES) as AnalyticsRange[]).map((value) => ({
    value,
    label:
      value === range && windowLabel
        ? `${RANGE_NAMES[value]} (${windowLabel})`
        : RANGE_NAMES[value],
  }));

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 40,
        paddingLeft: 12,
        paddingRight: 6,
        borderRadius: 12,
        border: `1px solid ${C.border2}`,
        background: C.card,
        color: C.text,
      }}
    >
      <CalendarIcon size={18} stroke={C.pink} />
      <PremiumSelect
        value={range}
        onChange={(v) => onChange(v as AnalyticsRange)}
        options={options}
        ariaLabel="Date range"
        height={38}
        fontSize={14}
        minWidth={150}
        align="right"
      />
    </div>
  );
}
