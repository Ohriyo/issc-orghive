import type { Request, RequestHandler, Response } from 'express';
import {
  accountCsvRequestSchema,
  accountRequestIdParamsSchema,
  endOfTermRequestSchema,
  createAccountRequestSchema,
  declineAccountRequestSchema,
  systemAccountRequestListQuerySchema,
  ErrorCode,
  deleteTestDataRequestSchema,
  documentIdParamsSchema,
  setLockRequestSchema,
  slugParamsSchema,
  systemUserIdParamsSchema,
  systemUserListQuerySchema,
  updateAccountRequestSchema,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { authOf } from '#src/middleware/require-auth';
import { requestContext } from '#src/middleware/require-super-admin';
import type { AccountAdminService, ConsoleActor } from '#src/services/account-admin.service';
import type { AccountImportService } from '#src/services/account-import.service';
import type { AccountRequestService } from '#src/services/account-request.service';
import type { AdminOrganizationService } from '#src/services/admin-organization.service';
import type { SupportService } from '#src/services/support.service';

function actorOf(req: Request, res: Response): ConsoleActor {
  return { userId: authOf(res).userId, ctx: requestContext(req) };
}

/** /system accounts and file support. Every route already passed requireSuperAdmin. */
export function createAccountAdminController(
  accounts: AccountAdminService,
  organizations: Pick<AdminOrganizationService, 'tree' | 'setLogo'>,
  support: SupportService,
  requests: AccountRequestService,
  imports: AccountImportService,
) {
  const list: RequestHandler = async (req, res) => {
    res.json(await accounts.list(systemUserListQuerySchema.parse(req.query)));
  };

  const detail: RequestHandler = async (req, res) => {
    const { userId } = systemUserIdParamsSchema.parse(req.params);
    res.json(await accounts.detail(userId));
  };

  const create: RequestHandler = async (req, res) => {
    const body = createAccountRequestSchema.parse(req.body);
    res.status(201).json(await accounts.create(actorOf(req, res), body));
  };

  const update: RequestHandler = async (req, res) => {
    const { userId } = systemUserIdParamsSchema.parse(req.params);
    const patch = updateAccountRequestSchema.parse(req.body);
    res.json(await accounts.update(actorOf(req, res), userId, patch));
  };

  const resetPassword: RequestHandler = async (req, res) => {
    const { userId } = systemUserIdParamsSchema.parse(req.params);
    res.json(await accounts.resetPassword(actorOf(req, res), userId));
  };

  const signOut: RequestHandler = async (req, res) => {
    const { userId } = systemUserIdParamsSchema.parse(req.params);
    res.json(await accounts.signOut(actorOf(req, res), userId));
  };

  const setLock: RequestHandler = async (req, res) => {
    const { userId } = systemUserIdParamsSchema.parse(req.params);
    const body = setLockRequestSchema.parse(req.body);
    res.json(await accounts.setLock(actorOf(req, res), userId, body));
  };

  /** The organizations, for the create-account form: which have an account already. */
  const organizationTree: RequestHandler = async (_req, res) => {
    res.json(await organizations.tree());
  };

  const setLogo: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'logo: Send a PNG, JPEG or WebP image');
    }
    const { userId, ctx } = actorOf(req, res);
    res.json(await organizations.setLogo({ userId, ip: ctx.ip }, slug, body));
  };

  const supportDocuments: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    res.json(await support.listDocuments(slug));
  };

  const rescan: RequestHandler = async (req, res) => {
    const { documentId } = documentIdParamsSchema.parse(req.params);
    await support.rescan(actorOf(req, res), documentId);
    res.status(204).end();
  };

  const restore: RequestHandler = async (req, res) => {
    const { documentId } = documentIdParamsSchema.parse(req.params);
    await support.restore(actorOf(req, res), documentId);
    res.status(204).end();
  };

  const testData: RequestHandler = async (_req, res) => {
    res.json(await support.testDataPreview());
  };

  const deleteTestData: RequestHandler = async (req, res) => {
    const { expectedCount } = deleteTestDataRequestSchema.parse(req.body);
    res.json(await support.deleteTestData(actorOf(req, res), expectedCount));
  };

  const listRequests: RequestHandler = async (req, res) => {
    const { status } = systemAccountRequestListQuerySchema.parse(req.query);
    res.json(await requests.list(status));
  };

  const countRequests: RequestHandler = async (_req, res) => {
    res.json(await requests.count());
  };

  const getRequest: RequestHandler = async (req, res) => {
    const { requestId } = accountRequestIdParamsSchema.parse(req.params);
    res.json(await requests.get(requestId));
  };

  const declineRequest: RequestHandler = async (req, res) => {
    const { requestId } = accountRequestIdParamsSchema.parse(req.params);
    const body = declineAccountRequestSchema.parse(req.body);
    res.json(await requests.decline(actorOf(req, res), requestId, body));
  };

  const previewBulk: RequestHandler = async (req, res) => {
    const { csv } = accountCsvRequestSchema.parse(req.body);
    res.json(await imports.previewBulk(csv));
  };

  const bulkCreate: RequestHandler = async (req, res) => {
    const { csv } = accountCsvRequestSchema.parse(req.body);
    res.status(201).json(await imports.bulkCreate(actorOf(req, res), csv));
  };

  const previewEndOfTerm: RequestHandler = async (req, res) => {
    const { csv } = endOfTermRequestSchema.parse(req.body);
    res.json(await imports.previewEndOfTerm(csv));
  };

  /** Shows the ISSC account's new password once: never cached. */
  const endOfTerm: RequestHandler = async (req, res) => {
    const { csv, termEnd } = endOfTermRequestSchema.parse(req.body);
    res.json(await imports.endOfTerm(actorOf(req, res), csv, termEnd ?? null));
  };

  return {
    previewBulk,
    bulkCreate,
    previewEndOfTerm,
    endOfTerm,
    listRequests,
    countRequests,
    getRequest,
    declineRequest,
    list,
    detail,
    create,
    update,
    resetPassword,
    signOut,
    setLock,
    organizationTree,
    setLogo,
    supportDocuments,
    rescan,
    restore,
    testData,
    deleteTestData,
  };
}
