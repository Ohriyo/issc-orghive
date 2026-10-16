import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import {
  addVersionRequestSchema,
  createDocumentRequestSchema,
  documentDecisionRequestSchema,
  documentIdParamsSchema,
  documentListQuerySchema,
  documentSearchQuerySchema,
  slugParamsSchema,
  updateDocumentRequestSchema,
  uploadUrlRequestSchema,
  versionParamsSchema,
} from '@orghive/shared';
import { authOf, maybeAuthOf, orgOf } from '#src/middleware/require-auth';
import type { Actor, DocumentService } from '#src/services/document.service';
import type { UploadService } from '#src/services/upload.service';

const downloadQuerySchema = z.object({
  /** "inline" opens the file in the browser (preview); the default saves it. */
  disposition: z.enum(['attachment', 'inline']).default('attachment'),
});

function actorOf(req: Request, res: Response): Actor {
  return { userId: authOf(res).userId, ip: req.ip };
}

export function createDocumentController(documents: DocumentService, uploads: UploadService) {
  const uploadUrl: RequestHandler = async (req, res) => {
    const body = uploadUrlRequestSchema.parse(req.body);
    res.set('Cache-Control', 'private, no-store');
    res.status(201).json(await uploads.issueUrl(authOf(res).userId, orgOf(res), body));
  };

  const addVersion: RequestHandler = async (req, res) => {
    const { documentId } = documentIdParamsSchema.parse(req.params);
    const { uploadKey } = addVersionRequestSchema.parse(req.body);
    res
      .status(201)
      .json(await documents.addVersion(actorOf(req, res), orgOf(res), documentId, uploadKey));
  };

  const listVersions: RequestHandler = async (req, res) => {
    const { documentId } = documentIdParamsSchema.parse(req.params);
    res.json(await documents.listVersions(maybeAuthOf(res)?.userId, documentId));
  };

  const downloadUrl: RequestHandler = async (req, res) => {
    const { documentId, versionId } = versionParamsSchema.parse(req.params);
    const { disposition } = downloadQuerySchema.parse(req.query);
    // A signed link is a credential for 5 minutes: never cache it anywhere.
    res.set('Cache-Control', 'private, no-store');
    res.json(
      await documents.downloadUrl(maybeAuthOf(res)?.userId, documentId, versionId, disposition),
    );
  };

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
    uploadUrl,
    addVersion,
    listVersions,
    downloadUrl,
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
