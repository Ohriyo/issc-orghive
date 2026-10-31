import type { Request, RequestHandler, Response } from 'express';
import {
  correctFinancialFiguresRequestSchema,
  createProjectFileRequestSchema,
  createProjectRequestSchema,
  projectIdParamsSchema,
  projectTaskParamsSchema,
  taskDocumentRequestSchemaFor,
  taskUploadUrlRequestSchema,
  updateProjectRequestSchema,
  uploadUrlRequestSchema,
} from '@orghive/shared';
import { authOf, orgOf } from '#src/middleware/require-auth';
import type { Actor } from '#src/services/document.service';
import type { FinancialFiguresService } from '#src/services/financial-figures.service';
import type { ProjectService } from '#src/services/project.service';

function actorOf(req: Request, res: Response): Actor {
  return { userId: authOf(res).userId, ip: req.ip };
}

/** Projects are an organization's own workspace: every response is private. */
function noStore(res: Response) {
  res.set('Cache-Control', 'private, no-store');
}

export function createProjectController(
  projects: ProjectService,
  figures: Pick<FinancialFiguresService, 'correct'>,
) {
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
    // A Financial Report file carries its totals (spec 5D).
    const body = taskDocumentRequestSchemaFor(type).parse(req.body);
    noStore(res);
    res
      .status(201)
      .json(await projects.submitTaskFile(actorOf(req, res), orgOf(res), projectId, type, body));
  };

  /** Extra files outside the checklist (spec 2C). */
  const fileUploadUrl: RequestHandler = async (req, res) => {
    const { projectId } = projectIdParamsSchema.parse(req.params);
    const body = uploadUrlRequestSchema.parse(req.body);
    noStore(res);
    res.status(201).json(await projects.fileUploadUrl(actorOf(req, res), orgOf(res), projectId, body));
  };

  const addFile: RequestHandler = async (req, res) => {
    const { projectId } = projectIdParamsSchema.parse(req.params);
    const body = createProjectFileRequestSchema.parse(req.body);
    noStore(res);
    res.status(201).json(await projects.addFile(actorOf(req, res), orgOf(res), projectId, body));
  };

  const correctFigures: RequestHandler = async (req, res) => {
    const { projectId } = projectIdParamsSchema.parse(req.params);
    const body = correctFinancialFiguresRequestSchema.parse(req.body);
    noStore(res);
    res.json(await figures.correct(actorOf(req, res), orgOf(res), projectId, body));
  };

  return {
    list,
    create,
    get,
    update,
    taskUploadUrl,
    submitTaskFile,
    fileUploadUrl,
    addFile,
    correctFigures,
  };
}
