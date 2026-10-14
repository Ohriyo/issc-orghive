import { Router } from 'express';
import type { HealthResponse } from '@orghive/shared';

/** Liveness check. Does not touch the database, so it stays green while dependencies are down. */
export function healthRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const payload: HealthResponse = { status: 'ok' };
    res.set('Cache-Control', 'no-store').json(payload);
  });

  return router;
}
