import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthResponse,
  DocumentSummary,
  DocumentVersion,
  DocumentViewerResponse,
  OrganizationDetail,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { accountSession, TEST_ORGS, type TestAccount } from '@/test/accounts';

const JPICE_ID = '0195f3c0-0000-7000-8000-0000000000a1';
const DOC_ID = '0195f3c0-0000-7000-8000-0000000000d1';

const DOC: DocumentSummary = {
  id: DOC_ID,
  title: 'Bridge design competition',
  description: null,
  academicYear: '2026-2027',
  semester: 'first',
  status: 'available',
  visibility: 'governing',
  tags: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  organization: { type: 'SBO', slug: 'jpice', acronym: 'JPICE', name: 'JPICE full name' },
  type: { id: '0195f3c0-0000-7000-8000-0000000000e1', slug: 'proposal', name: 'Proposal' },
  currentVersion: null,
};

const VERSION_ID = '0195f3c0-0000-7000-8000-0000000000f1';
const JPICE_DETAIL: OrganizationDetail = {
  id: JPICE_ID,
  type: 'SBO',
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'JPICE full name',
  description: null,
  logoUrl: null,
  logoSrcSet: null,
  parent: null,
  college: null,
  mission: null,
  vision: null,
  contactEmail: null,
  links: [],
  officers: [],
  coverUrl: null,
  coverSrcSet: null,
};
const CLEAN_VERSION: DocumentVersion = {
  id: VERSION_ID,
  version: 1,
  originalFilename: 'bridge.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  scanStatus: 'clean',
  createdAt: '2026-10-01T00:00:00.000Z',
  isCurrent: true,
  actingAs: null,
};
const READY: DocumentViewerResponse = {
  versionId: VERSION_ID,
  status: 'ready',
  pages: [
    { width: 1240, height: 1754 },
    { width: 1240, height: 1754 },
  ],
  totalPages: 2,
  token: 'page.token',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

/** `own`: JPICE's account; `governing`: its CSC; `issc`: the ISSC account. */
function session(role: TestAccount): AuthResponse {
  return accountSession(role, { ...TEST_ORGS.jpice, id: JPICE_ID });
}

const fetchMock = vi.fn<typeof fetch>();
const calls: { url: string; method: string; body?: unknown }[] = [];
/** The server's copy, so a refetch after a change returns what was saved. */
let stored: DocumentSummary = DOC;
let viewer: DocumentViewerResponse = READY;
let versions: DocumentVersion[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

beforeEach(() => {
  stored = DOC;
  viewer = READY;
  versions = [];
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as object) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url.endsWith(`/documents/${DOC_ID}/visibility`)) {
      stored = { ...stored, ...body };
      return json(stored);
    }
    if (url.endsWith(`/documents/${DOC_ID}/versions`)) return json({ versions });
    if (url.endsWith(`/documents/${DOC_ID}/viewer`)) return json(viewer);
    if (url.endsWith('/organizations/jpice')) return json(JPICE_DETAIL);
    if (url.endsWith(`/documents/${DOC_ID}`)) return json(stored);
    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
});
afterEach(() => {
  fetchMock.mockReset();
  calls.length = 0;
  vi.unstubAllGlobals();
  authStore.reset();
});

