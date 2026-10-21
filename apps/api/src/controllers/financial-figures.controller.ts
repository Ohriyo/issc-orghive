import type { RequestHandler } from 'express';
import {
  financialFiguresQuerySchema,
  flagFinancialFiguresRequestSchema,
  projectIdParamsSchema,
} from '@orghive/shared';
import { authOf } from '#src/middleware/require-auth';
import { requestContext } from '#src/middleware/require-super-admin';
import type { FinancialFiguresService } from '#src/services/financial-figures.service';

/** /admin/financial-figures: the ISSC account checks reported figures (spec 5D). */
export function createFinancialFiguresController(
  figures: Pick<FinancialFiguresService, 'list' | 'flag' | 'clearFlag'>,
) {
  const list: RequestHandler = async (req, res) => {
    res.json(await figures.list(financialFiguresQuerySchema.parse(req.query)));
  };

  const flag: RequestHandler = async (req, res) => {
    const { projectId } = projectIdParamsSchema.parse(req.params);
    const { remark } = flagFinancialFiguresRequestSchema.parse(req.body);
    res.json(await figures.flag(authOf(res).userId, projectId, remark, requestContext(req)));
  };

  const clearFlag: RequestHandler = async (req, res) => {
    const { projectId } = projectIdParamsSchema.parse(req.params);
    res.json(await figures.clearFlag(authOf(res).userId, projectId, requestContext(req)));
  };

  return { list, flag, clearFlag };
}
