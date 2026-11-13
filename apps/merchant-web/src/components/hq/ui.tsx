import { C, M } from '@/components/tokens';

// Small presentational pieces for the team console. Colour always comes with a word (and for
// status an icon), never colour alone.

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';
const TONES: Record<Tone, { fg: string; bg: string; icon: string }> = {
  ok: { fg: M.success, bg: M.successTint, icon: '●' },
  warn: { fg: M.warning, bg: M.warningTint, icon: '▲' },
  bad: { fg: M.danger, bg: M.dangerTint, icon: '■' },
  muted: { fg: M.textSecondary, bg: M.mutedTint, icon: '○' },
};

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 8 }}>
        {t.icon}
      </span>
      {children}
    </span>
  );
}

export function Card({
  title,
  action,
  children,
  label,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <section aria-label={label ?? title} className="hq-card" style={{ padding: 20, minWidth: 0 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return (
    <span
      aria-hidden="true"
      className="hq-skeleton"
      style={{
        display: 'block',
        height: h,
        width: w,
        borderRadius: 6,
        background: C.border,
      }}
    />
  );
}

/** Key/value line used in cards: label muted above, value below. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: C.mid, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: C.text, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {children}
      </div>
    </div>
  );
}

export const btn = {
  base: {
    height: 40,
    padding: '0 16px',
    borderRadius: 8,
    border: `1px solid ${C.border2}`,
    background: C.card,
    color: C.text,
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  } as React.CSSProperties,
  primary: {
    height: 40,
    padding: '0 16px',
    borderRadius: 8,
    border: 'none',
    background: C.btnPrimary,
    color: C.white,
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  } as React.CSSProperties,
};

/** Round initials badge; the hue comes from the name so an account keeps its colour everywhere. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden="true"
      style={{
        flex: 'none',
        width: size,
        height: size,
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38,
        fontWeight: 800,
        color: `hsl(${h} 60% 38%)`,
        background: `hsl(${h} 70% 50% / 0.16)`,
      }}
    >
      {initials}
    </span>
  );
}
