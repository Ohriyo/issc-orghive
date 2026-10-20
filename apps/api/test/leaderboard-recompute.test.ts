import { describe, expect, it, vi } from 'vitest';
import type { SemesterKey } from '@orghive/shared';
import {
  createLeaderboardRecompute,
  openSemesters,
} from '#src/services/leaderboard-recompute';

const FIRST = { academicYear: '2026-2027', semester: 'first' };
const SECOND = { academicYear: '2026-2027', semester: 'second' };
const MIDYEAR_BEFORE = { academicYear: '2025-2026', semester: 'midyear' };

function setup({
  targetDate = null as Date | null,
  failQueue = false,
  now = new Date('2026-10-20T04:00:00Z'),
} = {}) {
  const queued: SemesterKey[] = [];
  const queue = {
    enqueueRecompute: vi.fn((key: SemesterKey) => {
      if (failQueue) return Promise.reject(new Error('Redis down'));
      queued.push(key);
      return Promise.resolve();
    }),
  };
  const projects = { targetDateOfDocument: vi.fn(() => Promise.resolve(targetDate)) };
  const logger = { warn: vi.fn() };
  const recompute = createLeaderboardRecompute({ queue, projects, logger, now: () => now });
  return { recompute, queue, projects, logger, queued };
}

describe('leaderboardRecompute.forEventDates', () => {
  it('queues the semester of each event date, once each', async () => {
    const { recompute, queued } = setup();
    await recompute.forEventDates(
      '2026-12-28',
      new Date('2026-10-20T00:00:00Z'),
      '2027-01-05',
    );
    expect(queued).toEqual([FIRST, SECOND]);
  });

  it('logs and swallows a queue failure, so the change that asked still succeeds', async () => {
    const { recompute, logger } = setup({ failQueue: true });
    await expect(recompute.forEventDates('2026-10-20')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe('leaderboardRecompute.forDocument', () => {
  it('queues the semester of the project whose task holds the file', async () => {
    const { recompute, queued, projects } = setup({
      targetDate: new Date('2027-06-10T00:00:00Z'),
    });
    await recompute.forDocument('doc-1');
    expect(projects.targetDateOfDocument).toHaveBeenCalledWith('doc-1');
    expect(queued).toEqual([{ academicYear: '2026-2027', semester: 'midyear' }]);
  });

  it('queues nothing for a file that is not a task’s', async () => {
    const { recompute, queued } = setup();
    await recompute.forDocument('doc-1');
    expect(queued).toEqual([]);
  });

  it('logs and swallows a failed lookup', async () => {
    const { recompute, projects, logger } = setup();
    projects.targetDateOfDocument.mockRejectedValueOnce(new Error('db down'));
    await expect(recompute.forDocument('doc-1')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe('leaderboardRecompute.forOpenSemesters', () => {
  it('queues the current semester and the previous one (Manila time)', async () => {
    // 17:00 UTC on Jul 31 is already Aug 1 in Manila: the 1st semester of 2026-2027.
    const { recompute, queued } = setup({ now: new Date('2026-07-31T17:00:00Z') });
    await recompute.forOpenSemesters();
    expect(queued).toEqual([FIRST, MIDYEAR_BEFORE]);
  });
});

describe('openSemesters', () => {
  it('is the current semester, then the one before', () => {
    expect(openSemesters(new Date('2027-02-01T00:00:00Z'))).toEqual([SECOND, FIRST]);
  });
});
