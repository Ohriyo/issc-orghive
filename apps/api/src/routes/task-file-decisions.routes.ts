import { Router, type RequestHandler } from 'express';
import {
  clearTaskFileWarningsRequestSchema,
  documentIdParamsSchema,
  flagTaskFileRequestSchema,
} from '@orghive/shared';
import { authOf, requireAuth } from '#src/middleware/require-auth';
import { requestContext } from '#src/middleware/require-super-admin';
import type { TaskFileDecisionService } from '#src/services/task-file-decision.service';
import type { TokenService } from '#src/services/token.service';

export interface TaskFileDecisionsRouterDeps {
  decisions: TaskFileDecisionService;
  tokens: Pick<TokenService, 'verify'>;
}

/**
 * A governing body clears a task file's warnings or flags it invalid (spec section 6). Like
 * appeal decisions, the target is another organization's file: the service decides who may
 * (mayDecideIntegrity), never an org guard of the caller's own.
 */
export function taskFileDecisionsRouter({ decisions, tokens }: TaskFileDecisionsRouterDeps) {
  const router = Router();
  const auth = requireAuth(tokens);

  const clearWarnings: RequestHandler = async (req, res) => {
    const { documentId } = documentIdParamsSchema.parse(req.params);
    const body = clearTaskFileWarningsRequestSchema.parse(req.body);
    res.set('Cache-Control', 'private, no-store');
    res.json(
      await decisions.clearWarnings(authOf(res).userId, documentId, body, requestContext(req)),
    );
  };

  const flag: RequestHandler = async (req, res) => {
    const { documentId } = documentIdParamsSchema.parse(req.params);
    const body = flagTaskFileRequestSchema.parse(req.body);
    res.set('Cache-Control', 'private, no-store');
    res.json(await decisions.flag(authOf(res).userId, documentId, body, requestContext(req)));
  };

  router.post('/task-files/:documentId/integrity/clear-warnings', auth, clearWarnings);
  router.post('/task-files/:documentId/integrity/flag', auth, flag);
  return router;
}
