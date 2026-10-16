import {
  useCallback,
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { cn } from '@/lib/utils';
import { HexFrame } from '../hex-frame';
import { OrgLogo } from '../org-logo';
import { LOGO_SIZES } from '../logo-sizes';
import { focusReveal, fadeReveal, usePrefersReducedMotion } from '../motion';
import { PillButton } from '../pill-button';
import { useSpotlightTween, type SpotlightVariant } from './use-spotlight-tween';

export interface SpotlightItem {
  id: string;
  name: string;
  motto?: string;
  logoSrc?: string;
  logoSrcSet?: string;
  /** Defaults to "<name> logo". */
  logoAlt?: string;
  /** Where "Proceed" goes. */
  href: string;
  /** Short name shown if the logo is missing or fails, e.g. "CEA". Defaults to initials. */
  shortName?: string;
}

export interface SpotlightCarouselProps {
  items: SpotlightItem[];
  /** `tower`: the CSC screens (hexagon on a banner, with motto). `hex`: the SBO screens. */
  variant?: SpotlightVariant;
  /** Accessible name of the carousel, e.g. "Collegiate Student Councils". */
  label: string;
  /** Used in button labels: "Next college". */
  itemNoun?: string;
  proceedLabel?: string;
  initialIndex?: number;
  onSelectedChange?: (item: SpotlightItem) => void;
  emptyState?: ReactNode;
  isLoading?: boolean;
  /** When set, shown instead of the carousel, e.g. a message with a retry button. */
  error?: ReactNode;
  className?: string;
}

/**
 * A looping carousel that spotlights the centered item: it is full size and sharp, shows its
 * name, motto and "Proceed", while its neighbours shrink, fade and blur behind it.
 * Swipe, the ← → Home End keys and clicks move it everywhere; arrow buttons appear from lg
 * up, and below lg dot indicators (or a counter, for long lists) show and set the position.
 * Clicking the centered item proceeds. With prefers-reduced-motion, slides jump instead of gliding and nothing blurs.
 * One item renders as a still spotlight with no controls; two items do not loop.
 */
export function SpotlightCarousel({
  items,
  variant = 'tower',
  label,
  itemNoun = 'item',
  proceedLabel = 'Proceed',
  initialIndex = 0,
  onSelectedChange,
  emptyState,
  isLoading = false,
  error,
  className,
}: SpotlightCarouselProps) {
  const reduced = usePrefersReducedMotion();
  const navigate = useNavigate();
  const viewportId = useId();
  const hintId = useId();
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: items.length > 2,
    align: 'center',
    startIndex: initialIndex,
    duration: 34,
    // Keep every slide centerable, even when all of them fit (1-2 items).
    containScroll: false,
  });
  const [selected, setSelected] = useState(initialIndex);
  const [canPrev, setCanPrev] = useState(true);
  const [canNext, setCanNext] = useState(true);
  // Announce slide changes only after the user moves the carousel, not on page load.
  const [announce, setAnnounce] = useState(false);
  const hasControls = items.length > 1;

  useSpotlightTween(emblaApi, variant, reduced);

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

  const current = items[selected];
  useEffect(() => {
    if (current) onSelectedChange?.(current);
  }, [current, onSelectedChange]);

  // Reduced motion: jump straight to the slide instead of animating the scroll.
  const prev = useCallback(() => {
    setAnnounce(true);
    emblaApi?.scrollPrev(reduced);
  }, [emblaApi, reduced]);
  const next = useCallback(() => {
    setAnnounce(true);
    emblaApi?.scrollNext(reduced);
  }, [emblaApi, reduced]);
  const goTo = useCallback(
    (index: number) => {
      setAnnounce(true);
      emblaApi?.scrollTo(index, reduced);
    },
    [emblaApi, reduced],
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (!hasControls) return;
    const keys: Record<string, () => void> = {
      ArrowLeft: prev,
      ArrowRight: next,
      Home: () => goTo(0),
      End: () => goTo(items.length - 1),
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  const onSlideClick = (event: MouseEvent, index: number, item: SpotlightItem) => {
    // The Proceed link handles its own click.
    if ((event.target as HTMLElement).closest('a')) return;
    if (index === selected) void navigate(item.href);
    else goTo(index);
  };

  if (error) return <div className={className}>{error}</div>;
  if (isLoading) return <SpotlightSkeleton variant={variant} className={className} />;
  if (items.length === 0) return <div className={className}>{emptyState}</div>;

  return (
    // Arrow keys work anywhere inside the carousel, including on the buttons and links.
    <section
      aria-roledescription="carousel"
      aria-label={label}
      onKeyDown={onKeyDown}
      // Slide sizes follow the carousel's own width, so it works in narrow columns too.
      className={cn('@container relative', className)}
    >
      {hasControls && (
        <>
          <p id={hintId} className="sr-only">
            Use the left and right arrow keys to browse, Home and End to jump to the ends.
          </p>
          {/* Controls come before the slides so keyboard users reach them first. */}
          <ChevronButton
            direction="prev"
            onClick={prev}
            disabled={!canPrev}
            label={`Previous ${itemNoun}`}
            controls={viewportId}
          />
          <ChevronButton
            direction="next"
            onClick={next}
            disabled={!canNext}
            label={`Next ${itemNoun}`}
            controls={viewportId}
          />
        </>
      )}
      <div
        ref={emblaRef}
        id={viewportId}
        tabIndex={hasControls ? 0 : undefined}
        role="group"
        aria-label="Slides"
        aria-describedby={hasControls ? hintId : undefined}
        className="overflow-hidden rounded-sm focus-visible:outline-offset-4"
      >
        <div className={cn('flex touch-pan-y', variant === 'tower' ? 'pt-6' : 'pt-4')}>
          {items.map((item, index) => {
            const isSelected = index === selected;
            return (
              <div
                key={item.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${items.length}: ${item.name}`}
                aria-current={isSelected || undefined}
                onClick={(event) => onSlideClick(event, index, item)}
                className={cn(
                  'relative min-w-0 shrink-0 grow-0 cursor-pointer',
                  // Width follows the carousel; max-w also caps it by the screen height
                  // (a slide is about 2.4x as tall as wide for towers, 1.9x for hexagons),
                  // so on short laptop screens (1366x768) the selected slide and its
                  // Proceed button stay above the fold. It has no effect on phones in
                  // portrait or on screens 1080px tall and up.
                  variant === 'tower'
                    ? 'max-w-[max(10rem,calc((100dvh-11rem)*0.42))] basis-[56%] @xl:basis-[40%] @3xl:basis-[36%] @5xl:basis-[21%]'
                    : 'max-w-[max(10rem,calc((100dvh-14.5rem)*0.52))] basis-[50%] @xl:basis-[50%] @3xl:basis-[48%] @5xl:basis-[31%]',
                )}
              >
                <div
                  data-spotlight-tween
                  className={cn(
                    'will-change-transform',
                    variant === 'tower' ? 'origin-bottom' : 'origin-top',
                  )}
                >
                  {variant === 'tower' ? (
                    <TowerSlide
                      item={item}
                      isSelected={isSelected}
                      reduced={reduced}
                      proceedLabel={proceedLabel}
                    />
                  ) : (
                    <HexSlide
                      item={item}
                      isSelected={isSelected}
                      reduced={reduced}
                      proceedLabel={proceedLabel}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {hasControls && (
        <SlidePosition
          count={items.length}
          selected={selected}
          names={items.map((item) => item.name)}
          itemNoun={itemNoun}
          controls={viewportId}
          onSelect={goTo}
        />
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce && current ? `${current.name}, ${selected + 1} of ${items.length}` : ''}
      </p>
    </section>
  );
}

interface SlideProps {
  item: SpotlightItem;
  isSelected: boolean;
  reduced: boolean;
  proceedLabel: string;
}

function Logo({ item, className }: { item: SpotlightItem; className?: string }) {
  return (
    <OrgLogo
      name={item.name}
      src={item.logoSrc}
      srcSet={item.logoSrcSet}
      sizes={LOGO_SIZES.carousel}
      alt={item.logoAlt}
      fallbackText={item.shortName}
      className={className}
    />
  );
}

/** Placeholder with the carousel's footprint: a large centre shape between two smaller ones. */
function SpotlightSkeleton({
  variant,
  className,
}: {
  variant: SpotlightVariant;
  className?: string;
}) {
  const orientation = variant === 'tower' ? 'pointy' : 'flat';
  const side = cn(
    'animate-pulse opacity-40 motion-reduce:animate-none',
    variant === 'tower' ? 'w-[22%] md:w-[14%]' : 'w-[30%] md:w-[24%]',
  );
  return (
    <div
      aria-busy="true"
      className={cn('flex items-end justify-center gap-[3%] overflow-hidden pt-6', className)}
    >
      <span className="sr-only">Loading</span>
      <HexFrame
        orientation={orientation}
        band={false}
        ring={false}
        shadow={false}
        className={side}
      />
      <HexFrame
        orientation={orientation}
        band={false}
        ring={false}
        shadow={false}
        className={cn(
          'animate-pulse opacity-60 motion-reduce:animate-none',
          variant === 'tower' ? 'w-[34%] md:w-[22%]' : 'w-[44%] md:w-[36%]',
        )}
      />
      <HexFrame
        orientation={orientation}
        band={false}
        ring={false}
        shadow={false}
        className={side}
      />
    </div>
  );
}

/** Name, motto and Proceed come into focus one after another when the slide is centered. */
function Details({
  item,
  isSelected,
  reduced,
  proceedLabel,
  proceedVariant,
  className,
}: SlideProps & { proceedVariant: 'light' | 'forest'; className?: string }) {
  const variants = reduced ? fadeReveal : focusReveal;
  return (
    <motion.div
      // Hidden details must not be reachable by keyboard or screen readers.
      inert={!isSelected}
      aria-hidden={!isSelected}
      initial={false}
      animate={isSelected ? 'shown' : 'hidden'}
      variants={{
        shown: {
          transition: { staggerChildren: reduced ? 0 : 0.07, delayChildren: reduced ? 0 : 0.12 },
        },
      }}
      className={cn('flex flex-col items-center text-center', className)}
    >
      <motion.h3
        variants={variants}
        className="text-[clamp(0.875rem,7.5cqw,1.5rem)] leading-tight font-bold text-balance text-white"
      >
        {item.name}
      </motion.h3>
      {item.motto && (
        <motion.p
          variants={variants}
          className="mt-2 text-[clamp(0.875rem,5.5cqw,1.125rem)] text-balance text-white/85 italic"
        >
          “{item.motto}”
        </motion.p>
      )}
      <motion.div variants={variants} className="mt-5">
        <PillButton asChild variant={proceedVariant}>
          <Link to={item.href}>
            {proceedLabel}
            <span className="sr-only">: {item.name}</span>
          </Link>
        </PillButton>
      </motion.div>
    </motion.div>
  );
}

/**
 * CSC tower: a pointy hexagon roof on a tall banner. The roof height is the hexagon's
 * half-side (0.2887 x width), expressed in container units so it tracks the width exactly.
 */
function TowerSlide(props: SlideProps) {
  const { item } = props;
  const band = 7;
  return (
    <div className="@container -mx-[6%] w-[112%]">
      <div className="drop-shadow-hex" style={{ aspectRatio: '1 / 2.05' }}>
        <div
          data-surface="forest"
          className="flex size-full flex-col items-center bg-linear-to-b from-forest-500 to-forest-900"
          style={{
            clipPath: 'polygon(50% 0, 100% 28.87cqw, 100% 100%, 0 100%, 0 28.87cqw)',
            padding: `${band * (2 / Math.sqrt(3))}% ${band}% ${band}%`,
          }}
        >
          <HexFrame
            orientation="pointy"
            band={false}
            ringWidth={3.8}
            shadow={false}
            className="w-full"
            contentClassName="p-[14%]"
          >
            <Logo item={item} className="size-full" />
          </HexFrame>
          <Details {...props} proceedVariant="light" className="mt-[8%] px-[6%]" />
        </div>
      </div>
    </div>
  );
}

/** SBO hexagon: logo and name inside a large flat hexagon, Proceed beneath it. */
function HexSlide(props: SlideProps) {
  const { item } = props;
  return (
    <div className="@container -mx-[14.5%] flex w-[129%] flex-col items-center">
      <HexFrame className="w-full" contentClassName="flex-col gap-[6%] p-[18%] pb-[14%]">
        <Logo item={item} className="min-h-0 w-full flex-1" />
        <p
          aria-hidden="true"
          className={cn(
            'ease-cinematic text-center leading-tight font-bold text-balance text-white transition-opacity duration-500',
            props.isSelected ? 'opacity-100' : 'opacity-0',
          )}
          style={{ fontSize: 'clamp(0.8rem, 5.5cqw, 1.5rem)' }}
        >
          {item.name}
        </p>
      </HexFrame>
      <Details {...props} proceedVariant="forest" className="-mt-1 [&_h3]:sr-only [&_p]:sr-only" />
    </div>
  );
}

/** The prototype's thick filled chevron. */
function ChevronButton({
  direction,
  onClick,
  disabled,
  label,
  controls,
}: {
  direction: 'prev' | 'next';
  onClick: () => void;
  disabled: boolean;
  label: string;
  controls: string;
}) {
  const isPrev = direction === 'prev';
  return (
    <button
      type="button"
      // aria-disabled keeps the button focusable so keyboard users can still find it.
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      aria-label={label}
      aria-controls={controls}
      className={cn(
        // Arrows from lg up; phones and tablets swipe and use the dots instead.
        'group absolute top-[34%] z-[200] hidden size-12 cursor-pointer place-items-center rounded-full lg:grid @3xl:size-20 @5xl:size-24',
        isPrev ? 'left-1 @3xl:left-4' : 'right-1 @3xl:right-4',
        'aria-disabled:cursor-default aria-disabled:opacity-30',
      )}
    >
      <svg
        viewBox="0 0 114 116"
        aria-hidden="true"
        className={cn(
          'ease-cinematic w-7 fill-ink transition-transform duration-300 @3xl:w-14 @5xl:w-[4.5rem] group-aria-disabled:translate-x-0',
          isPrev
            ? 'group-hover:-translate-x-1 group-focus-visible:-translate-x-1'
            : 'rotate-180 group-hover:translate-x-1 group-focus-visible:translate-x-1',
          'motion-reduce:transition-none',
        )}
      >
        <polygon points="0,58 80,0 114,0 40,58 114,116 80,116" />
      </svg>
    </button>
  );
}

/** Lists longer than this get a "3 / 12" counter instead of a dot row that would wrap. */
const MAX_DOTS = 10;

interface SlidePositionProps {
  count: number;
  selected: number;
  names: string[];
  itemNoun: string;
  controls: string;
  onSelect: (index: number) => void;
}

/**
 * Below lg: where the carousel is. Each dot is a 44px button (an 8px dot inside) that
 * jumps to its slide; the current one is wider. Hidden from lg up, where the arrows are.
 */
function SlidePosition({
  count,
  selected,
  names,
  itemNoun,
  controls,
  onSelect,
}: SlidePositionProps) {
  if (count > MAX_DOTS) {
    return (
      <p aria-hidden="true" className="mt-3 text-center text-small text-ink-muted lg:hidden">
        {selected + 1} / {count}
      </p>
    );
  }
  const noun = itemNoun.charAt(0).toUpperCase() + itemNoun.slice(1);
  return (
    <div className="mt-2 flex justify-center lg:hidden">
      {names.map((name, index) => {
        const isCurrent = index === selected;
        return (
          <button
            key={name}
            type="button"
            aria-label={`${noun} ${index + 1} of ${count}: ${name}`}
            aria-current={isCurrent || undefined}
            aria-controls={controls}
            onClick={() => onSelect(index)}
            className="group grid size-11 cursor-pointer place-items-center rounded-full"
          >
            <span
              aria-hidden="true"
              className={cn(
                'ease-cinematic block h-2 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none',
                isCurrent
                  ? 'w-6 bg-ink'
                  : 'w-2 bg-ink/30 group-hover:bg-ink/60 group-focus-visible:bg-ink/60',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
