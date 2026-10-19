import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { Container } from '@/components/container';
import { BackButton } from '@/navigation/back-button';
import type { PageChrome } from '@/navigation/page-chrome';

/**
 * Below the header on inner pages: the Back button (where the user came from, else the
 * page's logical parent) and, from md, the breadcrumb trail showing where the page sits.
 * On phones the trail collapses to the Back button alone.
 */
export function TrailBar({ chrome }: { chrome: PageChrome }) {
  if (chrome.trail.length < 2 && !chrome.parent) return null;
  return (
    <Container className="flex min-h-14 items-center gap-4 pt-3">
      <BackButton parent={chrome.parent} className="shrink-0" />
      {chrome.trail.length > 1 ? (
        <nav
          aria-label="Breadcrumb"
          className="hidden min-w-0 border-l border-border pl-4 md:block"
        >
          <ol className="flex flex-wrap items-center gap-x-1 text-small text-ink-muted">
            {chrome.trail.map((crumb, i) => {
              const last = i === chrome.trail.length - 1;
              return (
                <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                  {crumb.href && !last ? (
                    <Link
                      to={crumb.href}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      aria-current={last ? 'page' : undefined}
                      title={crumb.label}
                      className="max-w-[28ch] truncate"
                    >
                      {crumb.label}
                    </span>
                  )}
                  {last ? null : <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
    </Container>
  );
}
