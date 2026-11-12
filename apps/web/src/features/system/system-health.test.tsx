import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_REQUEST_HEADER,
  type AuthResponse,
  type SystemAlerts,
  type SystemHealth,
  type SystemMetrics,
} from '@orghive/shared';
import { routes } from '@/app/router';
import { authStore } from '@/lib/auth-store';
import {
  formatBytes,
  formatDuration,
  formatFact,
  formatMs,
  formatPercent,
} from './presenters/health-format';
import { toHealthView } from './presenters/use-system-health';
import { toMetricsView } from './presenters/use-system-metrics';

/** The console's lazy route (with Recharts) loads on the first render: allow it the time. */
const FIRST_LOAD = { timeout: 10_000 };

const NOW = '2026-10-19T08:00:00.000Z';

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

const HEALTH: SystemHealth = {
  status: 'down',
  generatedAt: NOW,
  checks: [
    {
      id: 'postgres',
      status: 'ok',
      summary: 'Answering queries.',
      checkedAt: NOW,
      facts: [
        { label: 'Latency', value: 3, unit: 'ms' },
        { label: 'Database size', value: 48 * 1024 * 1024, unit: 'bytes' },
      ],
    },
    {
      id: 'worker',
      status: 'warn',
      summary: 'Some jobs failed.',
      checkedAt: NOW,
      facts: [{ label: 'Oldest waiting since', value: null, unit: 'datetime' }],
    },
    {
      id: 'disk',
      status: 'down',
      summary: 'The disk is almost full. Free space now.',
      checkedAt: NOW,
      facts: [{ label: 'Used', value: 0.91, unit: 'percent' }],
    },
  ],
  storageByOrganization: [
    { slug: 'jpice', acronym: 'JPICE', name: 'JPICE', bytes: 2 * 1024 * 1024, files: 12 },
    { slug: 'issc', acronym: 'ISSC', name: 'ISSC', bytes: 1024 * 1024, files: 3 },
  ],
};

function metrics(range: SystemMetrics['range'] = '1h'): SystemMetrics {
  return {
    range,
    bucketMinutes: range === '1h' ? 1 : range === '24h' ? 5 : 60,
    points: [
      {
        at: '2026-10-19T07:58:00.000Z',
        requestsPerMinute: 40,
        p95Ms: 200,
        errorRate: 0,
        clientErrorRate: 0.02,
        queueWaiting: 1,
        storageBytes: 1024,
      },
      {
        at: '2026-10-19T07:59:00.000Z',
        requestsPerMinute: 0,
        p95Ms: null,
        errorRate: null,
        clientErrorRate: null,
        queueWaiting: null,
        storageBytes: null,
      },
    ],
    activeUsers: [{ day: '2026-10-19', users: 4 }],
    slowestEndpoints: [
      { route: 'GET /api/v1/search', requests: 400, avgMs: 140, p95Ms: 1_400, maxMs: 2_100 },
    ],
    slowQueries: [
      { at: NOW, route: 'GET /api/v1/search', durationMs: 812, query: 'SELECT "documents"' },
    ],
    totals: { requests: 2_400, errorRate: 0.08, p95Ms: 200 },
    generatedAt: NOW,
  };
}

const ALERTS: SystemAlerts = {
  alerts: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000a1',
      kind: 'disk_full',
      message: 'The disk is 91% full.',
      openedAt: NOW,
    },
  ],
};

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
  );

/** The requests made, with whether each was sent as a background read. */
const calls: { path: string; background: boolean }[] = [];

function serve() {
  fetchMock.mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url, 'http://x');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const headers = new Headers(init?.headers);
    calls.push({
      path: `${path}${url.search}`,
      background: headers.get(BACKGROUND_REQUEST_HEADER) === '1',
    });
    if (path === '/auth/refresh') return json(SESSION);
    if (path === '/system/health') return json(HEALTH);
    if (path === '/system/metrics') {
      return json(metrics((url.searchParams.get('range') ?? '1h') as SystemMetrics['range']));
    }
    if (path === '/system/alerts') return json(ALERTS);
    if (path === '/system/account-requests/count') return json({ open: 0 });
    if (path === '/system/demo-data') return json({ total: 0, counts: {} });
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

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  serve();
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  authStore.reset();
});

