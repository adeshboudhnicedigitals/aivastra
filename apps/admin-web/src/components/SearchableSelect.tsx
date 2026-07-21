import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';

interface Option {
  id: string;
  label: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  emptyLabel,
  id,
  style,
  ariaLabel,
}: {
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When set, prepends a clearable "— none —"-style option that calls onChange(''). */
  emptyLabel?: string;
  id?: string;
  /** Passed through to the underlying input, e.g. for compact inline sizing in a toolbar. */
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const allOptions = emptyLabel ? [{ id: '', label: emptyLabel }, ...options] : options;
  const selectedLabel = allOptions.find((o) => o.id === value)?.label ?? '';
  const filtered = query
    ? allOptions.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : allOptions;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <input
        id={id}
        className="select"
        style={style}
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : selectedLabel}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
          }
        }}
      />
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 20,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r)',
            boxShadow: 'var(--shadow-lg)',
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '9px 12px', fontSize: 13, color: 'var(--muted)' }}>
              No matches
            </div>
          ) : (
            filtered.map((o) => (
              <div
                key={o.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(o.id);
                  setOpen(false);
                  setQuery('');
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--surface-2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background =
                    o.id === value ? 'var(--surface-2)' : 'transparent';
                }}
                style={{
                  padding: '9px 12px',
                  fontSize: 14,
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  background: o.id === value ? 'var(--surface-2)' : 'transparent',
                }}
              >
                {o.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
