'use client';
import { C, M } from '@/components/tokens';
import { isValidCustomRange } from '@/lib/date-range';

export type RangeChoice = 'today' | '7d' | '30d' | 'custom';
export type PickerState = { choice: RangeChoice; from: string; to: string };

const OPTIONS: { value: RangeChoice; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom' },
];

const dateInput: React.CSSProperties = {
  height: 36,
  padding: '0 10px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.field,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 14,
  boxSizing: 'border-box',
};

/** Controlled: the page owns the state so it can derive the query range from it. */
export function RangePicker({
  value,
  onChange,
}: {
  value: PickerState;
  onChange: (next: PickerState) => void;
}): React.ReactElement {
  const error = value.choice === 'custom' ? isValidCustomRange(value.from, value.to) : null;
  return (
    <div>
      <fieldset
        aria-label="Date range"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', border: 0, margin: 0, padding: 0 }}
      >
        {OPTIONS.map((o) => {
          const active = value.choice === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...value, choice: o.value })}
              style={{
                height: 36,
                padding: '0 14px',
                borderRadius: 8,
                border: `1px solid ${active ? M.brand : C.border2}`,
                background: active ? M.brand : C.white,
                color: active ? C.onDark : C.text,
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </fieldset>
      {value.choice === 'custom' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <input
            type="date"
            aria-label="From date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            style={dateInput}
          />
          <input
            type="date"
            aria-label="To date"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            style={dateInput}
          />
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: C.danger, fontSize: 13, marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
