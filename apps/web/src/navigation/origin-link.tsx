import type { ComponentProps } from 'react';
import { Link, useLocation } from 'react-router';
import { originState } from './origin';
import { currentPageLabel, useCurrentChrome } from './page-chrome';

export type OriginLinkProps = Omit<ComponentProps<typeof Link>, 'state'>;

/**
 * A Link into a sub-screen (upload, a document, an edit page) that records the current
 * page as its origin, so the sub-screen's Back button returns here.
 */
export function OriginLink(props: OriginLinkProps) {
  const location = useLocation();
  const chrome = useCurrentChrome();
  return <Link {...props} state={originState(location, currentPageLabel(chrome))} />;
}
