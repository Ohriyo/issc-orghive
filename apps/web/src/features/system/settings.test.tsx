import type { ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TASK_KEYWORDS, type SystemSettings } from '@orghive/shared';
import { useSystemSettings, type SystemSettingsModel } from './presenters/use-system-settings';
import { SettingsView } from './views/settings-view';

const fetchMock = vi.fn<typeof fetch>();

/** GET /system/settings with every default. */
const DEFAULTS: SystemSettings = {
  leaderboardLatePoints: 0.5,
  updatedAt: null,
  taskKeywords: DEFAULT_TASK_KEYWORDS,
  nearDuplicateBits: 6,
  checksUpdatedAt: null,
  finalAfterDays: 7,
  finalAfterDaysUpdatedAt: null,
  alertCooldownMinutes: 30,
  alertCooldownUpdatedAt: null,
};

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

describe('useSystemSettings: days until final', () => {
  it('starts from the default, refuses a bad number and saves a change', async () => {
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        json(
          init?.method === 'PATCH'
            ? {
                ...DEFAULTS,
                finalAfterDays: 14,
                finalAfterDaysUpdatedAt: '2026-10-20T07:04:00.000Z',
              }
            : DEFAULTS,
        ),
      ),
    );
    const { result } = renderHook(() => useSystemSettings(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const days = () =>
      (result.current as Extract<SystemSettingsModel, { status: 'ready' }>).finalAfterDays;
    expect(days()).toMatchObject({ value: '7', lastChange: 'The default (7 days)', dirty: false });

    act(() => days().onChange('61'));
    expect(days().dirty).toBe(false);
    act(() => days().save());
    expect(days().error).toBe('Use a whole number of days from 0 to 60');

    act(() => days().onChange('14'));
    expect(days()).toMatchObject({ dirty: true, error: null });
    act(() => days().save());
    await waitFor(() => expect(days().saved).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ finalAfterDays: 14 });
    expect(days().value).toBe('14');
    expect(days().lastChange).toMatch(/^Changed /);
  });
});

