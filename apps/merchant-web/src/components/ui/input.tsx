import * as React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  sizeVariant?: 'sm' | 'md' | 'lg';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', sizeVariant = 'md', ...props }, ref) => {
    return (
      <input ref={ref} className={`input input-${sizeVariant} ${className}`.trim()} {...props} />
    );
  },
);
Input.displayName = 'Input';
