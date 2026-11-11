import { useEffect, useRef } from 'react';
import { Container } from '@/components/container';
import { useActiveSection } from '@/hooks/use-active-section';
import { cn } from '@/lib/utils';
import { SECTION_LABELS, type SectionId } from '../presenters/org-page-layout';

/** Where a section lands under the sticky header (and the chip bar below lg). */
export const SECTION_SCROLL_MARGIN =
  'scroll-mt-[calc(var(--header-h)+4.5rem)] lg:scroll-mt-[calc(var(--header-h)+2rem)]';

/**
 * "On this page" for /orgs/:slug, the sections it shows in the template's order. Below lg a
 * sticky row of chips under the header that scrolls sideways; from lg a quiet list in the
 * left rail that stays in view. The section being read is marked (aria-current).
 */
export function SectionNav({ sections, rail }: { sections: SectionId[]; rail?: boolean }) {
  const active = useActiveSection(sections);
  const strip = useRef<HTMLUListElement>(null);

  // Keep the current chip in view on phones, by scrolling the strip only (never the page).
  useEffect(() => {
    if (rail) return;
    const list = strip.current;
    const chip = list?.querySelector<HTMLElement>('[aria-current]');
    if (!list || !chip) return;
    const left = chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2;
    list.scrollTo?.({ left: Math.max(0, left), behavior: 'smooth' });
  }, [active, rail]);

  if (sections.length < 2) return null;

  if (rail) {
    return (
      <nav aria-label="On this page" className="sticky top-[calc(var(--header-h)+2rem)]">
        <p className="text-small font-medium text-ink-muted">On this page</p>
        <ul className="mt-3 border-l border-sage/60">
          {sections.map((id) => (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={active === id ? 'location' : undefined}
                className={cn(
                  '-ml-px flex min-h-11 items-center border-l-2 border-transparent pl-4 text-body text-ink-muted transition-colors duration-300',
                  'hover:text-ink focus-visible:text-ink',
                  'aria-[current]:border-leaf aria-[current]:font-semibold aria-[current]:text-ink',
                )}
              >
                {SECTION_LABELS[id]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav
      aria-label="On this page"
      className="sticky top-[var(--header-h)] z-20 border-y border-sage/40 bg-surface/95 backdrop-blur-sm lg:hidden"
    >
      <Container>
        <ul
          ref={strip}
          className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6"
        >
          {sections.map((id) => (
            <li key={id} className="shrink-0 snap-start">
              <a
                href={`#${id}`}
                aria-current={active === id ? 'location' : undefined}
                className={cn(
                  'flex min-h-11 items-center rounded-full border border-sage/60 bg-white px-4 text-small font-medium text-ink transition-colors duration-300',
                  'hover:border-ink focus-visible:border-ink',
                  'aria-[current]:border-ink aria-[current]:bg-ink aria-[current]:text-white',
                )}
              >
                {SECTION_LABELS[id]}
              </a>
            </li>
          ))}
        </ul>
      </Container>
    </nav>
  );
}
