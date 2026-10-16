import type { Request, RequestHandler, Response } from 'express';
import {
  createDocumentRequestSchema,
  documentDecisionRequestSchema,
  documentIdParamsSchema,
  documentListQuerySchema,
  documentSearchQuerySchema,
  slugParamsSchema,
  updateDocumentRequestSchema,
} from '@orghive/shared';
import { authOf, maybeAuthOf, orgOf } from '#src/middleware/require-auth';
import type { Actor, DocumentService } from '#src/services/document.service';

function actorOf(req: Request, res: Response): Actor {
  return { userId: authOf(res).userId, ip: req.ip };
}

export function createDocumentController(documents: DocumentService) {
  const list: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    const query = documentListQuerySchema.parse(req.query);
    res.json(await documents.list(maybeAuthOf(res)?.userId, slug, query));
  };

  const search: RequestHandler = async (req, res) => {
    const query = documentSearchQuerySchema.parse(req.query);
    res.json(await documents.search(maybeAuthOf(res)?.userId, query));
  };

  const listTypes: RequestHandler = async (_req, res) => {
    res.json(await documents.listTypes());
  };

  const get: RequestHandler = async (req, res) => {
    const { documentId } = documentIdParamsSchema.parse(req.params);
    res.json(await documents.get(maybeAuthOf(res)?.userId, documentId));
  };

  const create: RequestHandler = async (req, res) => {
    const body = createDocumentRequestSchema.parse(req.body);
    res.status(201).json(await documents.create(actorOf(req, res), orgOf(res), body));
  };

  const update: RequestHandler = async (req, res) => {
    const { documentId } = documentIdParamsSchema.parse(req.params);
    const patch = updateDocumentRequestSchema.parse(req.body);
    res.json(await documents.update(actorOf(req, res), orgOf(res), documentId, patch));
  };

  const submit: RequestHandler = async (req, res) => {
    const { documentId } = documentIdParamsSchema.parse(req.params);
    res.json(await documents.submit(actorOf(req, res), orgOf(res), documentId));
  };

  const decide =
    (decision: 'approved' | 'rejected'): RequestHandler =>
    async (req, res) => {
      const { documentId } = documentIdParamsSchema.parse(req.params);
      // A body is optional here; express.json() leaves req.body undefined without one.
      const { comment } = documentDecisionRequestSchema.parse(req.body ?? {});
      res.json(
        await documents.decide(actorOf(req, res), orgOf(res), documentId, decision, comment),
      );
    };

  const remove: RequestHandler = async (req, res) => {
    const { documentId } = documentIdParamsSchema.parse(req.params);
    await documents.remove(actorOf(req, res), orgOf(res), documentId);
    res.status(204).end();
  };

  return {
    list,
    listTypes,
    search,
    get,
    create,
    update,
    submit,
    approve: decide('approved'),
    reject: decide('rejected'),
    remove,
  };
}
