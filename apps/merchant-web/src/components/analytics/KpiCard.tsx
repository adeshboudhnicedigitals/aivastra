import { C } from '@/components/tokens';

/** One headline number. `loading` shows a skeleton bar instead of a value (never a fake 0). */
export function KpiCard({
  label,
  value,
  hint,
  loading,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
  tone?: 'warn';
}): React.ReactElement {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${tone === 'warn' ? C.amber : C.border}`,
        borderRadius: 12,
        padding: 16,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 13, color: C.mid }}>{label}</div>
      {loading ? (
        <div
          role="status"
          aria-label={`Loading ${label}`}
          className="animate-pulse"
          style={{ height: 28, width: '55%', borderRadius: 6, background: C.border, marginTop: 6 }}
        />
      ) : (
        <div style={{ fontSize: 24, fontWeight: 700, color: C.text, marginTop: 4 }}>{value}</div>
      )}
      {hint && !loading && (
        <div style={{ fontSize: 12, color: tone === 'warn' ? C.text : C.light, marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
