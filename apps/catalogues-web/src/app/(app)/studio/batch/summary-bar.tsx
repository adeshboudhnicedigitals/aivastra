'use client';
import { C } from '@/components/tokens';

export function SummaryBar({
  rowCount,
  totalJobs,
  creditCost,
  balance,
  maxBatchJobs,
  invalidRowCount,
  submitting,
  onSubmit,
}: {
  rowCount: number;
  totalJobs: number;
  creditCost: number;
  balance: number | null;
  maxBatchJobs: number;
  invalidRowCount: number;
  submitting: boolean;
  onSubmit: () => void;
}) {
  // One specific reason, in the order the user can act on it.
  const blockedReason =
    invalidRowCount > 0
      ? `${invalidRowCount} row${invalidRowCount === 1 ? '' : 's'} incomplete`
      : totalJobs === 0
        ? 'Add at least one pose'
        : totalJobs > maxBatchJobs
          ? `Over the ${maxBatchJobs}-image limit`
          : balance !== null && balance < creditCost
            ? `Need ${creditCost} credits, you have ${balance}`
            : null;

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '12px 16px',
        marginTop: 16,
        borderTop: `1px solid ${C.border}`,
        background: C.white,
      }}
    >
      <span style={{ color: C.mid, fontSize: 13 }}>
        {rowCount} rows · {totalJobs} images · {creditCost} credits
        {balance !== null ? ` · balance ${balance}` : ''}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* C.danger does not exist on the design-token map (see tokens.ts); C.pink
            is reused here as the nearest existing token, matching the stopgap
            already applied in Task 12. Logged as a design-system gap, not fixed here. */}
        {blockedReason && <span style={{ color: C.pink, fontSize: 13 }}>{blockedReason}</span>}
        <button
          type="button"
          disabled={!!blockedReason || submitting}
          onClick={onSubmit}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: blockedReason || submitting ? C.border : C.pink,
            color: C.white,
            fontWeight: 600,
            fontSize: 13,
            cursor: blockedReason || submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Submitting…' : `Generate ${totalJobs} images`}
        </button>
      </div>
    </div>
  );
}
