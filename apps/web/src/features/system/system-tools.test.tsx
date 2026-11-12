import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  type AdminOrganizationTree,
  type AuthResponse,
  type CacheStats,
  type QueueJobList,
  type QueueList,
  type SecurityCenter,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import { manilaDayBound, organizationOptions } from './presenters/use-system-audit';

/** The console's lazy route loads on the first render: allow it the time. */
const FIRST_LOAD = { timeout: 10_000 };
const NOW = '2026-11-12T08:00:00.000Z';

const SESSION: AuthResponse = {
  accessToken: 'token',
  expiresIn: 900,
  user: {
    id: '0195f3c0-0000-7000-8000-000000000001',
    name: 'Dev Super',
    email: 'dev@orghive.test',
    mustChangePassword: false,
    organization: null,
    officerInCharge: null,
    systemRole: 'SUPER_ADMIN',
    mfaSetupRequired: false,
  },
};

const QUEUES: QueueList = {
  queues: [
    {
      name: 'documents',
      paused: false,
      waiting: 2,
      active: 0,
      delayed: 0,
      failed: 1,
      completed: 9,
    },
    { name: 'previews', paused: true, waiting: 4, active: 0, delayed: 0, failed: 0, completed: 3 },
  ],
  generatedAt: NOW,
};

const FAILED: QueueJobList = {
  queue: QUEUES.queues[0]!,
  state: 'failed',
  page: 0,
  pageSize: 25,
  total: 1,
  items: [
    {
      id: '41',
      name: 'process-version',
      data: { versionId: 'v-41' },
      attemptsMade: 3,
      maxAttempts: 3,
      failedReason: 'ClamAV unreachable',
      queuedAt: NOW,
      startedAt: NOW,
      finishedAt: NOW,
    },
  ],
};

const SECURITY: SecurityCenter = {
  range: '24h',
  since: '2026-11-11T08:00:00.000Z',
  failedLogins: {
    total: 6,
    byIp: [{ ip: '198.51.100.7', count: 6, lastAt: NOW }],
    byAccount: [
      {
        userId: '0195f3c0-0000-7000-8000-0000000000b1',
        email: 'jpice@nwssu.test',
        organization: 'JPICE',
        count: 4,
        lastAt: NOW,
      },
      { userId: null, email: 'ghost@nwssu.test', organization: null, count: 2, lastAt: NOW },
    ],
  },
  lockedAccounts: [
    {
      userId: '0195f3c0-0000-7000-8000-0000000000b2',
      email: 'psme@nwssu.test',
      organization: 'PSME',
      lockedAt: NOW,
      reason: 'End of term: no incoming officer in charge assigned yet',
    },
  ],
  superAdminLockouts: [],
  rateLimitHits: {
    total: 3,
    byLimiter: [{ limiter: 'login-ip', hits: 3 }],
    byIp: [{ ip: '198.51.100.7', hits: 3, limiters: ['login-ip'] }],
  },
  recentAdminActions: [],
  quarantined: {
    total: 2,
    items: [
      {
        documentId: '0195f3c0-0000-7000-8000-0000000000d1',
        organization: { acronym: 'JPICE', slug: 'jpice' },
        title: 'Accomplishment Report',
        kind: 'virus',
        reason: 'Eicar-Test-Signature',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        uploadedAt: NOW,
        quarantinedAt: NOW,
      },
      {
        documentId: '0195f3c0-0000-7000-8000-0000000000d2',
        organization: { acronym: 'PSME', slug: 'psme' },
        title: null,
        kind: 'task_check',
        reason: 'No valid task code',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        uploadedAt: NOW,
        quarantinedAt: null,
      },
    ],
  },
  generatedAt: NOW,
};

const CACHE: CacheStats = {
  namespaces: [
    { id: 'organizations', label: 'Organizations', description: 'Organization pages.', keys: 12 },
    { id: 'colleges', label: 'Colleges', description: 'The college list.', keys: 0 },
  ],
  totalKeys: 80,
  usedMemoryBytes: 2 * 1024 * 1024,
  generatedAt: NOW,
};

const org = (slug: string, acronym: string, type: 'ISSC' | 'CSC' | 'SBO') => ({
  type,
  slug,
  acronym,
  name: acronym,
  description: null,
  logoUrl: null,
  active: true,
  documentCount: 0,
  hasAccount: true,
  accountRequest: null,
});

const TREE: AdminOrganizationTree = {
  issc: org('issc', 'ISSC', 'ISSC'),
  colleges: [
    {
      code: 'CEA',
      slug: 'cea',
      name: 'College of Engineering and Architecture',
      motto: null,
      description: null,
      csc: org('csc-cea', 'CSC-CEA', 'CSC'),
      sbos: [org('jpice', 'JPICE', 'SBO')],
    },
  ],
};

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
const stepUpRequired = () =>
  json({ error: { code: ErrorCode.STEP_UP_REQUIRED, message: 'Enter a code first' } }, 403);

