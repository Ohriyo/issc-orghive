import shieldUrl from '@/assets/shield-bg.svg';
import { cn } from '@/lib/utils';

export interface ShieldWatermarkProps {
  /** Position and width are set by the caller; height follows the shield's shape (900 x 1100). */
  className?: string;
}

/**
 * The prototype's shield behind the carousel spotlight: a sage band around a soft glow, with
 * faint student figures and medallions inside, translucent so it reads as a watermark. The
 * artwork is the supplied design file, kept as an asset (its colours live there, not in
 * components). Purely decorative.
 */
export function ShieldWatermark({ className }: ShieldWatermarkProps) {
  return (
    <img
      src={shieldUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      width={900}
      height={1100}
      className={cn('pointer-events-none h-auto drop-shadow-hex select-none', className)}
    />
  );
}
