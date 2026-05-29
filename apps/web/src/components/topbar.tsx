import { C } from './tokens';

export function TopBar({
  title,
  subtitle,
  right,
  lead,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  lead?: React.ReactNode;
}) {
  return (
    <div
      style={{
        height: 76,
        background: C.white,
        borderBottom: `1px solid ${C.border}`,
        padding: '0 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}
    >
      {lead ?? (
        <div>
          {title && <div style={{ fontWeight: 600, fontSize: 20, lineHeight: '32px', color: C.text }}>{title}</div>}
          {subtitle && <div style={{ fontWeight: 500, fontSize: 14, lineHeight: '20px', color: C.mid, marginTop: 2 }}>{subtitle}</div>}
        </div>
      )}
      {right}
    </div>
  );
}
