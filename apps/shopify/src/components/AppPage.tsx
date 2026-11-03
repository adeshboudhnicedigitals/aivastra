import type { ReactNode } from 'react';

/** Page title block of the redesigned app pages; stands in for Polaris Page. */
export function AppPage({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="av-pg">
      <div className="av-pagehead">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="av-stack">{children}</div>
    </div>
  );
}
