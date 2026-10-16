import { useMemo, useState } from 'react';
import { Outlet } from 'react-router';
import { Toaster } from 'sonner';
import { useAccountMenu } from '@/features/auth/presenters/use-account-menu';
import { useDocumentSearch } from '@/features/search/presenters/use-document-search';
import { useScrolled } from '@/hooks/use-scrolled';
import { EMPTY_CHROME, PageChromeContext, type PageChrome } from '@/navigation/page-chrome';
import { AppHeader } from './app-header';
import { TrailBar } from './trail-bar';

/**
 * The layout route around every page, so none can be missing the header: the sticky
 * header, the Back button and breadcrumbs the page publishes with usePageChrome, the
 * page itself, and the toast region.
 */
export function AppShell() {
  const [chrome, setChrome] = useState<PageChrome>(EMPTY_CHROME);
  const context = useMemo(() => ({ chrome, setChrome }), [chrome]);
  const search = useDocumentSearch();
  const account = useAccountMenu();
  const scrolled = useScrolled();
  const overlay = chrome.overlay === true;

  return (
    <PageChromeContext value={context}>
      <div className="bg-surface-sweep min-h-dvh pb-safe text-foreground">
        <a
          href="#content"
          className="sr-only z-50 rounded-full bg-ink px-5 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <AppHeader
          search={search}
          account={account}
          section={chrome.section}
          overlay={overlay}
          solid={!overlay || scrolled}
        />
        <TrailBar chrome={chrome} />
        <div id="content" tabIndex={-1} className="outline-none">
          <Outlet />
        </div>
        <Toaster
          position="top-center"
          offset={{ top: 'calc(var(--header-h) + 0.75rem)' }}
          toastOptions={{
            classNames: {
              toast:
                'rounded-2xl! border-0! bg-ink! font-sans! text-body! text-white! shadow-pool-lift!',
              title: 'font-semibold!',
            },
          }}
        />
      </div>
    </PageChromeContext>
  );
}
