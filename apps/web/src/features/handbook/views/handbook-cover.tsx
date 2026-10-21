import { cn } from '@/lib/utils';

/**
 * A handbook edition as a bound book: the watermarked page 1 on a sheet, with a forest spine
 * down its left edge (the cover thumbnail stands for the book, not a document card). Until
 * page 1 is rendered it is a plain title page, never imitation text.
 */
export function HandbookCover({
  src,
  yearLabel,
  interactive = false,
  className,
}: {
  src: string | null;
  yearLabel: string;
  /** Lifts with the hover or keyboard focus of the nearest `group` (a link around it). */
  interactive?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'relative block aspect-[1/1.3] w-full overflow-hidden rounded-r-[4px] bg-white shadow-pool ring-1 ring-ink/10',
        interactive &&
          'ease-cinematic transition-transform duration-500 group-hover:-translate-y-1.5 group-focus-visible:-translate-y-1.5 motion-reduce:transition-none',
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="pointer-events-none size-full object-cover object-top"
        />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-2 px-5 pl-7 text-center">
          <span className="text-body-lg font-bold text-ink">Student Handbook</span>
          <span aria-hidden="true" className="h-px w-8 bg-sage" />
          <span className="text-small text-ink-muted">{yearLabel}</span>
        </span>
      )}
      {/* The spine. */}
      <span aria-hidden="true" className="bg-forest-band absolute inset-y-0 left-0 w-[7%]" />
    </span>
  );
}
