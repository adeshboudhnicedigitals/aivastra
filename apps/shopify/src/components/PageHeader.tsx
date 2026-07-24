import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '../theme';
import { ArrowLeftIcon } from './icons';

export function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel,
  action,
}: {
  title: string;
  subtitle?: string;
  backTo: string;
  backLabel: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '20px',
      }}
    >
      <div>
        <Link
          to={backTo}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            fontWeight: 600,
            color: BRAND.textMuted,
            textDecoration: 'none',
            marginBottom: '10px',
          }}
        >
          <ArrowLeftIcon size={13} />
          {backLabel}
        </Link>
        <div style={{ fontSize: '22px', fontWeight: 700, color: BRAND.ink }}>{title}</div>
        {subtitle && (
          <div style={{ marginTop: '4px', fontSize: '14px', color: BRAND.textMuted }}>
            {subtitle}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}
