import type * as React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'primary' | 'success' | 'warning' | 'danger';
}

export function Badge({ className = '', variant = 'default', ...props }: BadgeProps) {
  const effectiveVariant = variant === 'secondary' ? 'default' : variant;
  return <span className={`badge badge-${effectiveVariant} ${className}`.trim()} {...props} />;
}
