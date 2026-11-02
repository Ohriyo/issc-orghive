import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TASK_KEYWORDS } from '@orghive/shared';
import type { StoredSetting } from '#src/repositories/system-setting.repository';
import { createSystemSettingsService } from '#src/services/system-settings.service';

const CTX = { ip: '10.0.0.1', userAgent: 'test' };
const UPDATED = new Date('2026-10-20T02:00:00Z');
const LATER = new Date('2026-10-22T02:00:00Z');

/** Stored rows by key; a key left out has no row (its default applies). */
function setup(stored: Record<string, { value: StoredSetting['value']; updatedAt?: Date }> = {}) {
  const settings = {
    get: vi.fn((key: string) =>
      Promise.resolve(
        stored[key]
          ? { value: stored[key].value, updatedAt: stored[key].updatedAt ?? UPDATED }
          : null,
      ),
    ),
    set: vi.fn(() => Promise.resolve({ value: 0, updatedAt: UPDATED })),
  };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const onLatePointsChanged = vi.fn(() => Promise.resolve());
  const service = createSystemSettingsService({
    settings: settings,
    audit,
    onLatePointsChanged,
  });
  return { service, settings, audit, onLatePointsChanged };
}

const late = (value: StoredSetting['value']) => ({ 'leaderboard.latePoints': { value } });

describe('systemSettings.finalAfterDays', () => {
  it('defaults to 7 days, and a change is audited and recomputes the open semesters', async () => {
    const stored = new Map<string, { value: unknown; updatedAt: Date }>();
    const audit = { record: vi.fn(() => Promise.resolve()) };
    const onLatePointsChanged = vi.fn(() => Promise.resolve());
    const service = createSystemSettingsService({
      settings: {
        get: (key: string) => Promise.resolve(stored.get(key) ?? null),
        set: (key: string, value: unknown) => {
          stored.set(key, { value, updatedAt: new Date() });
          return Promise.resolve();
        },
      } as never,
      audit,
      onLatePointsChanged,
    });
    await expect(service.finalAfterDays()).resolves.toBe(7);
    await expect(service.get()).resolves.toMatchObject({
      finalAfterDays: 7,
      finalAfterDaysUpdatedAt: null,
    });

    const updated = await service.update(
      'u1',
      { finalAfterDays: 14 },
      { ip: '127.0.0.1', userAgent: 'test' },
    );
    expect(updated.finalAfterDays).toBe(14);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system_setting_change',
        metadata: { key: 'leaderboard.finalAfterDays', before: 7, after: 14 },
      }),
    );
    expect(onLatePointsChanged).toHaveBeenCalledOnce();

    // The same value again changes nothing.
    await service.update('u1', { finalAfterDays: 14 }, { ip: '127.0.0.1', userAgent: 'test' });
    expect(audit.record).toHaveBeenCalledOnce();
  });
});

describe('systemSettingsService', () => {
  it('defaults the late value to 0.5, and the checks to their defaults', async () => {
    const { service } = setup();
    expect(await service.latePoints()).toBe(0.5);
    expect(await service.get()).toEqual({
      leaderboardLatePoints: 0.5,
      updatedAt: null,
      taskKeywords: DEFAULT_TASK_KEYWORDS,
      nearDuplicateBits: 6,
      checksUpdatedAt: null,
      finalAfterDays: 7,
      finalAfterDaysUpdatedAt: null,
    });
  });

  it('reads a stored value', async () => {
    const { service } = setup(late(0.25));
    expect(await service.get()).toMatchObject({
      leaderboardLatePoints: 0.25,
      updatedAt: UPDATED.toISOString(),
    });
  });

  it('falls back to the default when the stored value is unreadable', async () => {
    expect(await setup(late('lots')).service.latePoints()).toBe(0.5);
    expect(await setup(late(7)).service.latePoints()).toBe(0.5);
    const odd = setup({
      'integrity.taskKeywords': { value: { PROPOSAL: 'not a list' } },
      'integrity.nearDuplicateBits': { value: 40 },
    }).service;
    expect(await odd.taskKeywords()).toEqual(DEFAULT_TASK_KEYWORDS);
    expect(await odd.nearDuplicateBits()).toBe(6);
  });

  it('stores a change, audits before and after, and asks for a recompute', async () => {
    const { service, settings, audit, onLatePointsChanged } = setup();
    await service.update('admin', { leaderboardLatePoints: 0.25 }, CTX);
    expect(settings.set).toHaveBeenCalledWith('leaderboard.latePoints', 0.25, 'admin');
    expect(audit.record).toHaveBeenCalledWith({
      action: 'system_setting_change',
      actorId: 'admin',
      entityType: 'system_setting',
      entityId: 'leaderboard.latePoints',
      metadata: { key: 'leaderboard.latePoints', before: 0.5, after: 0.25 },
      ip: '10.0.0.1',
      userAgent: 'test',
    });
    expect(onLatePointsChanged).toHaveBeenCalledOnce();
  });

  it('changes nothing when the value is the same', async () => {
    const { service, settings, audit, onLatePointsChanged } = setup(late(0.5));
    await service.update('admin', { leaderboardLatePoints: 0.5 }, CTX);
    expect(settings.set).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(onLatePointsChanged).not.toHaveBeenCalled();
  });
});

describe('systemSettingsService: the task file checks (spec section 6)', () => {
  const keywords = { ...DEFAULT_TASK_KEYWORDS, ACR: ['Accomplishment Report', 'Narrative'] };

  it('reads stored keywords and threshold, dated by the latest change', async () => {
    const { service } = setup({
      'integrity.taskKeywords': { value: keywords },
      'integrity.nearDuplicateBits': { value: 4, updatedAt: LATER },
    });
    expect(await service.taskKeywords()).toEqual(keywords);
    expect(await service.nearDuplicateBits()).toBe(4);
    expect(await service.get()).toMatchObject({ checksUpdatedAt: LATER.toISOString() });
  });

  it('stores and audits each changed check setting, without a recompute', async () => {
    const { service, settings, audit, onLatePointsChanged } = setup();
    await service.update('admin', { taskKeywords: keywords, nearDuplicateBits: 6 }, CTX);
    // The threshold is unchanged (6 is the default): only the keywords are stored.
    expect(settings.set).toHaveBeenCalledExactlyOnceWith(
      'integrity.taskKeywords',
      keywords,
      'admin',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'integrity.taskKeywords',
        metadata: { key: 'integrity.taskKeywords', before: DEFAULT_TASK_KEYWORDS, after: keywords },
      }),
    );
    expect(onLatePointsChanged).not.toHaveBeenCalled();

    await service.update('admin', { nearDuplicateBits: 3 }, CTX);
    expect(settings.set).toHaveBeenLastCalledWith('integrity.nearDuplicateBits', 3, 'admin');
  });
});
