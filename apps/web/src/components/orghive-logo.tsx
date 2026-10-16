import { cn } from '@/lib/utils';

/**
 * Orghive's mark and wordmark: the prototype's hexagon frame (forest band, white ring,
 * forest fill) beside "Orghive" in Poppins Bold. A stand-in until an official logo file
 * exists; swap the SVG here and every header follows.
 */
export function OrghiveLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 40 35" aria-hidden="true" focusable="false" className="h-7 w-8 shrink-0">
        <polygon points="10,0 30,0 40,17.5 30,35 10,35 0,17.5" className="fill-forest-700" />
        <polygon points="12,3.5 28,3.5 36,17.5 28,31.5 12,31.5 4,17.5" className="fill-white" />
        <polygon
          points="13.2,5.6 26.8,5.6 33.6,17.5 26.8,29.4 13.2,29.4 6.4,17.5"
          className="fill-forest-500"
        />
        <polygon points="16,11 24,11 28,17.5 24,24 16,24 12,17.5" className="fill-leaf" />
      </svg>
      <span className="text-h3 leading-none font-bold tracking-tight text-ink">Orghive</span>
    </span>
  );
}
