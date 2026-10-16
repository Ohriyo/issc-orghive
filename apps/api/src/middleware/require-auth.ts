import type { Request, RequestHandler, Response } from 'express';
import {
  documentIdParamsSchema,
  ErrorCode,
  slugParamsSchema,
  type MembershipRole,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { AccessContext, AccessService, OrgRef } from '#src/services/access.service';
import type { AccessClaims, TokenService } from '#src/services/token.service';

const AUTH_KEY = 'auth';
const ORG_KEY = 'org';

/** The verified claims `requireAuth` attached. Throws if a route forgot to use it. */
export function authOf(res: Response): AccessClaims {
  const claims = (res.locals as Record<string, unknown>)[AUTH_KEY];
  if (!claims) throw new Error('authOf() called on a route without requireAuth');
  return claims as AccessClaims;
}

export interface RequireAuthOptions {
  /**
   * Accept a token issued with a temporary password. Only the change-password route
   * (and /me, so the app can show who is signed in) sets this.
   */
  allowPasswordChange?: boolean;
}

/** The claims `optionalAuth` attached, or undefined for a signed-out request. */
export function maybeAuthOf(res: Response): AccessClaims | undefined {
  return (res.locals as Record<string, unknown>)[AUTH_KEY] as AccessClaims | undefined;
}

async function authenticate(
  req: Request,
  res: Response,
  tokens: Pick<TokenService, 'verify'>,
  allowPasswordChange: boolean,
) {
  const header = req.get('authorization');
  const match = header?.match(/^Bearer ([A-Za-z0-9_.-]+)$/);
  if (!match) throw AppError.unauthorized();

  const claims = await tokens.verify(match[1]!);
  if (claims.passwordChangeRequired && !allowPasswordChange) {
    throw new AppError(
      403,
      ErrorCode.PASSWORD_CHANGE_REQUIRED,
      'Change your temporary password before continuing',
    );
  }
  (res.locals as Record<string, unknown>)[AUTH_KEY] = claims;
}

/** Verifies `Authorization: Bearer <access token>`. */
export function requireAuth(
  tokens: Pick<TokenService, 'verify'>,
  { allowPasswordChange = false }: RequireAuthOptions = {},
): RequestHandler {
  return async (req, res, next) => {
    await authenticate(req, res, tokens, allowPasswordChange);
    next();
  };
}

/**
 * For public reads whose result depends on who is asking. No Authorization header means
 * signed out; a header that is present must still be valid (401 otherwise), so a broken
 * token never silently downgrades to the public view.
 */
export function optionalAuth(tokens: Pick<TokenService, 'verify'>): RequestHandler {
  return async (req, res, next) => {
    if (req.get('authorization') !== undefined) await authenticate(req, res, tokens, false);
    next();
  };
}

/** The organization an org guard resolved and authorized. Throws if no guard ran. */
export function orgOf(res: Response): OrgRef {
  const org = (res.locals as Record<string, unknown>)[ORG_KEY];
  if (!org) throw new Error('orgOf() called on a route without an org guard');
  return org as OrgRef;
}

/**
 * The target organization: from `:slug`, or from the owning organization of
 * `:documentId`. 404 when it does not exist (or the document is deleted).
 */
async function resolveOrg(access: AccessService, req: Request): Promise<OrgRef> {
  if (req.params.slug !== undefined) {
    const { slug } = slugParamsSchema.parse({ slug: req.params.slug });
    const org = await access.resolveBySlug(slug);
    if (!org) throw AppError.notFound('Organization not found');
    return org;
  }
  if (req.params.documentId !== undefined) {
    const { documentId } = documentIdParamsSchema.parse({ documentId: req.params.documentId });
    const org = await access.resolveByDocument(documentId);
    if (!org) throw AppError.notFound('Document not found');
    return org;
  }
  throw new Error('Org guards need a :slug or :documentId route param');
}

function contextOf(req: Request): AccessContext {
  // The route pattern (":documentId"), not the URL, and never the body.
  const pattern = (req.route as { path?: string } | undefined)?.path ?? '';
  return { method: req.method, route: `${req.baseUrl}${pattern}`, ip: req.ip };
}

/**
 * Guards for org-scoped routes. Use after `requireAuth` on every mutating route
 * (CLAUDE.md). Memberships are checked against the database with an active term, not
 * taken from the token. ISSC admins pass every guard; that override is audited.
 */
export function createOrgGuards(access: AccessService) {
  return {
    /** The user holds one of `roles` in the target organization. */
    requireOrgRole:
      (...roles: [MembershipRole, ...MembershipRole[]]): RequestHandler =>
      async (req, res, next) => {
        const claims = authOf(res);
        const org = await resolveOrg(access, req);
        await access.requireRole(claims.userId, org, roles, contextOf(req));
        (res.locals as Record<string, unknown>)[ORG_KEY] = org;
        next();
      },

    /** The user approves the target organization's documents (docs/DOMAIN_RULES.md). */
    requireApprover:
      (): RequestHandler =>
      async (req, res, next) => {
        const claims = authOf(res);
        const org = await resolveOrg(access, req);
        await access.requireApprover(claims.userId, org, contextOf(req));
        (res.locals as Record<string, unknown>)[ORG_KEY] = org;
        next();
      },
  };
}

export type OrgGuards = ReturnType<typeof createOrgGuards>;

