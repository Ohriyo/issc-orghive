import { Router } from 'express';
import { createLeaderboardController } from '#src/controllers/leaderboard.controller';
import type { LeaderboardStream } from '#src/lib/leaderboard-stream';
import { leaderboardCache } from '#src/middleware/public-cache';
import type { PublicLeaderboardService } from '#src/services/public-leaderboard.service';

export interface LeaderboardRouterDeps {
  leaderboard: Pick<PublicLeaderboardService, 'read' | 'semesterOf'>;
  stream: Pick<LeaderboardStream, 'open'>;
}

/** Public reads (spec 5F): the homepage podiums and /leaderboard need no sign-in. */
export function leaderboardRouter({ leaderboard, stream }: LeaderboardRouterDeps): Router {
  const router = Router();
  const controller = createLeaderboardController(leaderboard, stream);

  router.get('/', leaderboardCache, controller.read);
  router.get('/stream', controller.live);

  return router;
}
