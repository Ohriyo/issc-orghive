import type { RequestHandler } from 'express';
import { authOf } from '#src/middleware/require-auth';
import type { DashboardService } from '#src/services/dashboard.service';

export function createDashboardController(dashboard: DashboardService) {
  /** GET /me/dashboard. Personal, so never cached anywhere. */
  const get: RequestHandler = async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json(await dashboard.forUser(authOf(res).userId));
  };

  return { get };
}
