import type { HTMLAttributes } from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

type ContainerTag = 'div' | 'main' | 'section' | 'header' | 'footer' | 'nav';

export interface ContainerProps extends HTMLAttributes<HTMLElement> {
  as?: ContainerTag;
  /** Merge the container classes into the single child instead (e.g. a <Reveal>). */
  asChild?: boolean;
}

/**
 * The page column: centered, at most 1280px wide, with the responsive side gutter
 * (16 / 24 / 32 / 80px) that also clears the notch on landscape phones.
 * Layout inside it (grid, flex, vertical padding) comes from className.
 */
export function Container({
  as: Tag = 'div',
  asChild = false,
  className,
  ...props
}: ContainerProps) {
  const Comp = asChild ? Slot.Root : Tag;
  return <Comp className={cn('mx-auto w-full max-w-7xl px-gutter', className)} {...props} />;
}
