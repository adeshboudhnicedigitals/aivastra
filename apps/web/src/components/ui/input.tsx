import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-10 w-full border border-foreground bg-background px-3 py-2 text-sm font-body placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow-[2px_2px_0_hsl(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-50 rounded',
      className,
    )}
    style={{ borderRadius: '4px' }}
    ref={ref}
    {...props}
  />
));
Input.displayName = 'Input';
