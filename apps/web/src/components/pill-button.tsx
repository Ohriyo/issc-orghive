import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

const pillButtonVariants = cva(
  [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full whitespace-nowrap',
    'shadow-pool ease-cinematic transition-[translate,box-shadow,filter] duration-300',
    'hover:-translate-y-0.5 hover:shadow-pool-lift',
    'active:translate-y-0 active:shadow-pool',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
    '[&_svg]:size-[1.1em] [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        /** Gradient forest fill with white text: "Paperworks", "Search". */
        forest: 'bg-forest-band font-medium text-white hover:brightness-110',
        /** Light fill with ink text: the CSC carousel's "Proceed". */
        light: 'bg-pill-light font-semibold text-ink hover:bg-white',
      },
      size: {
        md: 'h-11 px-6 text-body',
        lg: 'h-14 px-8 text-lead',
      },
    },
    defaultVariants: { variant: 'forest', size: 'md' },
  },
);

export interface PillButtonProps
  extends ComponentProps<'button'>, VariantProps<typeof pillButtonVariants> {
  /** Render the child element (e.g. a router `Link`) with pill styling instead of a button. */
  asChild?: boolean;
}

/** The prototype's pill call to action, with the soft shadow pooled underneath. */
export function PillButton({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: PillButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      className={cn(pillButtonVariants({ variant, size }), className)}
      {...(!asChild && { type: type ?? 'button' })}
      {...props}
    />
  );
}