function renderDocument() {
  const router = createMemoryRouter(routes, { initialEntries: [`/documents/${DOC_ID}`] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('/documents/:id visibility', () => {
  it(
    'lets an officer of the organization change who can see it',
    // First test in the file: also loads the lazy route and the AppShell.
    { timeout: 15_000 },
    async () => {
      authStore.setSession(session('own'));
      renderDocument();
      const select = await screen.findByRole(
        'combobox',
        { name: 'Who can see it' },
        { timeout: 5000 },
      );
      expect(select).toHaveValue('governing');
      expect(
        screen.getByText('Your organization, your college CSC and the ISSC'),
      ).toBeInTheDocument();
      fireEvent.change(select, { target: { value: 'public' } });
      await waitFor(() =>
        expect(calls).toContainEqual({
          url: `/api/v1/documents/${DOC_ID}/visibility`,
          method: 'PATCH',
          body: { visibility: 'public' },
        }),
      );
      expect(await screen.findByRole('combobox', { name: 'Who can see it' })).toHaveValue('public');
    },
  );

  it('shows governing bodies who can see it, without a control', async () => {
    for (const role of ['governing', 'issc'] as const) {
      authStore.setSession(session(role));
      renderDocument();
      expect(
        await screen.findByText('Governing bodies', {}, { timeout: 5000 }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: /Who can see it/ })).not.toBeInTheDocument();
      document.body.innerHTML = '';
    }
  });

  it('shows the lifecycle state, never a review status', async () => {
    renderDocument();
    expect(await screen.findByText('Available', {}, { timeout: 5000 })).toBeInTheDocument();
    // Whole words: the "Preview" of the pages is not a review.
    expect(screen.queryByText(/\breview|\bapproved/i)).not.toBeInTheDocument();
  });
});

/** Every page counts as on screen, so the viewer mounts its images. */
class VisibleObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

describe('/documents/:id view-only viewer', () => {
  beforeEach(() => {
    stored = { ...DOC, visibility: 'public' };
    versions = [CLEAN_VERSION];
    vi.stubGlobal('IntersectionObserver', VisibleObserver);
  });

  it('shows a visitor the watermarked pages and no way to download', async () => {
    renderDocument();
    const page1 = await screen.findByRole('img', { name: 'Page 1' }, { timeout: 5000 });
    expect(page1).toHaveAttribute('src', `/api/v1/documents/${DOC_ID}/pages/1?token=page.token`);
    expect(screen.getByRole('img', { name: 'Page 2' })).toHaveAttribute('draggable', 'false');
    expect(
      screen.getByText('View only. This document cannot be downloaded or printed.'),
    ).toBeInTheDocument();
    // The version is listed, but the original is never offered.
    expect(await screen.findByText(/bridge\.pdf/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('download-url'))).toBe(false);
  });

  it('never offers the original to a governing body either', async () => {
    authStore.setSession(session('governing'));
    renderDocument();
    await screen.findByRole('img', { name: 'Page 1' }, { timeout: 5000 });
    expect(await screen.findByText(/bridge\.pdf/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
  });

  it('lets the owning organization download the original', { timeout: 15_000 }, async () => {
    authStore.setSession(session('own'));
    renderDocument();
    // Role queries are slow on this page; wait on the text, then look the button up once.
    await screen.findByText('Upload a new version', {}, { timeout: 8000 });
    expect(screen.getByRole('button', { name: /^Download\s*version 1$/ })).toBeInTheDocument();
    expect(
      screen.getByText(/Your organization can download the original below/),
    ).toBeInTheDocument();
  });

  it('blocks right-click and dragging on the pages', async () => {
    renderDocument();
    const page1 = await screen.findByRole('img', { name: 'Page 1' }, { timeout: 5000 });
    // fireEvent returns false when the default action was prevented.
    expect(fireEvent.contextMenu(page1)).toBe(false);
    expect(fireEvent.dragStart(page1)).toBe(false);
  });

  it('pages through and zooms with the toolbar', async () => {
    renderDocument();
    await screen.findByRole('img', { name: 'Page 1' }, { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    const input = screen.getByRole('textbox', { name: 'Page number, 1 to 2' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(input).toHaveValue('2');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: /^Zoom 125%/ }));
    expect(screen.getByRole('button', { name: /^Zoom 100%/ })).toBeInTheDocument();
  });

  it('says "Preparing preview…" until the pages are ready', async () => {
    viewer = {
      ...READY,
      status: 'pending',
      pages: [],
      totalPages: 0,
      token: null,
      expiresAt: null,
    };
    renderDocument();
    expect(
      await screen.findByText('Preparing preview…', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Page/ })).not.toBeInTheDocument();
  });

  it('explains when a file has no preview', async () => {
    viewer = { ...READY, status: 'failed', pages: [], totalPages: 0, token: null, expiresAt: null };
    renderDocument();
    expect(
      await screen.findByText('No preview for this file', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
