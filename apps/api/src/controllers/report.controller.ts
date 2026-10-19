import type { RequestHandler } from 'express';
import { generateReportRequestSchema } from '@orghive/shared';
import { authOf, orgOf } from '#src/middleware/require-auth';
import type { ReportService } from '#src/services/report.service';

export function createReportController(reports: ReportService) {
  const request: RequestHandler = async (req, res) => {
    const body = generateReportRequestSchema.parse(req.body);
    res.set('Cache-Control', 'private, no-store');
    res
      .status(202)
      .json(await reports.request({ userId: authOf(res).userId, ip: req.ip }, orgOf(res), body));
  };

  const list: RequestHandler = async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json(await reports.list(orgOf(res)));
  };

  return { request, list };
}
