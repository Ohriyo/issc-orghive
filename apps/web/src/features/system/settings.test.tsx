import type { ReactNode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSystemSettings, type SystemSettingsModel } from './presenters/use-system-settings';
import { SettingsView } from './views/settings-view';

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

describe('useSystemSettings', () => {
  it('starts from the default, checks the value and saves it', async () => {
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        json(
          init?.method === 'PATCH'
            ? { leaderboardLatePoints: 0.25, updatedAt: '2026-10-20T07:04:00.000Z' }
            : { leaderboardLatePoints: 0.5, updatedAt: null },
        ),
      ),
    );
    const { result } = renderHook(() => useSystemSettings(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const ready = () => result.current as Extract<SystemSettingsModel, { status: 'ready' }>;
    expect(ready()).toMatchObject({
      latePoints: '0.5',
      lastChange: 'The default (0.5)',
      dirty: false,
    });

    act(() => ready().setLatePoints('1.5'));
    expect(ready().dirty).toBe(false);
    act(() => ready().save());
    expect(ready().error).toBe('Use a number from 0 to 1');

    act(() => ready().setLatePoints('0.25'));
    expect(ready()).toMatchObject({ dirty: true, preview: '0.25 pts', error: null });
    act(() => ready().save());
    await waitFor(() => expect(ready().saved).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ leaderboardLatePoints: 0.25 });
    expect(ready().latePoints).toBe('0.25');
    expect(ready().lastChange).toMatch(/^Changed /);
  });

  it('shows why a save failed', async () => {
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        init?.method === 'PATCH'
          ? json({ error: { code: 'VALIDATION_ERROR', message: 'Use at most two decimals' } }, 400)
          : json({ leaderboardLatePoints: 0.5, updatedAt: null }),
      ),
    );
    const { result } = renderHook(() => useSystemSettings(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const ready = () => result.current as Extract<SystemSettingsModel, { status: 'ready' }>;
    act(() => ready().setLatePoints('0.3'));
    act(() => ready().save());
    await waitFor(() => expect(ready().error).toBe('Use at most two decimals'));
  });
});

describe('SettingsView', () => {
  const ready: SystemSettingsModel = {
    status: 'ready',
    latePoints: '0.5',
    setLatePoints: vi.fn(),
    lastChange: 'The default (0.5)',
    preview: '0.5 pts',
    error: null,
    saving: false,
    saved: false,
    dirty: false,
    save: vi.fn(),
  };

  it('edits the late value, saving only a change', () => {
    const { rerender } = render(<SettingsView model={ready} />);
    const field = screen.getByLabelText('Points for a late project (0 to 1)');
    fireEvent.change(field, { target: { value: '0.25' } });
    expect(ready.setLatePoints).toHaveBeenCalledWith('0.25');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    rerender(<SettingsView model={{ ...ready, dirty: true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(ready.save).toHaveBeenCalled();
    rerender(<SettingsView model={{ ...ready, saved: true }} />);
    expect(screen.getByText('Saved. The leaderboards are being recomputed.')).toBeInTheDocument();
  });

  it('has loading and error states', () => {
    const retry = vi.fn();
    const { rerender } = render(<SettingsView model={{ status: 'loading' }} />);
    expect(screen.getByText('Loading the settings')).toBeInTheDocument();
    rerender(<SettingsView model={{ status: 'error', retry }} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });
});
