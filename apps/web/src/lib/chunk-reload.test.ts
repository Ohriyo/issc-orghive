import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadOnce } from './chunk-reload';

afterEach(() => sessionStorage.clear());

describe('isChunkLoadError', () => {
  it('recognises each browser’s failed-import message', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: http://localhost:5173/src/x.tsx',
      'error loading dynamically imported module: http://x/assets/a.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/index.css',
    ]) {
      expect(isChunkLoadError(new TypeError(message))).toBe(true);
    }
  });

  it('leaves real errors alone', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });
});

describe('reloadOnce', () => {
  it('reloads, but not again moments later, so a broken page cannot loop', () => {
    const reload = vi.fn();
    expect(reloadOnce(1_000_000, reload)).toBe(true);
    expect(reloadOnce(1_005_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads again after the retry window', () => {
    const reload = vi.fn();
    reloadOnce(1_000_000, reload);
    expect(reloadOnce(1_020_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
