import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Container } from '@/components/container';
import { HexFrame } from '@/components/hex-frame';
import { LOGO_SIZES } from '@/components/logo-sizes';
import { cinematic, usePrefersReducedMotion } from '@/components/motion';
import { OrgLogo } from '@/components/org-logo';
import { PillButton } from '@/components/pill-button';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import { COVER_SIZES, type PostCardModel } from '../presenters/post-format';

export interface HighlightCarouselProps {
  highlights: PostCardModel[];
  /** The organization: its logo stands in for a highlight without a cover. */
  org: { acronym: string; name: string; logoSrc?: string; logoSrcSet?: string };
  seeAllHref: string;
}

const LINK =
  'tap-area inline-flex items-center gap-2 font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';

/**
 * The organization's pinned highlights (/orgs/:slug), from design/highlights-mockup.png: one
 * wide card at a time, details on the left and the cover on the right, the next card peeking
 * in at the right edge from lg. Below md the card stacks, image first. Swipe, the arrow
 * buttons, the dots, and ← → Home End (anywhere in the carousel) move it; slides snap.
 * No autoplay. With prefers-reduced-motion, slides jump instead of gliding.
 */
export function HighlightCarousel({ highlights, org, seeAllHref }: HighlightCarouselProps) {
  const reduced = usePrefersReducedMotion();
  const headingId = useId();
  const viewportId = useId();
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    // Every slide stops at the left edge, the last one too (the space after it stays empty).
    containScroll: false,
    duration: 30,
  });
  const [selected, setSelected] = useState(0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(highlights.length > 1);
  // Announce changes only after the visitor moves the carousel, not on arrival.
  const [announce, setAnnounce] = useState(false);
  const count = highlights.length;
  const hasControls = count > 1;

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      setSelected(emblaApi.selectedScrollSnap());
      setCanPrev(emblaApi.canScrollPrev());
      setCanNext(emblaApi.canScrollNext());
    };
    onSelect();
    emblaApi.on('select', onSelect).on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect).off('reInit', onSelect);
    };
  }, [emblaApi]);

  const goTo = useCallback(
    (index: number) => {
      setAnnounce(true);
      emblaApi?.scrollTo(index, reduced);
    },
    [emblaApi, reduced],
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (!hasControls) return;
    const target = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: count - 1 }[
      event.key
    ];
    if (target === undefined) return;
    event.preventDefault();
    goTo(Math.max(0, Math.min(count - 1, target)));
  };

  const current = highlights[selected];

  return (
    <section aria-labelledby={headingId} className="overflow-hidden pt-section pb-8">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 id={headingId} className="text-h2 font-bold text-balance text-ink">
            Highlights
          </h2>
          <OriginLink to={seeAllHref} className={LINK}>
            See all highlights
            <ArrowRight aria-hidden="true" className="size-4" />
          </OriginLink>
        </div>

        <div
          role="region"
          aria-roledescription="carousel"
          aria-label={`${org.acronym} highlights`}
          onKeyDown={onKeyDown}
          className="mt-8"
        >
          {hasControls ? (
            <p id={`${viewportId}-hint`} className="sr-only">
              Use the left and right arrow keys to move between highlights.
            </p>
          ) : null}
          {/* From lg the next card shows past the right edge of the page column; the clip
              keeps the previous one out of the left margin (it starts beyond the gap) while
              leaving room for the cards' shadow. Below lg the padding does the same. */}
          <div
            id={viewportId}
            ref={emblaRef}
            aria-describedby={hasControls ? `${viewportId}-hint` : undefined}
            className="-mx-3 -mb-8 overflow-hidden px-3 pb-8 lg:mx-0 lg:px-0 lg:overflow-visible lg:[clip-path:inset(-3rem_-100vw_-3rem_-1rem)]"
          >
            <div className="flex touch-pan-y gap-4 md:gap-6">
              {highlights.map((highlight, index) => (
                <HighlightSlide
                  key={highlight.id}
                  highlight={highlight}
                  org={org}
                  index={index}
                  count={count}
                  isSelected={index === selected}
                  reduced={reduced}
                  onFocusSlide={() => {
                    if (index !== selected) goTo(index);
                  }}
                />
              ))}
            </div>
          </div>

          {hasControls ? (
            <div className="mt-6 flex items-center justify-between gap-3">
              <ArrowButton
                label="Previous highlight"
                disabled={!canPrev}
                controls={viewportId}
                onClick={() => goTo(selected - 1)}
                className="md:order-2"
              >
                <ChevronLeft aria-hidden="true" className="size-5" />
              </ArrowButton>
              {/* Phones: between the arrows, dots over the counter. From md: on the left. */}
              <div className="flex min-w-0 flex-col items-center md:order-1 md:mr-auto md:flex-row md:gap-2">
                <p aria-hidden="true" className="text-small font-medium text-ink max-md:order-2 md:min-w-12 md:text-body">
                  {selected + 1} / {count}
                </p>
                {/* Six dots and two arrows do not fit a 360px phone: the counter alone does. */}
                <div className={cn('flex', count > 4 && 'max-sm:hidden')}>
                  {highlights.map((highlight, index) => {
                    const isCurrent = index === selected;
                    return (
                      <button
                        key={highlight.id}
                        type="button"
                        aria-label={`Highlight ${index + 1} of ${count}: ${highlight.title}`}
                        aria-current={isCurrent || undefined}
                        aria-controls={viewportId}
                        onClick={() => goTo(index)}
                        className="group grid size-11 cursor-pointer place-items-center rounded-full"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'h-2.5 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none',
                            isCurrent
                              ? 'w-7 bg-ink'
                              : 'w-2.5 bg-olive group-hover:bg-leaf group-focus-visible:bg-leaf',
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
              <ArrowButton
                label="Next highlight"
                disabled={!canNext}
                controls={viewportId}
                onClick={() => goTo(selected + 1)}
                className="md:order-3"
              >
                <ChevronRight aria-hidden="true" className="size-5" />
              </ArrowButton>
            </div>
          ) : null}

          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {announce && current ? `Highlight ${selected + 1} of ${count}: ${current.title}` : ''}
          </p>
        </div>
      </Container>
    </section>
  );
}

interface HighlightSlideProps {
  highlight: PostCardModel;
  org: HighlightCarouselProps['org'];
  index: number;
  count: number;
  isSelected: boolean;
  reduced: boolean;
  onFocusSlide: () => void;
}

function HighlightSlide({
  highlight,
  org,
  index,
  count,
  isSelected,
  reduced,
  onFocusSlide,
}: HighlightSlideProps) {
  return (
    <motion.article
      role="group"
      aria-roledescription="slide"
      aria-label={`Highlight ${index + 1} of ${count}`}
      aria-current={isSelected || undefined}
      // Tabbing into a card that is off to the side brings it into view.
      onFocus={onFocusSlide}
      animate={{ opacity: isSelected ? 1 : 0.45 }}
      initial={false}
      transition={reduced ? { duration: 0 } : cinematic}
      className={cn(
        'min-w-0 shrink-0 grow-0 basis-full lg:basis-[82%] xl:basis-[80%]',
        'flex flex-col overflow-hidden rounded-[1.75rem] border border-sage/40 bg-white shadow-pool',
        'md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-center md:gap-8 md:p-5 lg:gap-10 lg:p-6',
      )}
    >
      <div className="order-2 flex flex-col gap-3 p-5 pt-5 md:order-1 md:p-0 md:pl-3 lg:pl-6">
        <time dateTime={highlight.dateTime} className="text-small font-medium text-ink-muted">
          {highlight.date}
        </time>
        <h3 className="line-clamp-2 text-h3 font-bold text-balance text-ink lg:text-h2">
          {highlight.title}
        </h3>
        <p className="line-clamp-3 text-body text-pretty text-ink-muted lg:line-clamp-4">
          {highlight.summary}
        </p>
        <PillButton asChild className="mt-3 self-start max-md:w-full">
          <OriginLink to={highlight.href}>
            Read full highlight
            <ArrowRight aria-hidden="true" />
          </OriginLink>
        </PillButton>
      </div>

      <div className="order-1 md:order-2">
        {highlight.cover ? (
          <img
            src={highlight.cover.url}
            srcSet={highlight.cover.srcSet ?? undefined}
            sizes={COVER_SIZES.carousel}
            alt={highlight.cover.alt}
            loading={index === 0 ? 'eager' : 'lazy'}
            decoding="async"
            className="aspect-[4/3] w-full bg-surface-deep object-cover md:rounded-[1.25rem]"
          />
        ) : (
          <div className="grid aspect-[4/3] w-full place-items-center bg-sage/20 md:rounded-[1.25rem]">
            <HexFrame className="w-[44%]">
              <OrgLogo
                name={org.name}
                src={org.logoSrc}
                srcSet={org.logoSrcSet}
                sizes={LOGO_SIZES.carousel}
                alt=""
                fallbackText={org.acronym}
                className="size-full"
              />
            </HexFrame>
          </div>
        )}
      </div>
    </motion.article>
  );
}

function ArrowButton({
  label,
  disabled,
  controls,
  onClick,
  children,
  className,
}: {
  label: string;
  disabled: boolean;
  controls: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-controls={controls}
      // aria-disabled keeps it focusable, so keyboard users can still find it.
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'grid size-12 cursor-pointer place-items-center rounded-full border-[1.5px] border-ink bg-white text-ink',
        'transition-colors duration-300 hover:bg-forest-700 hover:text-white focus-visible:bg-forest-700 focus-visible:text-white motion-reduce:transition-none',
        'aria-disabled:cursor-default aria-disabled:border-sage aria-disabled:text-ink-muted aria-disabled:hover:bg-white aria-disabled:hover:text-ink-muted',
        className,
      )}
    >
      {children}
    </button>
  );
}