describe('useSystemSettings', () => {
  it('starts from the default, checks the value and saves it', async () => {
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        json(
          init?.method === 'PATCH'
            ? { ...DEFAULTS, leaderboardLatePoints: 0.25, updatedAt: '2026-10-20T07:04:00.000Z' }
            : DEFAULTS,
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
          : json(DEFAULTS),
      ),
    );
    const { result } = renderHook(() => useSystemSettings(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const ready = () => result.current as Extract<SystemSettingsModel, { status: 'ready' }>;
    act(() => ready().setLatePoints('0.3'));
    act(() => ready().save());
    await waitFor(() => expect(ready().error).toBe('Use at most two decimals'));
  });

  it('edits the check settings, refusing bad lines, and saves both together', async () => {
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        json(
          init?.method === 'PATCH'
            ? {
                ...DEFAULTS,
                ...(JSON.parse(init.body as string) as object),
                checksUpdatedAt: '2026-10-20T07:04:00.000Z',
              }
            : DEFAULTS,
        ),
      ),
    );
    const { result } = renderHook(() => useSystemSettings(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const checks = () =>
      (result.current as Extract<SystemSettingsModel, { status: 'ready' }>).checks;
    expect(checks()).toMatchObject({ lastChange: 'Using the defaults', dirty: false });
    const acr = () => checks().keywords.find((k) => k.type === 'ACR')!;
    expect(acr().value).toBe('Accomplishment Report|Activity Completion Report');

    act(() => acr().onChange('Accomplishment Report\nx'));
    expect(acr().error).toBe('Each line needs 2 to 80 characters: “x”');
    act(() => checks().nearBits.onChange('20'));
    expect(checks().nearBits.error).toBe('Enter a whole number from 0 to 16');
    act(() => checks().save());
    expect(checks().error).toBe('Fix the fields marked below.');

    act(() => acr().onChange('Accomplishment Report\n\nNarrative report'));
    act(() => checks().nearBits.onChange('4'));
    expect(checks()).toMatchObject({ dirty: true, error: null });
    act(() => checks().save());
    await waitFor(() => expect(checks().saved).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({
      taskKeywords: {
        ...DEFAULT_TASK_KEYWORDS,
        ACR: ['Accomplishment Report', 'Narrative report'],
      },
      nearDuplicateBits: 4,
    });
    expect(checks().lastChange).toMatch(/^Changed /);
    expect(acr().value).toBe('Accomplishment Report\nNarrative report');
  });
});

describe('SettingsView', () => {
  const ready: Extract<SystemSettingsModel, { status: 'ready' }> = {
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
    finalAfterDays: {
      value: '7',
      onChange: vi.fn(),
      lastChange: 'The default (7 days)',
      error: null,
      saving: false,
      saved: false,
      dirty: false,
      save: vi.fn(),
    },
    alertCooldown: {
      value: '30',
      onChange: vi.fn(),
      lastChange: 'The default (30 minutes)',
      error: null,
      saving: false,
      saved: false,
      dirty: false,
      save: vi.fn(),
    },
    checks: {
      nearBits: { value: '6', error: undefined, onChange: vi.fn() },
      keywords: [
        {
          type: 'ACR',
          label: 'Activity Completion Report',
          value: 'Accomplishment Report',
          error: undefined,
          onChange: vi.fn(),
        },
      ],
      lastChange: 'Using the defaults',
      error: null,
      saving: false,
      saved: false,
      dirty: false,
      save: vi.fn(),
    },
  };

  it('edits the days until standings are final, saving only a change', () => {
    const { rerender } = render(<SettingsView model={ready} />);
    const field = screen.getByLabelText('Days until final (0 to 60)');
    expect(field).toHaveValue('7');
    expect(screen.getByText('The default (7 days)')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: '14' } });
    expect(ready.finalAfterDays.onChange).toHaveBeenCalledWith('14');

    const section = screen.getByRole('region', { name: /when standings turn final/ });
    expect(within(section).getByRole('button', { name: 'Save' })).toBeDisabled();
    rerender(
      <SettingsView
        model={{ ...ready, finalAfterDays: { ...ready.finalAfterDays, dirty: true } }}
      />,
    );
    fireEvent.click(within(section).getByRole('button', { name: 'Save' }));
    expect(ready.finalAfterDays.save).toHaveBeenCalledOnce();
  });

  it('edits the late value, saving only a change', () => {
    const { rerender } = render(<SettingsView model={ready} />);
    const field = screen.getByLabelText('Points for a late project (0 to 1)');
    fireEvent.change(field, { target: { value: '0.25' } });
    expect(ready.setLatePoints).toHaveBeenCalledWith('0.25');
    expect(
      within(screen.getByRole('region', { name: /points for a late project/ })).getByRole(
        'button',
        { name: 'Save' },
      ),
    ).toBeDisabled();
    rerender(<SettingsView model={{ ...ready, dirty: true }} />);
    fireEvent.click(
      within(screen.getByRole('region', { name: /points for a late project/ })).getByRole(
        'button',
        { name: 'Save' },
      ),
    );
    expect(ready.save).toHaveBeenCalled();
    rerender(<SettingsView model={{ ...ready, saved: true }} />);
    expect(screen.getByText('Saved. The leaderboards are being recomputed.')).toBeInTheDocument();
  });

  it('edits the task file checks, saving only a change', () => {
    const { rerender } = render(<SettingsView model={ready} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Activity Completion Report' }), {
      target: { value: 'Narrative report' },
    });
    expect(ready.checks.keywords[0]!.onChange).toHaveBeenCalledWith('Narrative report');
    expect(screen.getByRole('button', { name: 'Save check settings' })).toBeDisabled();
    rerender(<SettingsView model={{ ...ready, checks: { ...ready.checks, dirty: true } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save check settings' }));
    expect(ready.checks.save).toHaveBeenCalled();
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
