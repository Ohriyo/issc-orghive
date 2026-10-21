import { describe, expect, it, vi } from 'vitest';
import { createSystemSettingsService } from '#src/services/system-settings.service';

const CTX = { ip: '10.0.0.1', userAgent: 'test' };
const UPDATED = new Date('2026-10-20T02:00:00Z');

function setup(value?: unknown) {
  const row = value === undefined ? null : { value, updatedAt: UPDATED };
  const settings = {
    get: vi.fn(() => Promise.resolve(row)),
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

describe('systemSettingsService', () => {
  it('defaults the late value to 0.5', async () => {
    const { service } = setup();
    expect(await service.latePoints()).toBe(0.5);
    expect(await service.get()).toEqual({ leaderboardLatePoints: 0.5, updatedAt: null });
  });

  it('reads a stored value', async () => {
    const { service } = setup(0.25);
    expect(await service.get()).toEqual({
      leaderboardLatePoints: 0.25,
      updatedAt: UPDATED.toISOString(),
    });
  });

  it('falls back to the default when the stored value is unreadable', async () => {
    expect(await setup('lots').service.latePoints()).toBe(0.5);
    expect(await setup(7).service.latePoints()).toBe(0.5);
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
    const { service, settings, audit, onLatePointsChanged } = setup(0.5);
    await service.update('admin', { leaderboardLatePoints: 0.5 }, CTX);
    expect(settings.set).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(onLatePointsChanged).not.toHaveBeenCalled();
  });
});
