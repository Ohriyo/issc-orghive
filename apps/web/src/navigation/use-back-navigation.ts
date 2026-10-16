import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { readOrigin, type Destination } from './origin';

export interface BackNavigation {
  /** Where Back goes: the page the user came from, else the screen's logical parent. */
  target: Destination | null;
  /** True when `target` is the page the user actually came from. */
  fromOrigin: boolean;
  /**
   * After a successful upload, edit or review: return to `target`, replacing this entry so
   * pressing Back again does not reopen the finished form, and confirm with a toast.
   */
  finish: (message?: string) => void;
}

/**
 * Back navigation that never guesses with navigate(-1), which can leave the site or loop
 * after a redirect. The origin comes from route state set by OriginLink; without one
 * (a direct link or a refresh) it falls back to `parent`.
 */
export function useBackNavigation(parent: Destination | null): BackNavigation {
  const location = useLocation();
  const navigate = useNavigate();
  const origin = readOrigin(location.state, location);
  const target = origin ?? parent;

  return {
    target,
    fromOrigin: origin !== null,
    finish: (message) => {
      if (message) toast.success(message);
      void navigate(target?.path ?? '/', { replace: true });
    },
  };
}
