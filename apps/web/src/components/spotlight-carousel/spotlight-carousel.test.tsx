import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MotionModule from '../motion';
import { SpotlightCarousel, type SpotlightItem } from './spotlight-carousel';
import type * as TweenModule from './use-spotlight-tween';

// jsdom has no layout, so Embla cannot measure slides. A small fake API stands in for it
// and lets these tests drive selection the way Embla would.
const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const state = { index: 0, count: 0, loop: true };
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
    canScrollPrev: () => state.loop || state.index > 0,
    canScrollNext: () => state.loop || state.index < state.count - 1,
    scrollNext: vi.fn(() => {
      state.index = (state.index + 1) % state.count;
      emit('select');
    }),
    scrollPrev: vi.fn(() => {
      state.index = (state.index - 1 + state.count) % state.count;
      emit('select');
    }),
    scrollTo: vi.fn((i: number) => {
      state.index = i;
      emit('select');
    }),
  };
  return { api, state, listeners };
});

vi.mock('embla-carousel-react', () => ({
  default: (options: { startIndex?: number; loop?: boolean }) => {
    fake.state.index = options.startIndex ?? 0;
    fake.state.loop = options.loop ?? false;
    return [() => {}, fake.api];
  },
}));

vi.mock('./use-spotlight-tween', async (importOriginal) => ({
  ...(await importOriginal<typeof TweenModule>()),
  useSpotlightTween: () => {},
}));

const motionPrefs = vi.hoisted(() => ({ reduced: false }));
vi.mock('../motion', async (importOriginal) => ({
  ...(await importOriginal<typeof MotionModule>()),
  usePrefersReducedMotion: () => motionPrefs.reduced,
}));

const items: SpotlightItem[] = [
  {
    id: 'cea',
    name: 'College of Engineering and Architecture',
    motto: 'Designing Structures.',
    href: '/colleges/cea',
  },
  {
    id: 'cat',
    name: 'College of Agriculture and Technology',
    motto: 'Growing Innovation.',
    href: '/colleges/cat',
  },
  { id: 'con', name: 'College of Nursing', href: '/colleges/con' },
];

