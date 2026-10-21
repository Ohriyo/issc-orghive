import { Router } from 'express';
import { createHandbookController } from '#src/controllers/handbook.controller';
import { publicCache } from '#src/middleware/public-cache';
import type { HandbookService } from '#src/services/handbook.service';

/**
 * The Student Handbook, public: the current edition, past editions and search inside one.
 * Pages are read through the document viewer; the file itself goes to the ISSC account only
 * (the document routes). Uploads and "Make current" are under /admin.
 */
export function handbookRouter(handbook: HandbookService): Router {
  const router = Router();
  const controller = createHandbookController(handbook);

  router.get('/', publicCache, controller.current);
  router.get('/editions', publicCache, controller.editions);
  router.get('/search', publicCache, controller.search);
  router.get('/:year', publicCache, controller.byYear);
  router.get('/:year/search', publicCache, controller.search);

  return router;
}
