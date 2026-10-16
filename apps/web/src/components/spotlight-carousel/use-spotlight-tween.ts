import { useCallback, useEffect } from 'react';
import type { UseEmblaCarouselType } from 'embla-carousel-react';

type EmblaApi = NonNullable<UseEmblaCarouselType[1]>;

export type SpotlightVariant = 'tower' | 'hex';

export interface SpotlightStyle {
  scale: number;
  translateY: number;
  opacity: number;
  blur: number;
  zIndex: number;
}

/**
 * How a slide looks at `distance` slides from the center (0 = centered).
 * Tower: neighbours shrink from the bottom, like the CSC prototype screens.
 * Hex: neighbours drop down and tuck behind the centered hexagon, like the SBO screens.
 */
export function spotlightStyle(
  variant: SpotlightVariant,
  distance: number,
  reduced: boolean,
): SpotlightStyle {
  const near = Math.min(distance, 1);
  const far = Math.max(0, Math.min(distance - 1, 1));
  return {
    scale: variant === 'tower' ? 1 - 0.35 * near : 1 - 0.08 * near,
    translateY: variant === 'tower' ? 8 * far : 42 * near + 6 * far,
    opacity: 1 - 0.18 * near - 0.27 * far,
    blur: reduced ? 0 : 2 * near + 2 * far,
    zIndex: 100 - Math.round(distance * 10),
  };
}

/**
 * Drives the spotlight effect from Embla's scroll position, so slides scale, fade and
 * blur continuously while dragging instead of snapping between states.
 * Based on Embla's "tween" pattern, including the correction for looped slides.
 */
export function useSpotlightTween(
  emblaApi: EmblaApi | undefined,
  variant: SpotlightVariant,
  reduced: boolean,
) {
  const apply = useCallback(
    (api: EmblaApi, eventName?: string) => {
      const engine = api.internalEngine();
      const scrollProgress = api.scrollProgress();
      const snaps = api.scrollSnapList();
      const slidesInView = api.slidesInView();
      const isScrollEvent = eventName === 'scroll';
      const slides = api.slideNodes();

      snaps.forEach((snap, snapIndex) => {
        engine.slideRegistry[snapIndex]?.forEach((slideIndex) => {
          if (isScrollEvent && !slidesInView.includes(slideIndex)) return;

          let diff = snap - scrollProgress;
          if (engine.options.loop) {
            for (const loopItem of engine.slideLooper.loopPoints) {
              const target = loopItem.target();
              if (slideIndex === loopItem.index && target !== 0) {
                diff =
                  Math.sign(target) === -1
                    ? snap - (1 + scrollProgress)
                    : snap + (1 - scrollProgress);
              }
            }
          }

          const distance = Math.abs(diff) * snaps.length;
          const s = spotlightStyle(variant, distance, reduced);
          const slide = slides[slideIndex];
          const node = slide?.querySelector<HTMLElement>('[data-spotlight-tween]');
          if (!slide || !node) return;

          slide.style.zIndex = String(s.zIndex);
          node.style.transform = `translateY(${s.translateY}%) scale(${s.scale})`;
          node.style.opacity = String(s.opacity);
          node.style.filter = s.blur > 0.05 ? `blur(${s.blur.toFixed(2)}px)` : 'none';
        });
      });
    },
    [variant, reduced],
  );

  useEffect(() => {
    if (!emblaApi) return;
    apply(emblaApi);
    emblaApi.on('reInit', apply).on('scroll', apply).on('slideFocus', apply);
    return () => {
      emblaApi.off('reInit', apply).off('scroll', apply).off('slideFocus', apply);
    };
  }, [emblaApi, apply]);
}
