import type { ReactNode } from 'react';

/**
 * Buttons on Manage's product and collection lists: `add` opens a picker
 * (Exclude products, Add collections), `remove` takes a row back out.
 */
export function ListActionButton({
  kind,
  disabled,
  onClick,
  children,
}: {
  kind: 'add' | 'remove';
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`av-list-btn ${kind}`} disabled={disabled} onClick={onClick}>
      {kind === 'add' && (
        // biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the button text names it
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}
      {children}
    </button>
  );
}
