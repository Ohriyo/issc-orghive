import type { Request, RequestHandler, Response } from 'express';
import {
  announcementIdParamsSchema,
  announcementListQuerySchema,
  createAnnouncementRequestSchema,
  updateAnnouncementRequestSchema,
} from '@orghive/shared';
import { authOf, maybeAuthOf, orgOf } from '#src/middleware/require-auth';
import type { AnnouncementService } from '#src/services/announcement.service';
import type { Actor } from '#src/services/document.service';

function actorOf(req: Request, res: Response): Actor {
  return { userId: authOf(res).userId, ip: req.ip };
}

export function createAnnouncementController(announcements: AnnouncementService) {
  const list: RequestHandler = async (req, res) => {
    const query = announcementListQuerySchema.parse(req.query);
    res.json(await announcements.list(maybeAuthOf(res)?.userId, query));
  };

  const get: RequestHandler = async (req, res) => {
    const { announcementId } = announcementIdParamsSchema.parse(req.params);
    res.json(await announcements.get(maybeAuthOf(res)?.userId, announcementId));
  };

  const create: RequestHandler = async (req, res) => {
    const body = createAnnouncementRequestSchema.parse(req.body);
    res.status(201).json(await announcements.create(actorOf(req, res), orgOf(res), body));
  };

  const update: RequestHandler = async (req, res) => {
    const { announcementId } = announcementIdParamsSchema.parse(req.params);
    const patch = updateAnnouncementRequestSchema.parse(req.body);
    res.json(await announcements.update(actorOf(req, res), orgOf(res), announcementId, patch));
  };

  const remove: RequestHandler = async (req, res) => {
    const { announcementId } = announcementIdParamsSchema.parse(req.params);
    await announcements.remove(actorOf(req, res), orgOf(res), announcementId);
    res.status(204).end();
  };

  return { list, get, create, update, remove };
}
