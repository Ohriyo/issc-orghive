import { Router } from 'express';
import { createCollegeController } from '#src/controllers/college.controller';
import { publicCache } from '#src/middleware/public-cache';
import type { CollegeService } from '#src/services/college.service';

/** Public reads. No auth: colleges are listed on the landing page. */
export function collegesRouter(colleges: CollegeService): Router {
  const router = Router();
  const controller = createCollegeController(colleges);

  router.get('/', publicCache, controller.list);
  router.get('/:slug', publicCache, controller.getBySlug);

  return router;
}
