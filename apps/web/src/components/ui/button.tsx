'use client';
import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-hand rounded-full border border-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 btn-sketch',
  {
    variants: {
      variant: {
        default: 'bg-primary text-foreground',
        outline: 'bg-background text-foreground',
        ghost: 'border-dashed bg-transparent shadow-none hover:bg-secondary [&.btn-sketch]:shadow-none [&.btn-sketch]:hover:shadow-none [&.btn-sketch]:hover:transform-none',
        destructive: 'bg-destructive text-destructive-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        link: 'border-none shadow-none text-primary underline-offset-4 hover:underline [&.btn-sketch]:shadow-none [&.btn-sketch]:hover:shadow-none [&.btn-sketch]:hover:transform-none',
      },
      size: {
        default: 'h-10 px-5 py-2 text-[18px]',
        sm: 'h-8 px-4 text-[15px]',
        lg: 'h-12 px-7 text-[21px]',
        icon: 'h-10 w-10 rounded-full',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? (Slot as any) : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { buttonVariants };
