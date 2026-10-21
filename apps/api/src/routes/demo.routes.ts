import { Router } from 'express';
import { createDemoDataController } from '#src/controllers/demo-data.controller';
import { publicCache } from '#src/middleware/public-cache';
import type { DemoDataService } from '#src/services/demo-data.service';

/**
 * GET /demo-status, public: which organizations' pages show demo data, so the leaderboard
 * and their pages can say "Sample data". Only slugs, which are public anyway.
 */
export function demoRouter(demo: Pick<DemoDataService, 'preview' | 'remove' | 'status'>): Router {
  const router = Router();
  const controller = createDemoDataController(demo);

  router.get('/', publicCache, controller.status);

  return router;
}
