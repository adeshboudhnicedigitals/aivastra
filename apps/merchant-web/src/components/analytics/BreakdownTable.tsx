import type { AnalyticsBreakdownRow } from '@aivastra/types';
import { C } from '@/components/tokens';
import { formatCredits, formatRatio } from '@/lib/chart-scale';

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

/** Phone-friendly: the table scrolls horizontally inside its card rather than reflowing. */
export function BreakdownTable({
  rows,
  nameHeader,
}: {
  rows: AnalyticsBreakdownRow[];
  nameHeader: string;
}): React.ReactElement {
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
            <th scope="col" style={{ ...th, textAlign: 'left' }}>
              {nameHeader}
            </th>
            <th scope="col" style={th}>
              Sessions
            </th>
            <th scope="col" style={th}>
              Try-ons
            </th>
            <th scope="col" style={th}>
              Sold
            </th>
            <th scope="col" style={th}>
              Conversion
            </th>
            <th scope="col" style={th}>
              Credits
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                {r.name}
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
