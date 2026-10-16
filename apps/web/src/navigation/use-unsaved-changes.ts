import { useCallback, useRef } from 'react';
import { useBeforeUnload, useBlocker, type Blocker } from 'react-router';

export interface UnsavedChangesGuard {
  /** Blocked while the user decides; render <UnsavedChangesDialog blocker={…} />. */
  blocker: Blocker;
  /** Let the next navigation through, e.g. right before finish() after a successful save. */
  allowNextNavigation: () => void;
}

/**
 * Asks before leaving a form with unsaved changes: in-app navigation is held by the
 * router's blocker (shown as a dialog), and closing or reloading the tab gets the
 * browser's own prompt. Changes to only the search or hash of the same page pass.
 */
export function useUnsavedChangesGuard(dirty: boolean): UnsavedChangesGuard {
  const allowed = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowed.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (!dirty || allowed.current) return;
        event.preventDefault();
      },
      [dirty],
    ),
  );
  return {
    blocker,
    allowNextNavigation: () => {
      allowed.current = true;
    },
  };
}
