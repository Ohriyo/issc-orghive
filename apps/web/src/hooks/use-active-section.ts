import { useEffect, useState } from 'react';

/**
 * Which of the page's sections the reader is in: the last one whose top has passed a line a
 * third of the way down the viewport. Drives "On this page" (aria-current). Starts on the
 * first id; IntersectionObserver only tells it when a section crosses that line.
 */
export function useActiveSection(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join(' ');

  useEffect(() => {
    const elements = key
      .split(' ')
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const pick = () => {
      const line = window.innerHeight / 3;
      let current = elements[0]!.id;
      for (const el of elements) {
        if (el.getBoundingClientRect().top <= line) current = el.id;
      }
      setActive(current);
    };
    // Each crossing of the line re-reads every section's position: cheap, and never out of order.
    const observer = new IntersectionObserver(pick, { rootMargin: '0px 0px -66% 0px' });
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [key]);

  return active;
}
