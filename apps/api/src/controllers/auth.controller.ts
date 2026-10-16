import type { Request, RequestHandler, Response } from 'express';
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS as refreshCookie } from '#src/lib/refresh-cookie';
import { authOf } from '#src/middleware/require-auth';
import type {
  AuthService,
  IssuedRefreshToken,
  RequestContext,
  SessionResult,
} from '#src/services/auth.service';

function context(req: Request): RequestContext {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

function refreshTokenOf(req: Request): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
}

function setRefreshCookie(res: Response, refresh: IssuedRefreshToken) {
  res.cookie(REFRESH_COOKIE, refresh.token, { ...refreshCookie, expires: refresh.expiresAt });
}

function sendSession(res: Response, session: SessionResult) {
  setRefreshCookie(res, session.refresh);
  res.json(session.auth);
}

export function createAuthController(auth: AuthService) {
  const login: RequestHandler = async (req, res) => {
    const body = loginRequestSchema.parse(req.body);
    sendSession(res, await auth.login(body, context(req)));
  };

  const refresh: RequestHandler = async (req, res) => {
    const token = refreshTokenOf(req);
    if (!token) throw AppError.unauthorized('Sign in to continue');
    try {
      sendSession(res, await auth.refresh(token, context(req)));
    } catch (err) {
      // A dead session's cookie is useless; drop it so the browser stops sending it.
      res.clearCookie(REFRESH_COOKIE, refreshCookie);
      throw err;
    }
  };

  const logout: RequestHandler = async (req, res) => {
    await auth.logout(refreshTokenOf(req), context(req));
    res.clearCookie(REFRESH_COOKIE, refreshCookie);
    res.status(204).end();
  };

  const forgotPassword: RequestHandler = async (req, res) => {
    const { email } = forgotPasswordRequestSchema.parse(req.body);
    await auth.requestPasswordReset(email, context(req));
    // Same answer whether or not the email is registered.
    res.status(202).json({ message: 'If that email has an account, a reset link is on its way.' });
  };

  const resetPassword: RequestHandler = async (req, res) => {
    const body = resetPasswordRequestSchema.parse(req.body);
    await auth.resetPassword(body, context(req));
    res.clearCookie(REFRESH_COOKIE, refreshCookie);
    res.status(204).end();
  };

  const changePassword: RequestHandler = async (req, res) => {
    const body = changePasswordRequestSchema.parse(req.body);
    sendSession(res, await auth.changePassword(authOf(res).userId, body, context(req)));
  };

  const me: RequestHandler = async (_req, res) => {
    res.json(await auth.me(authOf(res).userId));
  };

  return { login, refresh, logout, forgotPassword, resetPassword, changePassword, me };
}
