import { btn } from '@/components/hq/ui';
import { C } from '@/components/tokens';

// Shared pieces of the console's list pages (error, empty, pager, table header cell), so each
// page reads the same and only differs in its columns.

export const th: React.CSSProperties = {
  padding: '12px 14px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  textAlign: 'left',
  borderBottom: `1px solid ${C.border}`,
};
export const td: React.CSSProperties = { padding: '12px 14px', verticalAlign: 'top' };

export const field: React.CSSProperties = {
  height: 40,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.field,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 14,
  minWidth: 0,
};

export function PageHead({ title, lede }: { title: string; lede: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: 0 }}>{title}</h1>
      <p style={{ margin: '4px 0 0', fontSize: 14, color: C.mid }}>{lede}</p>
    </div>
  );
}

export function ErrorBox({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 20,
      }}
    >
      <strong style={{ color: C.text }}>Could not load {what}.</strong>
      <p style={{ margin: '6px 0 12px', fontSize: 14, color: C.mid }}>
        {error instanceof Error ? error.message : 'Check your connection and try again.'}
      </p>
      <button type="button" style={btn.base} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px dashed ${C.border2}`,
        borderRadius: 14,
        padding: 32,
        textAlign: 'center',
        color: C.mid,
      }}
    >
      {children}
    </div>
  );
}

/** Not allowed here: shown instead of a page whose API would answer 403 anyway. */
export function NoAccess({ what }: { what: string }) {
  return <EmptyBox>Your role does not include {what}. Ask a super admin if you need it.</EmptyBox>;
}

export function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
}) {
  return (
    <nav
      aria-label="Pagination"
      style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}
    >
      <button
        type="button"
        style={{ ...btn.base, opacity: page <= 1 ? 0.5 : 1 }}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span style={{ fontSize: 13, color: C.mid }}>
        Page {page} of {pages}
      </span>
      <button
        type="button"
        style={{ ...btn.base, opacity: page >= pages ? 0.5 : 1 }}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

/** Status filter as a row of toggle buttons; the pressed one is marked for screen readers too. */
export function FilterTabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { k: T; l: string }[];
  onChange: (k: T) => void;
}) {
  return (
    <fieldset
      style={{
        border: 0,
        padding: 0,
        margin: '0 0 16px',
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.k}
          type="button"
          aria-pressed={value === o.k}
          onClick={() => onChange(o.k)}
          style={{
            ...(value === o.k ? btn.primary : btn.base),
            height: 36,
            padding: '0 14px',
          }}
        >
          {o.l}
        </button>
      ))}
    </fieldset>
  );
}
