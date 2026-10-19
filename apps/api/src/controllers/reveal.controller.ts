import type { RequestHandler } from 'express';
import { revealIdParamsSchema } from '@orghive/shared';
import { authOf } from '#src/middleware/require-auth';
import { requestContext } from '#src/middleware/require-super-admin';
import type { RevealService } from '#src/services/reveal.service';

export function createRevealController(reveals: RevealService) {
  const status: RequestHandler = async (req, res) => {
    const { revealId } = revealIdParamsSchema.parse(req.params);
    res.set('Cache-Control', 'private, no-store');
    res.json(await reveals.status(authOf(res).userId, revealId));
  };

  /** The passwords, once. Never cached, never logged. */
  const reveal: RequestHandler = async (req, res) => {
    const { revealId } = revealIdParamsSchema.parse(req.params);
    res.set('Cache-Control', 'private, no-store');
    res.json(await reveals.reveal(authOf(res).userId, revealId, requestContext(req)));
  };

  return { status, reveal };
}
