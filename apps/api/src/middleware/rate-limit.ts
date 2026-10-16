import type { Request, RequestHandler } from 'express';
import {
  ipKeyGenerator,
  rateLimit,
  type Options,
  type RateLimitInfo,
  type Store,
} from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { Redis } from 'ioredis';
import { ErrorCode, forgotPasswordRequestSchema, loginRequestSchema } from '@orghive/shared';
import { REFRESH_COOKIE } from '#src/lib/refresh-cookie';

/** Builds a store per limiter. Redis in the app (shared across API instances); memory when omitted. */
export type RateLimitStoreFactory = (prefix: string) => Store;

export function redisRateLimitStore(redis: Redis): RateLimitStoreFactory {
  return (prefix) =>
    new RedisStore({
      prefix: `rl:${prefix}:`,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<RedisReply>,
    });
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function clientIp(req: Request): string {
  // ipKeyGenerator groups IPv6 by /56, so one host cannot rotate through its own addresses.
  return ipKeyGenerator(req.ip ?? 'unknown');
}

function limiter(
  store: RateLimitStoreFactory | undefined,
  prefix: string,
  options: Pick<Options, 'windowMs' | 'limit' | 'keyGenerator'> &
    Partial<Pick<Options, 'skipSuccessfulRequests' | 'skip'>>,
): RequestHandler {
  return rateLimit({
    ...options,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Fail closed: if Redis is down, login is unavailable rather than unlimited.
    passOnStoreError: false,
    ...(store && { store: store(prefix) }),
    handler: (req, res, _next, opts) => {
      const resetTime = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime;
      const minutes = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 60_000))
        : Math.ceil(opts.windowMs / 60_000);
      res
        .status(429)
        .set('Cache-Control', 'no-store')
        .json({
          error: {
            code: ErrorCode.RATE_LIMITED,
            message: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
          },
        });
    },
  });
}

/** Rate limits for the auth routes. `store` is a factory so each limiter gets its own key prefix. */
export function authRateLimits(store?: RateLimitStoreFactory) {
  return {
    /**
     * 5 failed logins per 15 minutes per IP, and separately per account. Successful logins
     * do not count, so a shared campus IP is only blocked by repeated failures.
     */
    login: [
      limiter(store, 'login-ip', {
        windowMs: FIFTEEN_MINUTES,
        limit: 5,
        skipSuccessfulRequests: true,
        keyGenerator: clientIp,
      }),
      limiter(store, 'login-account', {
        windowMs: FIFTEEN_MINUTES,
        limit: 5,
        skipSuccessfulRequests: true,
        keyGenerator: (req) => {
          const parsed = loginRequestSchema.shape.email.safeParse(
            (req.body as { email?: unknown } | undefined)?.email,
          );
          return parsed.success ? `acct:${parsed.data}` : `ip:${clientIp(req)}`;
        },
      }),
    ],
    /** Reset emails: 5 per 15 minutes per IP and per address, counting every request. */
    forgotPassword: [
      limiter(store, 'forgot-ip', { windowMs: FIFTEEN_MINUTES, limit: 5, keyGenerator: clientIp }),
      limiter(store, 'forgot-account', {
        windowMs: FIFTEEN_MINUTES,
        limit: 5,
        keyGenerator: (req) => {
          const parsed = forgotPasswordRequestSchema.safeParse(req.body);
          return parsed.success ? `acct:${parsed.data.email}` : `ip:${clientIp(req)}`;
        },
      }),
    ],
    /** Guessing reset tokens or current passwords: 10 failures per 15 minutes per IP. */
    passwordChecks: limiter(store, 'password-checks', {
      windowMs: FIFTEEN_MINUTES,
      limit: 10,
      skipSuccessfulRequests: true,
      keyGenerator: clientIp,
    }),
    /**
     * Refresh runs on every page load. Requests without a refresh cookie (anonymous
     * visitors, most of a campus behind one IP) cost nothing and are not counted, so they
     * can never push a signed-in officer on the same IP over the limit.
     */
    refresh: limiter(store, 'refresh', {
      windowMs: 60 * 1000,
      limit: 60,
      keyGenerator: clientIp,
      skip: (req) => !(req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE],
    }),
  };
}