describe('health formatting', () => {
  it('reads sizes, shares, durations and unknown values in words', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(48 * 1024 * 1024)).toBe('48 MB');
    expect(formatPercent(0.052)).toBe('5.2%');
    expect(formatPercent(0.91)).toBe('91%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatMs(850)).toBe('850 ms');
    expect(formatMs(2_400)).toBe('2.4 s');
    expect(formatDuration(30)).toBe('30 s');
    expect(formatDuration(90)).toBe('1 min');
    expect(formatDuration(7_500)).toBe('2 h 5 min');
    expect(formatDuration(200_000)).toBe('2 d 7 h');
    expect(formatFact({ label: 'x', value: null, unit: 'datetime' })).toBe('Not known');
    expect(formatFact({ label: 'x', value: 'ClamAV 1.4.6', unit: 'text' })).toBe('ClamAV 1.4.6');
    expect(formatFact({ label: 'x', value: 1_234, unit: 'count' })).toBe('1,234');
  });

  it('shapes the health page: headline, cards and storage bars', () => {
    const view = toHealthView(HEALTH);
    expect(view.headline).toBe('Something is down. 2 of 3 checks need attention.');
    expect(view.cards.map((c) => [c.name, c.statusLabel])).toEqual([
      ['PostgreSQL', 'Healthy'],
      ['Background worker', 'Needs a look'],
      ['Disk space', 'Down'],
    ]);
    expect(view.cards[0]!.facts).toEqual([
      { label: 'Latency', value: '3 ms' },
      { label: 'Database size', value: '48 MB' },
    ]);
    expect(view.storage.map((s) => [s.acronym, s.size, s.share])).toEqual([
      ['JPICE', '2.0 MB', 1],
      ['ISSC', '1.0 MB', 0.5],
    ]);
  });

  it('shapes the metrics page: tiles flag what is over the alert lines', () => {
    const view = toMetricsView(metrics());
    expect(view.tiles.map((t) => [t.label, t.value, t.attention])).toEqual([
      ['Requests', '2,400', false],
      ['Server errors', '8.0%', true],
      ['p95 response time', '200 ms', false],
    ]);
    expect(view.charts.map((c) => c.id)).toEqual([
      'requests',
      'p95',
      'errors',
      'queue',
      'storage',
      'users',
    ]);
    // The newest point has no data: "latest" is the last one that has.
    expect(view.charts.find((c) => c.id === 'p95')?.latest).toBe('200 ms');
    expect(view.charts.find((c) => c.id === 'p95')?.points.at(-1)?.value).toBeNull();
    expect(view.endpoints[0]).toMatchObject({ p95: '1.4 s', slow: true });
    expect(view.hasTraffic).toBe(true);
  });
});

describe('/system/health', () => {
  it(
    'shows every check with its status in words, and storage per organization',
    { timeout: 20_000 },
    async () => {
      renderAt('/system/health');
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Health' }, FIRST_LOAD),
      ).toBeInTheDocument();
      expect(await screen.findByText(/Something is down/)).toBeInTheDocument();

      const disk = screen.getByRole('heading', { name: 'Disk space' }).closest('li')!;
      expect(within(disk).getByText('Down')).toBeInTheDocument();
      expect(within(disk).getByText('91%')).toBeInTheDocument();
      const worker = screen.getByRole('heading', { name: 'Background worker' }).closest('li')!;
      expect(within(worker).getByText('Not known')).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /JPICE 2.0 MB 12/ })).toBeInTheDocument();
    },
  );

  it('reads the first time as a page view, and "Check now" in the background', async () => {
    renderAt('/system/health');
    await screen.findByText(/Something is down/);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/system/health')).toHaveLength(2));
    expect(calls.filter((c) => c.path === '/system/health').map((c) => c.background)).toEqual([
      false,
      true,
    ]);
    // The banner's poll is always a background read.
    expect(calls.find((c) => c.path === '/system/alerts')?.background).toBe(true);
  });

  it('shows open alerts above every console page, linking to health', async () => {
    renderAt('/system/metrics');
    const banner = await screen.findByRole('region', { name: 'An alert is open' });
    expect(within(banner).getByText(/The disk is 91% full\./)).toBeInTheDocument();
    expect(within(banner).getByRole('link', { name: 'See system health' })).toHaveAttribute(
      'href',
      '/system/health',
    );
  });
});

describe('/system/metrics', () => {
  it('shows the totals, the slow lists, and switches range in the address', async () => {
    const router = renderAt('/system/metrics');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Metrics' }, FIRST_LOAD),
    ).toBeInTheDocument();
    expect(await screen.findByText('2,400')).toBeInTheDocument();
    expect(
      screen.getByRole('row', { name: /GET \/api\/v1\/search 400 140 ms 1.4 s 2.1 s/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('SELECT "documents"')).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: /Requests per minute/ })).toBeInTheDocument();

    const hour = screen.getByRole('button', { name: 'Last hour' });
    expect(hour).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(router.state.location.search).toBe('?range=7d'));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/system/metrics?range=7d')).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('the console sidebar', () => {
  it('groups the sections, with Health, Metrics, Queues and Security center under Monitor', async () => {
    renderAt('/system/health');
    const nav = await screen.findByRole('navigation', { name: 'System console' });
    const monitor = within(nav).getByRole('list', { name: 'Monitor' });
    expect(
      within(monitor)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Overview', 'Health', 'Metrics', 'Queues', 'Security center']);
    expect(within(monitor).getByRole('link', { name: 'Health' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('list', { name: 'Accounts' })).toBeInTheDocument();
    const system = within(nav).getByRole('list', { name: 'System' });
    expect(within(system).getByRole('link', { name: 'Tools' })).toHaveAttribute(
      'href',
      '/system/tools',
    );
    expect(within(nav).getByText(/Every action here is audited/)).toBeInTheDocument();
  });
});
