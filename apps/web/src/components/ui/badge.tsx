import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center border border-foreground rounded-full px-2.5 py-0.5 font-body text-[10px] uppercase tracking-[0.08em] transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary text-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'bg-background text-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
        success: 'bg-green-100 text-green-800 border-green-800',
        warning: 'bg-accent text-foreground',
        processing: 'bg-secondary text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
