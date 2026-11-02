import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  disqualificationsQuerySchema,
  disqualifyRequestSchema,
  liftDisqualificationRequestSchema,
  semesterParamsSchema,
  setSemesterDatesRequestSchema,
} from '@orghive/shared';
import { authOf } from '#src/middleware/require-auth';
import { requestContext } from '#src/middleware/require-super-admin';
import type { DisqualificationService } from '#src/services/disqualification.service';
import type { SemesterCalendarService } from '#src/services/semester-calendar.service';

const idParamsSchema = z.strictObject({ id: z.uuid() });

/** /admin/semesters and /admin/disqualifications: the ISSC account (spec 5B). */
export function createLeaderboardAdminController(
  semesters: Pick<SemesterCalendarService, 'adminList' | 'set'>,
  disqualifications: DisqualificationService,
) {
  const listSemesters: RequestHandler = async (_req, res) => {
    res.json(await semesters.adminList());
  };

  const setSemester: RequestHandler = async (req, res) => {
    const key = semesterParamsSchema.parse(req.params);
    const body = setSemesterDatesRequestSchema.parse(req.body);
    res.json(await semesters.set(authOf(res).userId, key, body, requestContext(req)));
  };

  const listDisqualifications: RequestHandler = async (req, res) => {
    res.json(await disqualifications.list(disqualificationsQuerySchema.parse(req.query)));
  };

  const disqualify: RequestHandler = async (req, res) => {
    const body = disqualifyRequestSchema.parse(req.body);
    res
      .status(201)
      .json(await disqualifications.disqualify(authOf(res).userId, body, requestContext(req)));
  };

  const lift: RequestHandler = async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = liftDisqualificationRequestSchema.parse(req.body);
    res.json(await disqualifications.lift(authOf(res).userId, id, body, requestContext(req)));
  };

  return { listSemesters, setSemester, listDisqualifications, disqualify, lift };
}
