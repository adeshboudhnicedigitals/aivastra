import { C, M } from '@/components/tokens';

export type KpiDelta = { text: string; positive: boolean };

/** One headline number. `loading` shows a skeleton bar instead of a value (never a fake 0). */
export function KpiCard({
  label,
  value,
  hint,
  loading,
  tone,
  icon,
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
  tone?: 'warn';
  icon?: React.ReactNode;
  /** Change against the previous period; omitted when there is nothing to compare with. */
  delta?: KpiDelta | null;
}): React.ReactElement {
  return (
    <section
      style={{
        background: C.card,
        border: `1px solid ${tone === 'warn' ? C.amber : C.border2}`,
        borderRadius: 12,
        padding: 14,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon && (
            <span
              aria-hidden="true"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: M.brandTint,
                color: M.brand,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
              }}
            >
              {icon}
            </span>
          )}
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.text }}>{label}</h2>
        </div>
        {loading ? (
          <div
            role="status"
            aria-label={`Loading ${label}`}
            className="animate-pulse"
            style={{ height: 25, width: '55%', borderRadius: 6, background: C.border }}
          />
        ) : (
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: '25px', color: C.text }}>
            {value}
          </div>
        )}
      </div>
      {!loading && (delta || hint) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            minHeight: 24,
            fontSize: 10,
            fontWeight: 600,
            color: C.text,
          }}
        >
          {delta && (
            <b
              style={{
                fontWeight: 600,
                padding: 4,
                borderRadius: 4,
                color: delta.positive ? M.up : M.danger,
                background: delta.positive ? M.upTint : M.dangerTint,
              }}
            >
              {delta.text}
            </b>
          )}
          <span>{delta ? 'vs. previous period' : hint}</span>
        </div>
      )}
    </section>
  );
}
