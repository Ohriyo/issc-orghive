import type { Request, RequestHandler, Response } from 'express';
import {
  handbookSearchQuerySchema,
  handbookYearParamsSchema,
  makeHandbookCurrentRequestSchema,
  uploadHandbookRequestSchema,
} from '@orghive/shared';
import { authOf } from '#src/middleware/require-auth';
import type { Actor } from '#src/services/document.service';
import type { HandbookService } from '#src/services/handbook.service';

function actorOf(req: Request, res: Response): Actor {
  return { userId: authOf(res).userId, ip: req.ip };
}

export function createHandbookController(handbook: HandbookService) {
  const current: RequestHandler = async (_req, res) => {
    res.json(await handbook.current());
  };

  const editions: RequestHandler = async (_req, res) => {
    res.json(await handbook.editions());
  };

  const byYear: RequestHandler = async (req, res) => {
    const { year } = handbookYearParamsSchema.parse(req.params);
    res.json(await handbook.byYear(year));
  };

  /** `/handbook/search` searches the current edition; `/handbook/:year/search` that year's. */
  const search: RequestHandler = async (req, res) => {
    const year = req.params.year === undefined ? null : handbookYearParamsSchema.parse(req.params).year;
    const { q } = handbookSearchQuerySchema.parse(req.query);
    res.json(await handbook.search(year, q));
  };

  const adminList: RequestHandler = async (_req, res) => {
    res.json(await handbook.adminList());
  };

  const upload: RequestHandler = async (req, res) => {
    const body = uploadHandbookRequestSchema.parse(req.body);
    res.status(201).json(await handbook.upload(actorOf(req, res), body));
  };

  const makeCurrent: RequestHandler = async (req, res) => {
    const { year } = handbookYearParamsSchema.parse(req.params);
    const { actingAs } = makeHandbookCurrentRequestSchema.parse(req.body);
    res.json(await handbook.makeCurrent(actorOf(req, res), year, actingAs));
  };

  const retryPreview: RequestHandler = async (req, res) => {
    const { year } = handbookYearParamsSchema.parse(req.params);
    res.json(await handbook.retryPreview(year));
  };

  return { current, editions, byYear, search, adminList, upload, makeCurrent, retryPreview };
}
