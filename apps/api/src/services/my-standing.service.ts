import { semesterRange, type MyStandingResponse } from '@orghive/shared';
import type { AccountRepository } from '#src/repositories/account.repository';
import type { LeaderboardRepository } from '#src/repositories/leaderboard.repository';
import { standingHints } from '#src/services/leaderboard-rules';
import { projectFactsOf } from '#src/services/leaderboard.service';
import type { PublicLeaderboardService } from '#src/services/public-leaderboard.service';

export interface MyStandingServiceDeps {
  accounts: Pick<AccountRepository, 'findAccount'>;
  leaderboard: Pick<PublicLeaderboardService, 'read'>;
  projects: Pick<LeaderboardRepository, 'ownProjects'>;
  now?: () => Date;
}

/**
 * GET /me/leaderboard: the signed-in SBO's or CSC's place on its board this semester and
 * what would move it up (docs/LEADERBOARD_PHASES.md, Phase 3.6). The row is the public
 * one; the hints name its own projects, so they are shown to its account only.
 */
export function createMyStandingService({
  accounts,
  leaderboard,
  projects,
  now = () => new Date(),
}: MyStandingServiceDeps) {
  return {
    async forUser(userId: string): Promise<MyStandingResponse> {
      const org = (await accounts.findAccount(userId))?.organization;
      // The ISSC is never ranked (spec 5A); a super admin has no organization.
      if (!org || org.type === 'ISSC') return { standing: null };

      const board = await leaderboard.read({ type: org.type });
      const own = await projects.ownProjects(
        org.id,
        semesterRange(board.academicYear, board.semester),
      );
      const hints = standingHints(
        own.map((project) => ({ id: project.id, name: project.name, ...projectFactsOf(project) })),
        now(),
      );
      return {
        standing: {
          academicYear: board.academicYear,
          semester: board.semester,
          latePoints: board.latePoints,
          type: org.type,
          boardSize: board.rows.length,
          row: board.rows.find((row) => row.organization.slug === org.slug) ?? null,
          hints,
        },
      };
    },
  };
}

export type MyStandingService = ReturnType<typeof createMyStandingService>;
