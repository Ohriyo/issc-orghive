import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { SpotlightItem } from '@/components/spotlight-carousel/spotlight-carousel';

export const FOCUS_PARAM = 'focus';

export interface FocusParam {
  /** Index of the `?focus=` item, or 0 when it is missing or unknown. */
  initialIndex: number;
  /** Keeps `?focus=` in step with the centered item. Stable across renders. */
  onSelectedChange: (item: SpotlightItem) => void;
}

/**
 * Makes the carousel position shareable: `?focus=cea` centers CEA on arrival, and the
 * param follows the carousel as it moves. Updates replace the history entry, so browsing
 * the carousel does not fill up the back button.
 */
export function useFocusParam(items: SpotlightItem[]): FocusParam {
  const [params, setParams] = useSearchParams();
  // Read once, on arrival. The carousel only uses initialIndex when it mounts, and a
  // changing value would re-initialize it mid-animation.
  const [arrivalFocus] = useState(() => params.get(FOCUS_PARAM));

  const index = items.findIndex((item) => item.id === arrivalFocus);
  const initialIndex = index === -1 ? 0 : index;

  const onSelectedChange = useCallback(
    (item: SpotlightItem) => {
      setParams(
        (current) => {
          if (current.get(FOCUS_PARAM) === item.id) return current;
          const next = new URLSearchParams(current);
          next.set(FOCUS_PARAM, item.id);
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams],
  );

  return { initialIndex, onSelectedChange };
}
