import type { RequestHandler } from 'express';
import { authOf } from '#src/middleware/require-auth';
import type { DashboardService } from '#src/services/dashboard.service';
import type { MyStandingService } from '#src/services/my-standing.service';

export function createDashboardController(
  dashboard: DashboardService,
  standing: Pick<MyStandingService, 'forUser'>,
) {
  /** GET /me/dashboard. Personal, so never cached anywhere. */
  const get: RequestHandler = async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json(await dashboard.forUser(authOf(res).userId));
  };

  /** GET /me/leaderboard: the account's own standing and hints. Personal, never cached. */
  const leaderboard: RequestHandler = async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json(await standing.forUser(authOf(res).userId));
  };

  return { get, leaderboard };
}
