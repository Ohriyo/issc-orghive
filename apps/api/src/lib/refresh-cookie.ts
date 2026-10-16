import type { CookieOptions } from 'express';

/** Name of the httpOnly cookie that carries the refresh token. */
export const REFRESH_COOKIE = 'orghive_rt';

/**
 * CLAUDE.md: httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth. The narrow path keeps
 * the cookie off every other request. Browsers accept Secure cookies on http://localhost.
 */
export const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/v1/auth',
};
