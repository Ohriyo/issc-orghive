import type { Request, RequestHandler, Response } from 'express';
import {
  createProjectRequestSchema,
  createTaskDocumentRequestSchema,
  projectIdParamsSchema,
  projectTaskParamsSchema,
  taskUploadUrlRequestSchema,
  updateProjectRequestSchema,
} from '@orghive/shared';
import { authOf, orgOf } from '#src/middleware/require-auth';
import type { Actor } from '#src/services/document.service';
import type { ProjectService } from '#src/services/project.service';

function actorOf(req: Request, res: Response): Actor {
  return { userId: authOf(res).userId, ip: req.ip };
}

/** Projects are an organization's own workspace: every response is private. */
function noStore(res: Response) {
  res.set('Cache-Control', 'private, no-store');
}

export function createProjectController(projects: ProjectService) {
  const list: RequestHandler = async (_req, res) => {
    noStore(res);
    res.json(await projects.list(orgOf(res)));
  };

  const create: RequestHandler = async (req, res) => {
    const body = createProjectRequestSchema.parse(req.body);
    noStore(res);
    res.status(201).json(await projects.create(actorOf(req, res), orgOf(res), body));
  };

  const get: RequestHandler = async (req, res) => {
    const { projectId } = projectIdParamsSchema.parse(req.params);
    noStore(res);
    res.json(await projects.get(actorOf(req, res), orgOf(res), projectId));
  };

  const update: RequestHandler = async (req, res) => {
    const { projectId } = projectIdParamsSchema.parse(req.params);
    const patch = updateProjectRequestSchema.parse(req.body);
    noStore(res);
    res.json(await projects.update(actorOf(req, res), orgOf(res), projectId, patch));
  };

  const taskUploadUrl: RequestHandler = async (req, res) => {
    const { projectId, type } = projectTaskParamsSchema.parse(req.params);
    const body = taskUploadUrlRequestSchema.parse(req.body);
    noStore(res);
    res
      .status(201)
      .json(await projects.taskUploadUrl(actorOf(req, res), orgOf(res), projectId, type, body));
  };

  const submitTaskFile: RequestHandler = async (req, res) => {
    const { projectId, type } = projectTaskParamsSchema.parse(req.params);
    const body = createTaskDocumentRequestSchema.parse(req.body);
    noStore(res);
    res
      .status(201)
      .json(await projects.submitTaskFile(actorOf(req, res), orgOf(res), projectId, type, body));
  };

  return { list, create, get, update, taskUploadUrl, submitTaskFile };
}
