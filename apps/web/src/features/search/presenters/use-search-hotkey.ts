import { useEffect, useEffectEvent } from 'react';

/** True for Cmd+K on macOS and Ctrl+K elsewhere, the usual command-palette shortcut. */
export function isSearchHotkey(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'k'
  );
}

/**
 * Opens search on Cmd/Ctrl+K from anywhere in the app, also while typing in a field (the
 * browser's own Ctrl+K is overridden only on Orghive pages).
 */
export function useSearchHotkey(onOpen: () => void): void {
  const open = useEffectEvent(onOpen);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || !isSearchHotkey(event)) return;
      event.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
