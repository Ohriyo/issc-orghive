import { describe, expect, it, vi } from 'vitest';
import type { LeaderboardType, SemesterKey } from '@orghive/shared';
import { cacheKeys, memoryCache } from '#src/lib/cache';
import { createPublicUrl } from '#src/lib/public-url';
import type { PublicOrganizationRecord } from '#src/repositories/leaderboard.repository';
import type { LeaderboardRow } from '#src/services/leaderboard.service';
import { createPublicLeaderboardService } from '#src/services/public-leaderboard.service';

const SEMESTER = { academicYear: '2026-2027', semester: 'first' as const };
const CEA = { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' };
const CCIS = { code: 'CCIS', slug: 'ccis', name: 'College of Computing and Information Sciences' };

function organization(
  id: string,
  type: 'SBO' | 'CSC',
  college: typeof CEA | null,
  logoKey: string | null = null,
): PublicOrganizationRecord {
  return {
    id,
    type,
    slug: id,
    acronym: id.toUpperCase(),
    name: `Name of ${id}`,
    logoKey,
    logoWidths: [],
    college,
  };
}

function row(organizationId: string, rank: number): LeaderboardRow {
  return {
    organizationId,
    rank,
    rankChange: 1,
    points: 1.5,
    implementedCount: 2,
    lateCount: 1,
    netProfitCentavos: -1234,
    underReviewCount: 1,
    lastCompletedAt: '2026-11-01T00:00:00.000Z',
  };
}

function setup(boards: Partial<Record<LeaderboardType, LeaderboardRow[]>> = {}) {
  const leaderboard = {
    board: vi.fn((_semester: SemesterKey, type: LeaderboardType) =>
      Promise.resolve(boards[type] ?? []),
    ),
  };
  const organizations = {
    publicOrganizations: vi.fn(() =>
      Promise.resolve([
        organization('jpice', 'SBO', CEA, 'logos/jpice.webp'),
        organization('psme', 'SBO', CEA),
        organization('jpcs', 'SBO', CCIS),
        organization('csc-cea', 'CSC', CEA),
      ]),
    ),
  };
  const settings = { latePoints: vi.fn(() => Promise.resolve(0.25)) };
  const cache = memoryCache();
  const service = createPublicLeaderboardService({
    leaderboard,
    organizations,
    settings,
    cache,
    publicUrl: createPublicUrl('https://cdn.test'),
    now: () => new Date('2027-02-10T04:00:00Z'),
  });
  return { service, leaderboard, organizations, cache };
}

describe('publicLeaderboard.read', () => {
  it('joins the public organization fields and the late value to the board', async () => {
    const { service } = setup({ SBO: [row('jpice', 1), row('jpcs', 2)] });
    const board = await service.read({ type: 'SBO', ...SEMESTER });
    expect(board).toMatchObject({ ...SEMESTER, type: 'SBO', latePoints: 0.25 });
    expect(board.rows[0]).toEqual({
      rank: 1,
      rankChange: 1,
      points: 1.5,
      implementedCount: 2,
      lateCount: 1,
      netProfitCentavos: -1234,
      underReviewCount: 1,
      organization: {
        type: 'SBO',
        slug: 'jpice',
        acronym: 'JPICE',
        name: 'Name of jpice',
        logoUrl: 'https://cdn.test/logos/jpice.webp',
        logoSrcSet: null,
      },
      college: CEA,
    });
  });

  it('never sends internal fields (spec 5F)', async () => {
    const { service } = setup({ SBO: [row('jpice', 1)] });
    const [first] = (await service.read({ type: 'SBO' })).rows;
    expect(first).not.toHaveProperty('organizationId');
    expect(first).not.toHaveProperty('lastCompletedAt');
    expect(first?.organization).not.toHaveProperty('id');
  });

  it('filters by college, keeping each row’s rank on the whole board', async () => {
    const { service } = setup({ SBO: [row('jpcs', 1), row('jpice', 2), row('psme', 3)] });
    const board = await service.read({ type: 'SBO', college: 'cea' });
    expect(board.rows.map((r) => [r.organization.slug, r.rank])).toEqual([
      ['jpice', 2],
      ['psme', 3],
    ]);
  });

  it('reads the current Manila semester when none is named', async () => {
    const { service, leaderboard } = setup();
    const board = await service.read({ type: 'CSC' });
    expect(board).toMatchObject({ academicYear: '2026-2027', semester: 'second' });
    expect(leaderboard.board).toHaveBeenCalledWith(
      { academicYear: '2026-2027', semester: 'second' },
      'CSC',
    );
  });

  it('leaves out a row whose organization was deleted since the board was computed', async () => {
    const { service } = setup({ SBO: [row('gone', 1), row('jpice', 2)] });
    const board = await service.read({ type: 'SBO' });
    expect(board.rows.map((r) => r.organization.slug)).toEqual(['jpice']);
  });

  it('caches the organizations, so a second read does not query them', async () => {
    const { service, organizations, cache } = setup({ SBO: [row('jpice', 1)] });
    await service.read({ type: 'SBO' });
    await service.read({ type: 'SBO' });
    expect(organizations.publicOrganizations).toHaveBeenCalledOnce();
    expect(
      await cache.getOrSet(cacheKeys.leaderboardOrganizations(), 60, () => Promise.resolve(null)),
    ).not.toBeNull();
  });
});

describe('publicLeaderboard.boards', () => {
  it('sends both boards of the semester, unfiltered', async () => {
    const { service } = setup({ SBO: [row('jpice', 1)], CSC: [row('csc-cea', 1)] });
    const event = await service.boards(SEMESTER);
    expect(event).toMatchObject({ ...SEMESTER, latePoints: 0.25 });
    expect(event.boards.SBO.map((r) => r.organization.slug)).toEqual(['jpice']);
    expect(event.boards.CSC.map((r) => r.organization.slug)).toEqual(['csc-cea']);
  });
});

describe('publicLeaderboard.semesterOf', () => {
  it('takes the named semester, or the current one', () => {
    const { service } = setup();
    expect(service.semesterOf(SEMESTER)).toEqual(SEMESTER);
    expect(service.semesterOf({})).toEqual({ academicYear: '2026-2027', semester: 'second' });
  });
});
