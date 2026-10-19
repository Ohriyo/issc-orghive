/**
 * Pages are loaded on demand. If a page's file cannot be fetched (the server restarted, the
 * connection dropped, or a new version was deployed and the old file is gone), the fix is
 * a fresh load of the app. This reloads once, and never twice in a row, so a page that is
 * truly broken shows its error instead of looping.
 */

const KEY = 'orghive:chunk-reload-at';
/** A second failure within this long after a reload is shown, not retried. */
const RETRY_WINDOW_MS = 10_000;

/** The browsers' wordings for a failed dynamic import (Chrome, Firefox, Safari). */
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_ERROR.test(error.message);
}

/**
 * Reloads the page unless it already did so moments ago. Returns whether it reloaded.
 * Storage can be unavailable (private mode, blocked site data): then it reloads anyway,
 * which at worst means one more attempt.
 */
export function reloadOnce(
  now: number = Date.now(),
  reload: () => void = () => window.location.reload(),
): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (now - last < RETRY_WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // No storage: reload without the loop guard.
  }
  reload();
  return true;
}
