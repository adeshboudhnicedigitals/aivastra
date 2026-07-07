import * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', type = 'button', ...props }, ref) => {
    const effectiveVariant = variant === 'default' ? 'primary' : variant;
    return (
      <button
        ref={ref}
        type={type}
        className={`btn btn-${effectiveVariant} btn-${size} ${className}`.trim()}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
