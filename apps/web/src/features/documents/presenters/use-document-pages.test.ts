import { describe, expect, it } from 'vitest';
import type { DocumentViewerResponse } from '@orghive/shared';
import { nextViewerRefresh, pageSrc } from './use-document-pages';

const NOW = Date.parse('2026-10-20T00:00:00Z');
const base: DocumentViewerResponse = {
  versionId: '0195f3c0-0000-7000-8000-0000000000f1',
  status: 'ready',
  pages: [{ width: 1240, height: 1754 }],
  totalPages: 1,
  token: 't',
  expiresAt: '2026-10-20T00:05:00.000Z',
};

describe('nextViewerRefresh', () => {
  it('renews the page token a minute before it expires', () => {
    expect(nextViewerRefresh(base, NOW)).toBe(4 * 60_000);
  });

  it('waits at most 5 minutes, whatever the expiry says', () => {
    expect(nextViewerRefresh({ ...base, expiresAt: '2099-01-01T00:00:00.000Z' }, NOW)).toBe(
      5 * 60_000,
    );
  });

  it('never polls faster than every 10 seconds, even for a nearly expired token', () => {
    expect(nextViewerRefresh({ ...base, expiresAt: '2026-10-20T00:00:30.000Z' }, NOW)).toBe(10_000);
  });

  it('checks every 5 seconds while the preview is prepared, and stops when it failed', () => {
    expect(nextViewerRefresh({ ...base, status: 'pending', token: null }, NOW)).toBe(5_000);
    expect(nextViewerRefresh({ ...base, status: 'failed', token: null }, NOW)).toBe(false);
    expect(nextViewerRefresh(undefined, NOW)).toBe(false);
  });
});

describe('pageSrc', () => {
  it('points at the API page route with the token escaped', () => {
    expect(pageSrc('d1', 3, 'a.b+c')).toBe('/api/v1/documents/d1/pages/3?token=a.b%2Bc');
  });
});
