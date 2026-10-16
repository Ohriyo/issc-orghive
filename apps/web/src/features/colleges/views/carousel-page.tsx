import type { ReactNode } from 'react';
import { SectionError } from '@/components/section-error';
import { ShieldWatermark } from '@/components/shield-watermark';
import {
  SpotlightCarousel,
  type SpotlightItem,
} from '@/components/spotlight-carousel/spotlight-carousel';
import type { SpotlightVariant } from '@/components/spotlight-carousel/use-spotlight-tween';
import { cn } from '@/lib/utils';

export interface CarouselPageProps {
  title: string;
  subtitle?: string;
  variant: SpotlightVariant;
  /** Accessible name of the carousel. */
  label: string;
  /** Used in button labels: "Next college". */
  itemNoun: string;
  items: SpotlightItem[];
  initialIndex: number;
  onSelectedChange: (item: SpotlightItem) => void;
  isLoading: boolean;
  /** Set when loading failed; shown with a retry button. */
  error?: { message: string; onRetry: () => void };
  emptyState: ReactNode;
}

/**
 * Shared layout of the two selection screens (Collegiate Student Councils and Student
 * Body Organizations): a heading over a spotlight carousel, with the shield watermark
 * standing behind the centered item.
 */
export function CarouselPage({
  title,
  subtitle,
  variant,
  label,
  itemNoun,
  items,
  initialIndex,
  onSelectedChange,
  isLoading,
  error,
  emptyState,
}: CarouselPageProps) {
  return (
    <div className="bg-surface-sweep relative isolate min-h-dvh overflow-hidden">
      <title>{`${title} | Orghive`}</title>
      <ShieldWatermark
        className={cn(
          // Sized from the prototype at 1366 px: the shield's band (80% of the artwork's
          // width, starting 10% down) begins just under the heading and shows either side
          // of the centred slide.
          'absolute left-1/2 -z-10 -translate-x-1/2',
          variant === 'tower'
            ? 'top-28 w-[min(88vw,29rem)] md:top-6 md:w-[min(50vw,46rem)]'
            : 'top-36 w-[min(100vw,32rem)] md:top-12 md:w-[min(68vw,60rem)]',
        )}
      />
      <main className="pt-8 pb-10 md:pt-6">
        <header className="px-4 text-center">
          <h1 className="text-h1 font-bold text-balance text-ink lg:text-display">{title}</h1>
          {subtitle ? <p className="mt-2 text-body-lg text-ink lg:text-lead">{subtitle}</p> : null}
        </header>
        <SpotlightCarousel
          // Remount once data arrives, so the carousel starts on initialIndex instead of
          // briefly reporting the first slide (which would rewrite ?focus= in the URL).
          key={isLoading ? 'loading' : 'ready'}
          variant={variant}
          label={label}
          itemNoun={itemNoun}
          items={items}
          initialIndex={initialIndex}
          onSelectedChange={onSelectedChange}
          isLoading={isLoading}
          emptyState={
            <div className="mx-auto max-w-md px-4 py-24 text-center text-body-lg text-ink">
              {emptyState}
            </div>
          }
          error={
            error ? (
              <SectionError
                className="mx-auto max-w-md items-center px-4 py-24 text-center"
                message={error.message}
                onRetry={error.onRetry}
              />
            ) : undefined
          }
          className={cn('mx-auto max-w-[1400px]', subtitle ? 'mt-6 md:mt-14' : 'mt-6')}
        />
      </main>
    </div>
  );
}
