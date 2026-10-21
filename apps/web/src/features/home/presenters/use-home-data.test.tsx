import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollegeSummary, OrganizationDetail } from '@orghive/shared';
import { toHoneycomb, useHomeData } from './use-home-data';

const fetchMock = vi.fn<typeof fetch>();

function college(code: string, logoUrl: string | null = null): CollegeSummary {
  const slug = code.toLowerCase();
  return {
    code,
    slug,
    name: `College ${code}`,
    motto: null,
    csc: {
      type: 'CSC',
      slug: `csc-${slug}`,
      acronym: `CSC-${code}`,
      name: `CSC of ${code}`,
      logoUrl,
      logoSrcSet: null,
    },
  };
}

const SEVEN = ['CAT', 'CCIS', 'CCJS', 'CoED', 'CEA', 'COM', 'CON'].map((code) => college(code));

const ISSC: OrganizationDetail = {
  id: '0195f3c0-0000-7000-8000-0000000000b1',
  type: 'ISSC',
  slug: 'issc',
  acronym: 'ISSC',
  name: 'Institutional Supreme Student Council',
  description: 'The highest student governing body.',
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('toHoneycomb', () => {
  it('places seven colleges in the honeycomb, in API order, with fillers around them', () => {
    const cells = toHoneycomb(SEVEN);
    expect(cells).toHaveLength(12);
    expect(cells.map((cell) => cell?.shortName ?? null)).toEqual(
      // prettier-ignore
      [
        null,   'CAT',  null,  null,
        'CCIS', 'CCJS', 'CoED', null,
        'CEA',  'COM',  'CON',  null,
      ],
    );
  });

  it('maps a college to a linked cell that uses its CSC logo', () => {
    const [, cell] = toHoneycomb([college('CEA', 'https://cdn.test/logos/csc-cea.png')]);
    expect(cell).toEqual({
      id: 'cea',
      label: 'College CEA',
      logoSrc: 'https://cdn.test/logos/csc-cea.png',
      shortName: 'CEA',
      href: '/colleges/cea',
    });
  });

  it('turns unused college slots into fillers', () => {
    const cells = toHoneycomb(SEVEN.slice(0, 2));
    expect(cells.filter(Boolean)).toHaveLength(2);
    expect(cells).toHaveLength(12);
  });

  it('appends colleges beyond the pattern so none is dropped', () => {
    const cells = toHoneycomb([...SEVEN, college('NEW')]);
    expect(cells.at(-1)?.shortName).toBe('NEW');
    expect(cells.filter(Boolean)).toHaveLength(8);
  });

  it('returns no cells when there are no colleges', () => {
    expect(toHoneycomb([])).toEqual([]);
  });
});

describe('useHomeData', () => {
  it('loads colleges and the ISSC in parallel', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(urlOf(input).endsWith('/colleges') ? json({ colleges: SEVEN }) : json(ISSC)),
    );

    const { result } = renderHook(() => useHomeData(), { wrapper });
    expect(result.current.colleges.isLoading).toBe(true);
    expect(result.current.issc.isLoading).toBe(true);

    await waitFor(() => expect(result.current.issc.data).toEqual(ISSC));
    await waitFor(() => expect(result.current.colleges.data).toHaveLength(12));
    expect(fetchMock.mock.calls.map(([url]) => urlOf(url)).sort()).toEqual([
      '/api/v1/colleges',
      '/api/v1/organizations/issc',
    ]);
  });

  it('reports each section error separately and retries on demand', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        urlOf(input).endsWith('/colleges')
          ? json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, 500)
          : json(ISSC),
      ),
    );

    const { result } = renderHook(() => useHomeData(), { wrapper });
    await waitFor(() => expect(result.current.colleges.isError).toBe(true));
    expect(result.current.issc.isError).toBe(false);

    fetchMock.mockImplementation(() => Promise.resolve(json({ colleges: SEVEN })));
    result.current.colleges.retry();
    await waitFor(() => expect(result.current.colleges.isError).toBe(false));
    expect(result.current.colleges.data).toHaveLength(12);
  });
});
