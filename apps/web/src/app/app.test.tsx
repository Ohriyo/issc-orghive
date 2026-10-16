import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from './query-client';
import { routes } from './router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// jsdom has no WebGL, so keep the hero on its static background.
vi.mock('@/features/home/hooks/use-animated-hero', () => ({ useAnimatedHero: () => false }));

afterEach(cleanup);

describe('app shell', () => {
  it('renders the home route', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Organizing Unity, Archiving Transparency',
      }),
    ).toBeTruthy();
  });

  it('shows the not-found page for unknown routes', async () => {
    renderAt('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });
});
