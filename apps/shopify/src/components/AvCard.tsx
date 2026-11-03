import type { ReactNode } from 'react';

/**
 * The glass card of the redesigned app pages. Stands in for Polaris Card, so
 * `padding="0"` (a card that hosts a full-bleed table) keeps working.
 */
export function AvCard({
  children,
  padding,
  fill = false,
}: {
  children: ReactNode;
  padding?: string;
  fill?: boolean;
}) {
  return (
    <section
      className={fill ? 'av-c fill' : 'av-c'}
      style={padding === '0' ? { padding: 0, overflow: 'hidden' } : undefined}
    >
      {children}
    </section>
  );
}
