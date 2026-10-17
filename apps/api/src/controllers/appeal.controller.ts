import type { Request, RequestHandler, Response } from 'express';
import {
  appealAttachmentParamsSchema,
  appealIdParamsSchema,
  appealQueueQuerySchema,
  createAppealAttachmentRequestSchema,
  decideAppealRequestSchema,
  orgAttachmentParamsSchema,
  projectIdParamsSchema,
  submitAppealRequestSchema,
  uploadUrlRequestSchema,
} from '@orghive/shared';
import { authOf, orgOf } from '#src/middleware/require-auth';
import type { AppealService } from '#src/services/appeal.service';
import type { Actor } from '#src/services/document.service';

function actorOf(req: Request, res: Response): Actor {
  return { userId: authOf(res).userId, ip: req.ip };
}

/** Appeals concern one organization and its deciders: every response is private. */
function noStore(res: Response) {
  res.set('Cache-Control', 'private, no-store');
}

export function createAppealController(appeals: AppealService) {
  const compliance: RequestHandler = async (_req, res) => {
    noStore(res);
    res.json(await appeals.compliance(orgOf(res)));
  };

  const submit: RequestHandler = async (req, res) => {
    const body = submitAppealRequestSchema.parse(req.body);
    noStore(res);
    res.status(201).json(await appeals.submit(actorOf(req, res), orgOf(res), body));
  };

  const listForProject: RequestHandler = async (req, res) => {
    const { projectId } = projectIdParamsSchema.parse(req.params);
    noStore(res);
    res.json(await appeals.listForProject(actorOf(req, res), orgOf(res), projectId));
  };

  const queue: RequestHandler = async (req, res) => {
    const query = appealQueueQuerySchema.parse(req.query);
    noStore(res);
    res.json(await appeals.queue(actorOf(req, res), query));
  };

  const decide: RequestHandler = async (req, res) => {
    const { appealId } = appealIdParamsSchema.parse(req.params);
    const body = decideAppealRequestSchema.parse(req.body);
    noStore(res);
    res.json(await appeals.decide(actorOf(req, res), appealId, body));
  };

  const attachmentUploadUrl: RequestHandler = async (req, res) => {
    const body = uploadUrlRequestSchema.parse(req.body);
    noStore(res);
    res.status(201).json(await appeals.attachmentUploadUrl(actorOf(req, res), orgOf(res), body));
  };

  const addAttachment: RequestHandler = async (req, res) => {
    const { uploadKey } = createAppealAttachmentRequestSchema.parse(req.body);
    noStore(res);
    res.status(201).json(await appeals.addAttachment(actorOf(req, res), orgOf(res), uploadKey));
  };

  const getAttachment: RequestHandler = async (req, res) => {
    const { attachmentId } = orgAttachmentParamsSchema.parse(req.params);
    noStore(res);
    res.json(await appeals.getAttachment(orgOf(res), attachmentId));
  };

  const downloadAttachment: RequestHandler = async (req, res) => {
    const { appealId, attachmentId } = appealAttachmentParamsSchema.parse(req.params);
    noStore(res);
    res.json(await appeals.attachmentDownload(actorOf(req, res), appealId, attachmentId));
  };

  return {
    compliance,
    submit,
    listForProject,
    queue,
    decide,
    attachmentUploadUrl,
    addAttachment,
    getAttachment,
    downloadAttachment,
  };
}
