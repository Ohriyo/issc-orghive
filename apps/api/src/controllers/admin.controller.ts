import type { Request, RequestHandler, Response } from 'express';
import {
  ErrorCode,
  createCollegeRequestSchema,
  createOrganizationRequestSchema,
  reorderRequestSchema,
  slugParamsSchema,
  updateCollegeRequestSchema,
  updateOrganizationRequestSchema,
  requestAccountRequestSchema,
} from '@orghive/shared';
import { z } from 'zod';
import { AppError } from '#src/errors/app-error';
import { authOf } from '#src/middleware/require-auth';
import type { AccountRequestService } from '#src/services/account-request.service';
import type { AdminOrganizationService } from '#src/services/admin-organization.service';
import { requestContext } from '#src/middleware/require-super-admin';
import type { Actor } from '#src/services/document.service';

const activeBodySchema = z.strictObject({ active: z.boolean() });

function actorOf(req: Request, res: Response): Actor {
  return { userId: authOf(res).userId, ip: req.ip };
}

export function createAdminController(
  organizations: AdminOrganizationService,
  accountRequests: AccountRequestService,
) {
  /** The ISSC account asks the super admin for an organization's account. */
  const requestAccount: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    const body = requestAccountRequestSchema.parse(req.body);
    res
      .status(201)
      .json(
        await accountRequests.request(
          { userId: authOf(res).userId, ctx: requestContext(req) },
          slug,
          body,
        ),
      );
  };

  const tree: RequestHandler = async (_req, res) => {
    res.json(await organizations.tree());
  };

  const createCollege: RequestHandler = async (req, res) => {
    const body = createCollegeRequestSchema.parse(req.body);
    res.status(201).json(await organizations.createCollege(actorOf(req, res), body));
  };

  const updateCollege: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    const patch = updateCollegeRequestSchema.parse(req.body);
    res.json(await organizations.updateCollege(actorOf(req, res), slug, patch));
  };

  const reorderColleges: RequestHandler = async (req, res) => {
    const { slugs } = reorderRequestSchema.parse(req.body);
    res.json(await organizations.reorderColleges(actorOf(req, res), slugs));
  };

  const reorderSbos: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    const { slugs } = reorderRequestSchema.parse(req.body);
    res.json(await organizations.reorderSbos(actorOf(req, res), slug, slugs));
  };

  const createOrganization: RequestHandler = async (req, res) => {
    const body = createOrganizationRequestSchema.parse(req.body);
    res.status(201).json(await organizations.createOrganization(actorOf(req, res), body));
  };

  const updateOrganization: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    const patch = updateOrganizationRequestSchema.parse(req.body);
    res.json(await organizations.updateOrganization(actorOf(req, res), slug, patch));
  };

  const setActive: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    const { active } = activeBodySchema.parse(req.body);
    res.json(await organizations.setActive(actorOf(req, res), slug, active));
  };

  /** The raw image bytes (express.raw on the route); the service checks what they are. */
  const setLogo: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'logo: Send a PNG, JPEG or WebP image');
    }
    res.json(await organizations.setLogo(actorOf(req, res), slug, req.body));
  };

  return {
    requestAccount,
    tree,
    createCollege,
    updateCollege,
    reorderColleges,
    reorderSbos,
    createOrganization,
    updateOrganization,
    setActive,
    setLogo,
  };
}
