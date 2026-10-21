import { describe, expect, it, vi } from 'vitest';
import type { LeaderboardQuery, LeaderboardResponse, PublicLeaderboardRow } from '@orghive/shared';
import type { OwnProjectRecord } from '#src/repositories/leaderboard.repository';
import { createMyStandingService } from '#src/services/my-standing.service';

const NOW = new Date('2026-12-01T02:00:00Z');

function row(slug: string, rank: number): PublicLeaderboardRow {
  return {
    rank,
    rankChange: null,
    points: 1,
    implementedCount: 1,
    lateCount: 0,
    netProfitCentavos: 100,
    underReviewCount: 0,
    organization: { type: 'SBO', slug, acronym: slug, name: slug, logoUrl: null, logoSrcSet: null },
    college: null,
  };
}

/** A project whose event passed with only its proposal in. */
const missingReports: OwnProjectRecord = {
  id: '00000000-0000-7000-8000-000000000001',
  name: 'Tree Planting',
  createdAt: new Date('2026-10-01T02:00:00Z'),
  targetDate: new Date('2026-10-20T00:00:00Z'),
  nomRequired: false,
  momRequired: false,
  communicationLetterRequired: false,
  attendanceSheetRequired: false,
  tasks: [
    {
      type: 'PROPOSAL',
      submittedAt: new Date('2026-10-05T02:00:00Z'),
      document: { status: 'available', deletedAt: null },
      files: [],
    },
  ],
  figures: null,
};

function setup(type: 'ISSC' | 'SBO' | 'CSC' | null) {
  const accounts = {
    findAccount: vi.fn(() =>
      Promise.resolve(
        type && {
          userId: 'u1',
          organization: {
            id: 'org-jpice',
            type,
            parentId: null,
            slug: 'jpice',
            acronym: 'JPICE',
            name: 'JPICE',
            logoKey: null,
            logoWidths: [],
          },
        },
      ),
    ),
  };
  const leaderboard = {
    read: vi.fn(
      (query: LeaderboardQuery): Promise<LeaderboardResponse> =>
        Promise.resolve({
          academicYear: '2026-2027',
          semester: 'first',
          type: query.type,
          latePoints: 0.5,
          rows: [row('psme', 1), row('jpice', 2)],
        }),
    ),
  };
  const projects = { ownProjects: vi.fn(() => Promise.resolve([missingReports])) };
  const service = createMyStandingService({ accounts, leaderboard, projects, now: () => NOW });
  return { service, leaderboard, projects };
}

describe('myStanding.forUser', () => {
  it('gives an SBO its row on the SBO board, the board size and its hints', async () => {
    const { service, leaderboard, projects } = setup('SBO');
    const { standing } = await service.forUser('u1');
    expect(leaderboard.read).toHaveBeenCalledWith({ type: 'SBO' });
    expect(projects.ownProjects).toHaveBeenCalledWith('org-jpice', {
      start: '2026-08-01',
      end: '2026-12-31',
    });
    expect(standing).toMatchObject({
      academicYear: '2026-2027',
      semester: 'first',
      type: 'SBO',
      latePoints: 0.5,
      boardSize: 2,
      row: { rank: 2, organization: { slug: 'jpice' } },
      hints: [
        {
          kind: 'submit_reports',
          projectName: 'Tree Planting',
          missing: ['ACR', 'FINANCIAL_REPORT'],
        },
      ],
    });
  });

  it('gives an unranked CSC a null row on the CSC board', async () => {
    const { service, leaderboard } = setup('CSC');
    leaderboard.read.mockResolvedValueOnce({
      academicYear: '2026-2027',
      semester: 'first',
      type: 'CSC',
      latePoints: 0.5,
      rows: [],
    });
    const { standing } = await service.forUser('u1');
    expect(standing).toMatchObject({ type: 'CSC', boardSize: 0, row: null });
  });

  it('has nothing for the ISSC (never ranked) or a user without an organization', async () => {
    for (const type of ['ISSC', null] as const) {
      const { service, leaderboard } = setup(type);
      expect(await service.forUser('u1')).toEqual({ standing: null });
      expect(leaderboard.read).not.toHaveBeenCalled();
    }
  });
});
