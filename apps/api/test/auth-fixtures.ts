import { generateKeyPairSync } from 'node:crypto';
import argon2 from 'argon2';
import { pino } from 'pino';
import { memoryMailer } from '#src/lib/mailer';
import { createArgon2Hasher } from '#src/lib/password';
import { redisRateLimitStore } from '#src/middleware/rate-limit';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createPasswordResetTokenRepository } from '#src/repositories/password-reset-token.repository';
import type { Db } from '#src/repositories/prisma';
import { createRefreshTokenRepository } from '#src/repositories/refresh-token.repository';
import { createUserRepository } from '#src/repositories/user.repository';
import { createAuthService } from '#src/services/auth.service';
import { createTokenService } from '#src/services/token.service';
import { buildTestApp, TEST_WEB_ORIGIN } from './helpers';
import type { Redis } from 'ioredis';

/** A fresh Ed25519 pair per test run; no key is ever committed. */
export function testKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export const TEST_PASSWORD = 'correct horse battery staple';

/**
 * Still Argon2id, at a fraction of production cost (1 MiB, 1 pass), so the many logins in
 * the route tests stay fast when the whole monorepo suite runs in parallel. Production uses
 * createArgon2Hasher's defaults; test/password.test.ts covers those.
 */
export const TEST_ARGON2_COST = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

let hashed: Promise<string> | undefined;
/** Argon2id hash of TEST_PASSWORD, computed once per run. */
export function testPasswordHash(): Promise<string> {
  hashed ??= argon2.hash(TEST_PASSWORD, { type: argon2.argon2id, ...TEST_ARGON2_COST });
  return hashed;
}

export async function createUser(
  db: Db,
  email: string,
  { mustChangePassword = false, disabled = false } = {},
) {
  return db.user.create({
    data: {
      email,
      name: email.split('@')[0]!,
      passwordHash: await testPasswordHash(),
      mustChangePassword,
      disabledAt: disabled ? new Date() : null,
    },
  });
}

/** The real auth stack on the test database and test Redis, with mail captured in memory. */
export function buildAuthApp(
  db: Db,
  redis: Redis,
  {
    keys = testKeys(),
    trustProxy = false,
  }: { keys?: ReturnType<typeof testKeys>; trustProxy?: boolean | number } = {},
) {
  const tokens = createTokenService(keys);
  const mailer = memoryMailer();
  const auth = createAuthService({
    users: createUserRepository(db),
    memberships: createMembershipRepository(db),
    refreshTokens: createRefreshTokenRepository(db),
    resetTokens: createPasswordResetTokenRepository(db),
    audit: createAuditLogRepository(db),
    tokens,
    passwords: createArgon2Hasher({ cost: TEST_ARGON2_COST }),
    mailer,
    logger: pino({ level: 'silent' }),
    webOrigin: TEST_WEB_ORIGIN,
  });
  const app = buildTestApp(
    { auth, tokens },
    { TRUST_PROXY: trustProxy },
    redisRateLimitStore(redis),
  );
  return { app, tokens, mailer, keys };
}

/** The refresh token from a response's Set-Cookie, or undefined when cleared. */
export function refreshCookieOf(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? (raw as string[]) : [];
  const match = cookies.map((c) => /^orghive_rt=([^;]*)/.exec(c)).find(Boolean);
  return match?.[1] || undefined;
}

export function setCookieHeader(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  return (
    (Array.isArray(raw) ? (raw as string[]) : []).find((c) => c.startsWith('orghive_rt=')) ?? ''
  );
}
