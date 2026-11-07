import { fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MotionModule from '@/components/motion';
import type { PostCardModel } from '../presenters/post-format';
import { HighlightCarousel } from './highlight-carousel';

// jsdom has no layout, so Embla cannot measure; a fake API drives selection instead.
const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const state = { index: 0, count: 0 };
  const emit = (event: string) => listeners.get(event)?.forEach((fn) => fn());
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
    canScrollPrev: () => state.index > 0,
    canScrollNext: () => state.index < state.count - 1,
    scrollTo: vi.fn((i: number, _jump?: boolean) => {
      state.index = i;
      emit('select');
    }),
  };
  return { api, state, listeners };
});

vi.mock('embla-carousel-react', () => ({ default: () => [() => {}, fake.api] }));

const motionPrefs = vi.hoisted(() => ({ reduced: false }));
vi.mock('@/components/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof MotionModule>()),
  usePrefersReducedMotion: () => motionPrefs.reduced,
}));

const card = (n: number, cover = true): PostCardModel => ({
  id: `id-${n}`,
  href: `/orgs/asit/updates/post-${n}`,
  type: 'HIGHLIGHT',
  title: `Highlight title ${n}`,
  summary: `Summary ${n}`,
  date: 'Nov 5, 2026',
  dateTime: '2026-11-05',
  cover: cover ? { url: `https://cdn.test/${n}.webp`, srcSet: null, alt: `Photo ${n}` } : null,
});

function renderCarousel(highlights: PostCardModel[]) {
  fake.state.index = 0;
  fake.state.count = highlights.length;
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <HighlightCarousel
            highlights={highlights}
            org={{ acronym: 'ASIT', name: 'Allied Students of Information Technology' }}
            seeAllHref="/orgs/asit/updates?type=highlight"
          />
        ),
      },
    ],
    { initialEntries: ['/orgs/asit'] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  fake.api.scrollTo.mockClear();
  motionPrefs.reduced = false;
});

describe('HighlightCarousel', () => {
  it('is a labelled carousel of labelled slides with a link to every highlight', () => {
    renderCarousel([card(1), card(2), card(3)]);
    const carousel = screen.getByRole('region', { name: 'ASIT highlights' });
    expect(carousel).toHaveAttribute('aria-roledescription', 'carousel');
    const slides = within(carousel).getAllByRole('group', { name: /^Highlight \d of 3$/ });
    expect(slides).toHaveLength(3);
    expect(slides[1]).toHaveAttribute('aria-roledescription', 'slide');
    expect(within(slides[0]!).getByRole('link', { name: /Read full highlight/ })).toHaveAttribute(
      'href',
      '/orgs/asit/updates/post-1',
    );
    expect(screen.getByRole('link', { name: 'See all highlights' })).toHaveAttribute(
      'href',
      '/orgs/asit/updates?type=highlight',
    );
    expect(screen.getByRole('img', { name: 'Photo 1' })).toBeInTheDocument();
  });

  it('moves with the arrows, the dots and the keyboard', () => {
    renderCarousel([card(1), card(2), card(3)]);
    const prev = screen.getByRole('button', { name: 'Previous highlight' });
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Next highlight' }));
    expect(fake.api.scrollTo).toHaveBeenLastCalledWith(1, false);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(prev).not.toHaveAttribute('aria-disabled');

    fireEvent.click(screen.getByRole('button', { name: /Highlight 3 of 3/ }));
    expect(screen.getByRole('button', { name: /Highlight 3 of 3/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Next highlight' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    const region = screen.getByRole('region', { name: 'ASIT highlights' });
    fireEvent.keyDown(region, { key: 'Home' });
    expect(fake.api.scrollTo).toHaveBeenLastCalledWith(0, false);
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(fake.api.scrollTo).toHaveBeenLastCalledWith(1, false);
    fireEvent.keyDown(region, { key: 'End' });
    expect(fake.api.scrollTo).toHaveBeenLastCalledWith(2, false);
    expect(screen.getByText('Highlight 3 of 3: Highlight title 3')).toBeInTheDocument();
  });

  it('jumps instead of gliding with reduced motion', () => {
    motionPrefs.reduced = true;
    renderCarousel([card(1), card(2)]);
    fireEvent.click(screen.getByRole('button', { name: 'Next highlight' }));
    expect(fake.api.scrollTo).toHaveBeenLastCalledWith(1, true);
  });

  it('shows the logo for a highlight without a cover, and no controls for one highlight', () => {
    renderCarousel([card(1, false)]);
    expect(screen.queryByRole('button', { name: 'Next highlight' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Photo 1' })).toBeNull();
    expect(screen.getByText('ASIT')).toBeInTheDocument();
  });
});
