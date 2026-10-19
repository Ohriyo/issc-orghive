import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResponse, DocumentSummary, OrganizationDetail } from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { accountSession, TEST_ORGS } from '@/test/accounts';
import { checkFile, textToTags, titleFromFilename } from './presenters/use-upload-documents';

const JPICE: OrganizationDetail = {
  id: '0195f3c0-0000-7000-8000-0000000000aa',
  type: 'SBO',
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'Junior Philippine Institute of Civil Engineers',
  description: null,
  logoUrl: null,
  logoSrcSet: null,
  parent: null,
  college: null,
};
const TYPE = {
  id: '0195f3c0-0000-7000-8000-0000000000e1',
  slug: 'activity-proposal',
  name: 'Activity proposal',
};
const DOC_ID = '0195f3c0-0000-7000-8000-0000000000d1';
const VERSION_ID = '0195f3c0-0000-7000-8000-0000000000f1';
const KEY = `uploads/${JPICE.id}/0195f3c0-0000-7000-8000-0000000000c9`;

/** `own`: JPICE's account; `governing`: its CSC, which reads but never uploads. */
function session(role: 'own' | 'governing'): AuthResponse {
  return accountSession(role, { ...TEST_ORGS.jpice, id: JPICE.id });
}

const created: DocumentSummary = {
  id: DOC_ID,
  title: 'Bridge design competition',
  description: null,
  academicYear: '2026-2027',
  semester: null,
  status: 'scanning',
  visibility: 'governing',
  tags: [],
  createdAt: '2026-10-16T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z',
  organization: { type: 'SBO', slug: 'jpice', acronym: 'JPICE', name: JPICE.name },
  type: TYPE,
  currentVersion: null,
};

const fetchMock = vi.fn<typeof fetch>();
const calls: { url: string; body: unknown }[] = [];
const puts: string[] = [];

/** Storage PUTs go through XMLHttpRequest (for progress): a fake that succeeds in two steps. */
class FakeXhr {
  status = 0;
  upload: {
    onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
  } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  private url = '';
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  abort() {}
  send() {
    puts.push(this.url);
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      this.status = 200;
      this.onload?.();
    }, 0);
  }
}

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.endsWith('/organizations/jpice')) return json(JPICE);
    if (url.endsWith('/document-types')) return json({ types: [TYPE] });
    if (url.endsWith('/documents/upload-url')) {
      return json(
        {
          uploadKey: KEY,
          url: 'https://storage.test/put',
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          expiresAt: '2026-10-16T00:05:00.000Z',
        },
        201,
      );
    }
    if (url.endsWith('/organizations/jpice/documents')) return json(created, 201);
    if (url.endsWith(`/documents/${DOC_ID}`)) return json({ ...created, currentVersion: null });
    if (url.endsWith(`/documents/${DOC_ID}/versions`) && init?.method === 'POST') {
      return json(
        {
          id: VERSION_ID,
          version: 2,
          originalFilename: 'v2.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 3,
          scanStatus: 'pending',
          createdAt: '2026-10-16T00:00:00.000Z',
          isCurrent: false,
        },
        201,
      );
    }
    if (url.endsWith(`/documents/${DOC_ID}/versions`)) {
      return json({
        versions: [
          {
            id: VERSION_ID,
            version: 1,
            originalFilename: 'bridge.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            scanStatus: 'clean',
            createdAt: '2026-10-16T00:00:00.000Z',
            isCurrent: true,
          },
        ],
      });
    }
    if (url.includes('/download-url'))
      return json({ url: 'https://storage.test/get', expiresAt: '2026-10-16T00:05:00.000Z' });
    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
});

afterEach(() => {
  fetchMock.mockReset();
  calls.length = 0;
  puts.length = 0;
  vi.unstubAllGlobals();
  authStore.reset();
});

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const pdf = (name = 'bridge_design-competition.pdf') =>
  new File(['%PDF'], name, { type: 'application/pdf' });

function pick(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files } });
}

describe('upload helpers', () => {
  it('derives a title, checks the allow-list and parses tags', () => {
    expect(titleFromFilename('bridge_design-competition 2026.pdf')).toBe(
      'Bridge design competition 2026',
    );
    expect(checkFile(pdf())).toEqual({ contentType: 'application/pdf' });
    expect(checkFile(new File(['x'], 'tool.exe'))).toMatchObject({
      reason: expect.stringContaining('Not an allowed type') as unknown,
    });
    expect(checkFile(new File([], 'empty.pdf'))).toEqual({ reason: 'The file is empty.' });
    expect(textToTags(' bridge, , CE week ')).toEqual(['bridge', 'CE week']);
  });
});

