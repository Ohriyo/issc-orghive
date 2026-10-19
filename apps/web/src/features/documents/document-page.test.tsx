import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResponse, DocumentSummary } from '@orghive/shared';
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

/** `own`: JPICE's account; `governing`: its CSC; `issc`: the ISSC account. */
function session(role: TestAccount): AuthResponse {
  return accountSession(role, { ...TEST_ORGS.jpice, id: JPICE_ID });
}

const fetchMock = vi.fn<typeof fetch>();
const calls: { url: string; method: string; body?: unknown }[] = [];
/** The server's copy, so a refetch after a change returns what was saved. */
let stored: DocumentSummary = DOC;

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

beforeEach(() => {
  stored = DOC;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as object) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url.endsWith(`/documents/${DOC_ID}/visibility`)) {
      stored = { ...stored, ...body };
      return json(stored);
    }
    if (url.endsWith(`/documents/${DOC_ID}/versions`)) return json({ versions: [] });
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
    expect(screen.queryByText(/review|approved/i)).not.toBeInTheDocument();
  });
});