function renderCarousel(props: Partial<Parameters<typeof SpotlightCarousel>[0]> = {}) {
  fake.state.count = (props.items ?? items).length;
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <SpotlightCarousel
            label="Collegiate Student Councils"
            itemNoun="college"
            items={items}
            {...props}
          />
        ),
      },
      { path: '/colleges/:id', element: <p>College page</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function currentSlide() {
  return screen.getAllByRole('group').find((el) => el.getAttribute('aria-current') === 'true');
}

beforeEach(() => {
  motionPrefs.reduced = false;
  fake.listeners.clear();
  vi.clearAllMocks();
});

describe('SpotlightCarousel', () => {
  it('labels the carousel and each slide', () => {
    renderCarousel();
    expect(screen.getByRole('region', { name: 'Collegiate Student Councils' })).toHaveAttribute(
      'aria-roledescription',
      'carousel',
    );
    expect(
      screen.getByRole('group', { name: '2 of 3: College of Agriculture and Technology' }),
    ).toHaveAttribute('aria-roledescription', 'slide');
    expect(currentSlide()).toHaveAccessibleName('1 of 3: College of Engineering and Architecture');
  });

  it('exposes only the centered slide’s details and Proceed link', () => {
    renderCarousel();
    const links = screen.getAllByRole('link', { name: /Proceed/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/colleges/cea');
    expect(
      screen.getByRole('heading', { name: 'College of Engineering and Architecture' }),
    ).toBeInTheDocument();
  });

  it('moves with the arrow keys and announces the new slide', () => {
    renderCarousel();
    const carousel = screen.getByRole('region', { name: 'Collegiate Student Councils' });

    act(() => void fireEvent.keyDown(carousel, { key: 'ArrowRight' }));
    expect(currentSlide()).toHaveAccessibleName('2 of 3: College of Agriculture and Technology');
    expect(screen.getByText('College of Agriculture and Technology, 2 of 3')).toBeInTheDocument();

    act(() => void fireEvent.keyDown(carousel, { key: 'ArrowLeft' }));
    act(() => void fireEvent.keyDown(carousel, { key: 'ArrowLeft' }));
    expect(currentSlide()).toHaveAccessibleName('3 of 3: College of Nursing');
  });

  it('jumps to the first and last slide with Home and End', () => {
    renderCarousel();
    const carousel = screen.getByRole('region', { name: 'Collegiate Student Councils' });
    act(() => void fireEvent.keyDown(carousel, { key: 'End' }));
    expect(currentSlide()).toHaveAccessibleName('3 of 3: College of Nursing');
    act(() => void fireEvent.keyDown(carousel, { key: 'Home' }));
    expect(currentSlide()).toHaveAccessibleName('1 of 3: College of Engineering and Architecture');
  });

  it('does not announce anything until the user moves the carousel', () => {
    renderCarousel();
    expect(screen.queryByText(/, 1 of 3$/)).not.toBeInTheDocument();
  });

  it('puts the controls before the slides in tab order', () => {
    renderCarousel();
    const prev = screen.getByRole('button', { name: 'Previous college' });
    const slides = screen.getByRole('group', { name: 'Slides' });
    expect(prev.compareDocumentPosition(slides) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders one item as a still spotlight without controls', () => {
    renderCarousel({ items: [items[0]!] });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Proceed/ })).toBeInTheDocument();
  });

  it('disables the arrow at each end when two items do not loop', () => {
    renderCarousel({ items: items.slice(0, 2) });
    expect(screen.getByRole('button', { name: 'Previous college' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Next college' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('shows loading and error states', () => {
    renderCarousel({ items: [], isLoading: true });
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('shows the error state instead of slides', () => {
    renderCarousel({ error: <p>Couldn't load the councils.</p> });
    expect(screen.getByText("Couldn't load the councils.")).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('moves with the previous and next buttons', () => {
    renderCarousel();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Next college' })));
    expect(fake.api.scrollNext).toHaveBeenCalledWith(false);
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Previous college' })));
    expect(fake.api.scrollPrev).toHaveBeenCalledWith(false);
  });

  it('jumps instead of animating when the user prefers reduced motion', () => {
    motionPrefs.reduced = true;
    renderCarousel();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Next college' })));
    expect(fake.api.scrollNext).toHaveBeenCalledWith(true);
  });

  it('brings a side slide to the center when clicked', () => {
    renderCarousel();
    act(
      () => void fireEvent.click(screen.getByRole('group', { name: '3 of 3: College of Nursing' })),
    );
    expect(fake.api.scrollTo).toHaveBeenCalledWith(2, false);
    expect(currentSlide()).toHaveAccessibleName('3 of 3: College of Nursing');
  });

  it('proceeds when the centered slide is clicked', async () => {
    const router = renderCarousel();
    act(() => void fireEvent.click(within(currentSlide()!).getByRole('heading')));
    expect(await screen.findByText('College page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/colleges/cea');
  });

  it('shows the empty state when there are no items', () => {
    renderCarousel({ items: [], emptyState: <p>No colleges yet.</p> });
    expect(screen.getByText('No colleges yet.')).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});

describe('SpotlightCarousel dots (below lg)', () => {
  it('shows one labelled dot per slide and marks the current one', () => {
    renderCarousel({ initialIndex: 1 });
    const dot = screen.getByRole('button', {
      name: 'College 2 of 3: College of Agriculture and Technology',
    });
    expect(dot).toHaveAttribute('aria-current', 'true');
    expect(
      screen.getByRole('button', {
        name: 'College 1 of 3: College of Engineering and Architecture',
      }),
    ).not.toHaveAttribute('aria-current');
  });

  it('jumps to a slide when its dot is pressed', () => {
    renderCarousel();
    act(
      () =>
        void fireEvent.click(
          screen.getByRole('button', { name: 'College 3 of 3: College of Nursing' }),
        ),
    );
    expect(fake.api.scrollTo).toHaveBeenCalledWith(2, false);
    expect(currentSlide()).toHaveAccessibleName('3 of 3: College of Nursing');
  });

  it('switches to a counter instead of dots for long lists', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `o${i}`,
      name: `Org ${i + 1}`,
      href: `/colleges/o${i}`,
    }));
    renderCarousel({ items: many });
    expect(screen.queryByRole('button', { name: /^College 1 of 12/ })).not.toBeInTheDocument();
    expect(screen.getByText('1 / 12')).toBeInTheDocument();
  });

  it('has no dots for a single item', () => {
    renderCarousel({ items: [items[0]!] });
    expect(screen.queryByRole('button', { name: /of 1:/ })).not.toBeInTheDocument();
  });
});
