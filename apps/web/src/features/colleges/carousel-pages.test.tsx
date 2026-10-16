import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollegeDetail, CollegeListResponse } from '@orghive/shared';
import { routes } from '@/app/router';
import type * as TweenModule from '@/components/spotlight-carousel/use-spotlight-tween';

// jsdom has no layout, so Embla cannot measure slides; this fake API stands in for it.
const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const state = { index: 0, count: 0, startIndex: -1 };
  const emit = (event: string) => listeners.get(event)?.forEach((fn) => fn());
  const move = (index: number) => {
    state.index = ((index % state.count) + state.count) % state.count;
    emit('select');
  };
  const api = {
    on(event: string, fn: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return api;
    },
    off(event: string, fn: () => void) {
      listeners.get(event)?.delete(fn);
      return api;
    },
    selectedScrollSnap: () => state.index,
    canScrollPrev: () => true,
    canScrollNext: () => true,
    scrollNext: () => move(state.index + 1),
    scrollPrev: () => move(state.index - 1),
    scrollTo: (i: number) => move(i),
  };
  return { api, state, listeners };
});

vi.mock('embla-carousel-react', () => ({
  default: (options: { startIndex?: number }) => {
    // Like Embla, re-initialize at startIndex only when that option changes.
    const startIndex = options.startIndex ?? 0;
    if (startIndex !== fake.state.startIndex) {
      fake.state.index = startIndex;
      fake.state.startIndex = startIndex;
    }
    return [() => {}, fake.api];
  },
}));

vi.mock('@/components/spotlight-carousel/use-spotlight-tween', async (importOriginal) => ({
  ...(await importOriginal<typeof TweenModule>()),
  useSpotlightTween: () => {},
}));

const COLLEGES: CollegeListResponse = {
  colleges: ['CAT', 'CCIS', 'CEA'].map((code) => ({
    code,
    slug: code.toLowerCase(),
    name: `College ${code}`,
    motto: `${code} motto`,
    csc: null,
  })),
};

const CEA: CollegeDetail = {
  code: 'CEA',
  slug: 'cea',
  name: 'College of Engineering and Architecture',
  motto: null,
  description: null,
  csc: null,
  sbos: ['JPICE', 'PSME'].map((acronym) => ({
    type: 'SBO',
    slug: acronym.toLowerCase(),
    acronym,
    name: `${acronym} full name`,
    logoUrl: null,
    logoSrcSet: null,
  })),
};

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function renderAt(url: string, count: number) {
  fake.state.count = count;
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function centeredSlide() {
  return screen.getAllByRole('group').find((el) => el.getAttribute('aria-current') === 'true');
}

beforeEach(() => {
  fake.state.startIndex = -1;
  fake.listeners.clear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('/colleges', () => {
  beforeEach(() => fetchMock.mockImplementation(() => json(COLLEGES)));

  it('centers the college named by ?focus= and shows its name, motto and Proceed', async () => {
    renderAt('/colleges?focus=cea', 3);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Collegiate Student Councils' }),
    ).toBeInTheDocument();
    const slide = await vi.waitFor(() => {
      const found = centeredSlide();
      if (!found) throw new Error('no centered slide yet');
      return found;
    });
    expect(slide).toHaveAccessibleName('3 of 3: College CEA');
    expect(within(slide).getByText('“CEA motto”')).toBeInTheDocument();
    expect(within(slide).getByRole('link', { name: 'Proceed: College CEA' })).toHaveAttribute(
      'href',
      '/colleges/cea',
    );
  });

  it('keeps ?focus= in step with the arrow keys', async () => {
    const router = renderAt('/colleges?focus=cat', 3);
    const carousel = await screen.findByRole('region', { name: 'Collegiate Student Councils' });

    act(() => void fireEvent.keyDown(carousel, { key: 'ArrowRight' }));
    expect(router.state.location.search).toBe('?focus=ccis');
    expect(router.state.historyAction).toBe('REPLACE');

    act(() => void fireEvent.keyDown(carousel, { key: 'ArrowLeft' }));
    act(() => void fireEvent.keyDown(carousel, { key: 'ArrowLeft' }));
    expect(router.state.location.search).toBe('?focus=cea');
  });

  it('adds ?focus= for the first college when the URL has none', async () => {
    const router = renderAt('/colleges', 3);
    await screen.findByRole('region', { name: 'Collegiate Student Councils' });
    expect(router.state.location.search).toBe('?focus=cat');
  });

  it('explains a failed load and retries it', async () => {
    fetchMock.mockImplementationOnce(() =>
      json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, 500),
    );
    renderAt('/colleges', 3);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The colleges could not be loaded');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('region', { name: 'Collegiate Student Councils' }),
    ).toBeInTheDocument();
  });
});

describe('/colleges/:slug/organizations', () => {
  it('shows the college SBOs under its name, centered on ?focus=', async () => {
    fetchMock.mockImplementation(() => json(CEA));
    const router = renderAt('/colleges/cea/organizations?focus=psme', 2);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Student Body Organizations' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('College of Engineering and Architecture')).toBeInTheDocument();
    const carousel = screen.getByRole('region', {
      name: 'Student Body Organizations of the College of Engineering and Architecture',
    });
    expect(within(carousel).getByRole('link', { name: 'Proceed: PSME full name' })).toHaveAttribute(
      'href',
      '/orgs/psme',
    );
    expect(router.state.location.search).toBe('?focus=psme');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/colleges/cea', expect.anything());
  });

  it('says so when the college has no SBOs yet', async () => {
    fetchMock.mockImplementation(() => json({ ...CEA, sbos: [] }));
    renderAt('/colleges/cea/organizations', 0);
    expect(
      await screen.findByText(
        'No student body organizations have been added to the College of Engineering and Architecture yet.',
      ),
    ).toBeInTheDocument();
  });

  it('shows a not-found page for an unknown college', async () => {
    fetchMock.mockImplementation(() =>
      json({ error: { code: 'NOT_FOUND', message: 'College not found' } }, 404),
    );
    renderAt('/colleges/nope/organizations', 0);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'College not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all colleges' })).toHaveAttribute(
      'href',
      '/colleges',
    );
  });
});