/** Every request: method, path with query, and body. */
const calls: { method: string; path: string; body: unknown }[] = [];
/** Destructive calls answer STEP_UP_REQUIRED until a code is accepted. */
let steppedUp = false;
let emailAnswer: () => Promise<Response>;

function serve() {
  fetchMock.mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url, 'http://x');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path: `${path}${url.search}`, body });

    if (path === '/auth/refresh') return json(SESSION);
    if (path === '/system/account-requests/count') return json({ open: 0 });
    if (path === '/system/alerts') return json({ alerts: [] });
    if (path === '/system/demo-data') return json({ total: 0, counts: {} });
    if (path === '/system/step-up') {
      steppedUp = true;
      return json({ stepUpExpiresAt: NOW });
    }
    if (path === '/system/queues') return json(QUEUES);
    if (path === '/system/queues/documents/jobs') return json(FAILED);
    if (path.endsWith('/retry') || path.endsWith('/remove')) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (path === '/system/queues/documents/pause') {
      return steppedUp ? json({ ...QUEUES.queues[0], paused: true }) : stepUpRequired();
    }
    if (path === '/system/security-center') {
      return json({ ...SECURITY, range: url.searchParams.get('range') ?? '24h' });
    }
    if (path === '/system/cache') return json(CACHE);
    if (path === '/system/cache/flush') {
      return steppedUp ? json({ namespace: 'organizations', deleted: 12 }) : stepUpRequired();
    }
    if (path === '/system/email-test') return emailAnswer();
    if (path === '/system/organizations') return json(TREE);
    if (path === '/system/audit-logs') return json({ items: [], nextCursor: null });
    if (path === '/system/audit-logs/export') {
      return Promise.resolve(
        new Response('﻿Time (UTC),Action\r\n', {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="orghive-audit-2026-11-12.csv"',
            'X-Orghive-Truncated': '1',
          },
        }),
      );
    }
    return json({ items: [], unreadCount: 0, nextCursor: null });
  });
}

function renderAt(url: string) {
  authStore.setSession(SESSION);
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const posted = (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path);

beforeEach(() => {
  calls.length = 0;
  steppedUp = false;
  emailAnswer = () =>
    json({ to: 'dev@orghive.test', delivered: true, error: null, durationMs: 120, sentAt: NOW });
  vi.stubGlobal('fetch', fetchMock);
  serve();
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  authStore.reset();
});

async function enterStepUpCode() {
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(/code/i), { target: { value: '123456' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /confirm|continue|verify/i }));
}

