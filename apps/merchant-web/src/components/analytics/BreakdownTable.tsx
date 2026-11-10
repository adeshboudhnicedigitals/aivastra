import type { AnalyticsBreakdownRow } from '@aivastra/types';
import { C } from '@/components/tokens';
import { formatCredits, formatRatio } from '@/lib/chart-scale';

/** The row shape a sortable table works on: the API row plus a numeric conversion ratio. */
export type BreakdownSortKey = 'name' | 'sessions' | 'tried' | 'sold' | 'ratio' | 'creditsSpent';
export type BreakdownDisplayRow = AnalyticsBreakdownRow & { ratio: number };

const th: React.CSSProperties = {
  textAlign: 'right',
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: C.mid,
  whiteSpace: 'nowrap',
  borderBottom: `1px solid ${C.border}`,
};
const td: React.CSSProperties = {
  textAlign: 'right',
  padding: '10px 12px',
  fontSize: 14,
  color: C.text,
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: 'nowrap',
};
const sortBtn: React.CSSProperties = {
  background: 'none',
  border: 0,
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
};

const COLUMNS: { key: Exclude<BreakdownSortKey, 'name'>; label: string }[] = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'tried', label: 'Try-ons' },
  { key: 'sold', label: 'Sold' },
  { key: 'ratio', label: 'Conversion' },
  { key: 'creditsSpent', label: 'Credits' },
];

/**
 * Phone-friendly: the table scrolls horizontally inside its card rather than reflowing.
 * Sorting and row click are opt-in (Overview renders it plain); the page owns the sort state.
 */
export function BreakdownTable({
  rows,
  nameHeader,
  sort,
  onSort,
  onRowClick,
}: {
  rows: AnalyticsBreakdownRow[];
  nameHeader: string;
  sort?: { key: BreakdownSortKey; dir: 'asc' | 'desc' };
  onSort?: (key: BreakdownSortKey) => void;
  onRowClick?: (row: AnalyticsBreakdownRow) => void;
}): React.ReactElement {
  const header = (key: BreakdownSortKey, label: string, style: React.CSSProperties) => {
    const active = sort?.key === key;
    return (
      <th
        key={key}
        scope="col"
        style={style}
        aria-sort={
          onSort
            ? active
              ? sort?.dir === 'asc'
                ? 'ascending'
                : 'descending'
              : 'none'
            : undefined
        }
      >
        {onSort ? (
          <button type="button" onClick={() => onSort(key)} style={sortBtn}>
            {label}
            {active ? (sort?.dir === 'asc' ? ' ▲' : ' ▼') : ''}
          </button>
        ) : (
          label
        )}
      </th>
    );
  };
  return (
    <div
      style={{
        overflowX: 'auto',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr>
            {header('name', nameHeader, { ...th, textAlign: 'left' })}
            {COLUMNS.map((c) => header(c.key, c.label, th))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                {onRowClick ? (
                  <button
                    type="button"
                    onClick={() => onRowClick(r)}
                    style={{ ...sortBtn, fontWeight: 600, color: C.pink, textAlign: 'left' }}
                  >
                    {r.name}
                  </button>
                ) : (
                  r.name
                )}
              </th>
              <td style={td}>{formatCredits(r.sessions)}</td>
              <td style={td}>{formatCredits(r.tried)}</td>
              <td style={td}>{formatCredits(r.sold)}</td>
              <td style={td}>{formatRatio(r.sold, r.sessions)}</td>
              <td style={td}>{formatCredits(r.creditsSpent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