describe('/orgs/:slug/paperworks/upload', () => {
  // A long flow (route load, validation, upload, create): more than the default 5s under load.
  it(
    'uploads each file to storage with progress, then creates the document',
    { timeout: 15_000 },
    async () => {
      authStore.setSession(session('own'));
      const router = renderAt('/orgs/jpice/paperworks/upload');
      expect(
        await screen.findByRole(
          'heading',
          { level: 1, name: 'Upload Paperworks' },
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      // Opened directly (no origin): Back goes to the Dashboard.
      expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute(
        'href',
        '/dashboard',
      );

      pick([pdf(), new File(['MZ'], 'virus.exe')]);
      expect(await screen.findByRole('alert')).toHaveTextContent('virus.exe: Not an allowed type');

      const card = screen.getByText('bridge_design-competition.pdf').closest('li')!;
      expect(within(card).getByRole('textbox', { name: 'Title' })).toHaveValue(
        'Bridge design competition',
      );
      await waitFor(() =>
        expect(within(card).getByRole('option', { name: 'Activity proposal' })).toBeInTheDocument(),
      );

      // Type is required: the shared schema's message shows.
      fireEvent.click(screen.getByRole('button', { name: 'Upload file' }));
      expect(await within(card).findByText('Choose a document type')).toBeInTheDocument();

      fireEvent.change(within(card).getByRole('combobox', { name: 'Type' }), {
        target: { value: TYPE.id },
      });
      fireEvent.change(within(card).getByRole('textbox', { name: 'Tags' }), {
        target: { value: 'bridge, CE week' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Upload file' }));

      // Done: back where the user came from (here the Dashboard), with a toast, replacing
      // the form in the history.
      await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'), {
        timeout: 5000,
      });
      expect(router.state.historyAction).toBe('REPLACE');
      expect(
        await screen.findByText(/Only you see it until the virus scan passes/),
      ).toBeInTheDocument();
      expect(puts).toEqual(['https://storage.test/put']);
      const uploadUrl = calls.find((c) => c.url.endsWith('/upload-url'))!;
      expect(uploadUrl.body).toEqual({
        filename: 'bridge_design-competition.pdf',
        contentType: 'application/pdf',
        sizeBytes: 4,
      });
      const create = calls.find((c) => c.url.endsWith('/organizations/jpice/documents'))!;
      expect(create.body).toMatchObject({
        uploadKey: KEY,
        typeId: TYPE.id,
        tags: ['bridge', 'ce week'],
        // A new file stays with the organization unless the officer chooses otherwise.
        visibility: 'private',
      });
    },
  );

  it('tells any other account it cannot upload here', async () => {
    authStore.setSession(session('governing'));
    renderAt('/orgs/jpice/paperworks/upload');
    expect(
      await screen.findByText(
        /Only JPICE’s own account can upload documents here/,
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose files/ })).not.toBeInTheDocument();
  });
});

describe('/documents/:id files', () => {
  it(
    'lists versions, downloads with a signed link and lets officers upload a new version',
    { timeout: 15_000 },
    async () => {
      authStore.setSession(session('own'));
      const assign = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign });
      renderAt(`/documents/${DOC_ID}`);

      const files = await screen
        .findByRole('region', { name: 'Files' }, { timeout: 5000 })
        .catch(() =>
          screen.findByRole('heading', { name: 'Files' }).then((h) => h.closest('section')!),
        );
      await within(files).findByText(/Version 1/);
      expect(within(files).getByText('Passed the virus scan')).toBeInTheDocument();

      fireEvent.click(within(files).getByRole('button', { name: /Download/ }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://storage.test/get'));

      const reupload = await within(files).findByRole('button', { name: 'Choose a file' });
      expect(reupload).toBeInTheDocument();
      pick([pdf('v2.pdf')]);
      expect(await within(files).findByText(/v2.pdf was uploaded/)).toBeInTheDocument();
      expect(
        calls.some((c) => c.url.endsWith(`/documents/${DOC_ID}/versions`) && c.body !== undefined),
      ).toBe(true);
    },
  );
});
