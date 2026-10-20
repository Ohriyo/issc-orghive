import { createContext, useContext, useEffect } from 'react';
import type { Destination } from './origin';

/** One step of the breadcrumb trail. The last step is the current page and has no link. */
export interface Crumb {
  label: string;
  href?: string;
}

/** The header section to highlight. */
export type NavSection = 'home' | 'colleges' | 'leaderboard' | 'issc' | 'dashboard';

/**
 * What a page tells the AppShell about itself: where it sits (trail), its logical parent
 * (where Back goes without an origin), the section to highlight, and whether the header
 * floats over a full-bleed hero (home).
 */
export interface PageChrome {
  section: NavSection | null;
  trail: Crumb[];
  parent: Destination | null;
  overlay?: boolean;
  /** The page's name on a sub-screen's Back button; defaults to the last crumb. */
  label?: string;
}

export const EMPTY_CHROME: PageChrome = { section: null, trail: [], parent: null };

export interface PageChromeContextValue {
  chrome: PageChrome;
  setChrome: (chrome: PageChrome) => void;
}

export const PageChromeContext = createContext<PageChromeContextValue>({
  chrome: EMPTY_CHROME,
  setChrome: () => {},
});

/**
 * Called by every route component: publishes the page's trail, parent and section to the
 * shell. Cleared when the page unmounts, so a page that sets nothing shows no stale trail.
 */
export function usePageChrome(chrome: PageChrome) {
  const { setChrome } = useContext(PageChromeContext);
  const key = JSON.stringify(chrome);
  useEffect(() => {
    setChrome(JSON.parse(key) as PageChrome);
  }, [key, setChrome]);
  useEffect(() => () => setChrome(EMPTY_CHROME), [setChrome]);
}

/** The current page's chrome, for the shell and for links that record their origin. */
export function useCurrentChrome(): PageChrome {
  return useContext(PageChromeContext).chrome;
}

/** The current page's name, as the label a sub-screen's Back button shows. */
export function currentPageLabel(chrome: PageChrome): string {
  return chrome.label ?? chrome.trail.at(-1)?.label ?? 'Home';
}