describe('/system/queues', () => {
  it(
    'lists queues and failed jobs, retries one, and asks for a code before pausing',
    { timeout: 20_000 },
    async () => {
      renderAt('/system/queues');
      expect(
        await screen.findByRole('heading', { name: 'Queues', level: 1 }, FIRST_LOAD),
      ).toBeVisible();
      const previews = await screen.findByRole('button', { name: /previews/ });
      expect(within(previews).getByText('Paused')).toBeVisible();
      expect(screen.getByRole('button', { name: /documents/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      expect(await screen.findByText('ClamAV unreachable')).toBeVisible();
      expect(screen.getByText(/3 of 3 attempts/)).toBeVisible();

      fireEvent.click(screen.getByRole('button', { name: 'Retry job 41' }));
      await waitFor(() => expect(posted('/system/queues/documents/jobs/41/retry')).toHaveLength(1));

      fireEvent.click(screen.getByRole('button', { name: 'Remove job 41' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Remove job' }));
      await waitFor(() =>
        expect(posted('/system/queues/documents/jobs/41/remove')).toHaveLength(1),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Pause queue' }));
      // The confirmation says what pausing stops; the page behind it is hidden while it is open.
      expect(await screen.findByRole('alertdialog')).toHaveTextContent(
        /Paused, this stops: Virus scans of new uploads/,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Pause queue' }));
      await enterStepUpCode();
      await waitFor(() => expect(posted('/system/queues/documents/pause')).toHaveLength(2));
      expect(posted('/system/step-up')).toHaveLength(1);
    },
  );

  it('switches the job state it lists', async () => {
    renderAt('/system/queues');
    const select = await screen.findByLabelText('Jobs', {}, FIRST_LOAD);
    fireEvent.change(select, { target: { value: 'completed' } });
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/system/queues/documents/jobs?state=completed&page=0'),
      ).toBe(true),
    );
  });
});

describe('/system/security-center', () => {
  it('shows failed sign-ins, holds, rate limits and quarantine, hiding private titles', async () => {
    renderAt('/system/security-center');
    expect(
      await screen.findByRole('heading', { name: 'Security center', level: 1 }, FIRST_LOAD),
    ).toBeVisible();
    expect(await screen.findByRole('link', { name: 'jpice@nwssu.test' })).toHaveAttribute(
      'href',
      '/system/users/0195f3c0-0000-7000-8000-0000000000b1',
    );
    expect(screen.getByText('ghost@nwssu.test')).toBeVisible();
    expect(screen.getByText(/No such account/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'PSME · psme@nwssu.test' })).toBeVisible();
    // Once by limit, once among the limits the busiest IP hit.
    expect(screen.getAllByText('Sign-in, per IP')).toHaveLength(2);
    expect(screen.getByText(/Private file \(title hidden\)/)).toBeVisible();
    expect(screen.getByText(/Eicar-Test-Signature/)).toBeVisible();
    expect(screen.getByText('No lockouts in this period.')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '7d' } });
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/system/security-center?range=7d')).toBe(true),
    );
  });
});

describe('/system/tools', () => {
  it('flushes a cache namespace after a confirmation and a code', async () => {
    renderAt('/system/tools');
    expect(
      await screen.findByRole('heading', { name: 'Tools', level: 1 }, FIRST_LOAD),
    ).toBeVisible();
    expect(await screen.findByText(/80 keys in Redis in all/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Flush Colleges' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Flush Organizations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Flush cache' }));
    await enterStepUpCode();
    await waitFor(() => expect(posted('/system/cache/flush')).toHaveLength(2));
    expect(posted('/system/cache/flush')[1]!.body).toEqual({ namespace: 'organizations' });
  });

  it('sends a test email to the own address, checks a typed one, and shows a refusal', async () => {
    renderAt('/system/tools');
    const send = await screen.findByRole('button', { name: 'Send test email' }, FIRST_LOAD);
    fireEvent.click(send);
    expect(await screen.findByText(/Sent to dev@orghive.test/)).toBeVisible();
    expect(posted('/system/email-test')[0]!.body).toEqual({});

    fireEvent.change(screen.getByLabelText('Send to'), { target: { value: 'not-an-email' } });
    fireEvent.click(send);
    expect(await screen.findByText(/Enter an email address/)).toBeVisible();
    expect(posted('/system/email-test')).toHaveLength(1);

    emailAnswer = () =>
      json({
        to: 'it@nwssu.test',
        delivered: false,
        error: '550 relay denied',
        durationMs: 80,
        sentAt: NOW,
      });
    fireEvent.change(screen.getByLabelText('Send to'), { target: { value: 'it@nwssu.test' } });
    fireEvent.click(send);
    expect(await screen.findByRole('alert')).toHaveTextContent('550 relay denied');
    expect(posted('/system/email-test')[1]!.body).toEqual({ to: 'it@nwssu.test' });
  });
});

describe('/system/audit', () => {
  it('filters by organization, actor and dates, and exports with the same filters', async () => {
    const createObjectURL = vi.fn(() => 'blob:audit');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    renderAt('/system/audit');
    const organization = await screen.findByLabelText('Organization', {}, FIRST_LOAD);
    await screen.findByRole('option', { name: 'JPICE (CEA)' });
    fireEvent.change(organization, { target: { value: 'jpice' } });
    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'dev' } });
    fireEvent.change(screen.getByLabelText('From (Manila date)'), {
      target: { value: '2026-11-01' },
    });
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path.startsWith('/system/audit-logs?') &&
            c.path.includes('organization=jpice') &&
            c.path.includes('actor=dev') &&
            c.path.includes('from=2026-10-31T16%3A00%3A00.000Z'),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const exported = calls.find((c) => c.path.startsWith('/system/audit-logs/export'));
    expect(exported?.path).toContain('organization=jpice');
    expect(await screen.findByText(/Only the newest 10,000 matching events/)).toBeVisible();

    fireEvent.change(screen.getByLabelText('To (Manila date)'), {
      target: { value: '2026-10-01' },
    });
    expect(await screen.findByText(/start date is after the end date\. Change one/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('turns Manila days into UTC bounds and lists organizations by college', () => {
    expect(manilaDayBound('2026-11-12', false)).toBe('2026-11-11T16:00:00.000Z');
    expect(manilaDayBound('2026-11-12', true)).toBe('2026-11-12T15:59:59.999Z');
    expect(manilaDayBound('', false)).toBeUndefined();
    expect(organizationOptions(TREE)).toEqual([
      { value: 'issc', label: 'ISSC' },
      { value: 'csc-cea', label: 'CSC-CEA (CEA)' },
      { value: 'jpice', label: 'JPICE (CEA)' },
    ]);
  });
});
