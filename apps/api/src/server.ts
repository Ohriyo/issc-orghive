import { ConfigError, loadConfig, type Config } from '#src/config';
import { createLogger } from '#src/logger';
import { createApp } from '#src/app';
import { createRedis, createRedisCache } from '#src/lib/cache';
import { createSmtpMailer } from '#src/lib/mailer';
import { createArgon2Hasher } from '#src/lib/password';
import { createPublicUrl } from '#src/lib/public-url';
import { redisRateLimitStore } from '#src/middleware/rate-limit';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createCollegeRepository } from '#src/repositories/college.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createPasswordResetTokenRepository } from '#src/repositories/password-reset-token.repository';
import { createDb } from '#src/repositories/prisma';
import { createRefreshTokenRepository } from '#src/repositories/refresh-token.repository';
import { createUserRepository } from '#src/repositories/user.repository';
import { createAuthService } from '#src/services/auth.service';
import { createCollegeService } from '#src/services/college.service';
import { createOrganizationService } from '#src/services/organization.service';
import { createTokenService } from '#src/services/token.service';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(config);
const db = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
redis.on('error', (err) => logger.warn({ err }, 'Redis connection error'));

const cache = createRedisCache(redis, logger);
const publicUrl = createPublicUrl(config.PUBLIC_ASSET_BASE_URL);
const organizations = createOrganizationRepository(db);
const tokens = createTokenService({
  privateKeyPem: config.JWT_PRIVATE_KEY,
  publicKeyPem: config.JWT_PUBLIC_KEY,
});

const app = createApp({
  config,
  logger,
  rateLimitStore: redisRateLimitStore(redis),
  services: {
    tokens,
    auth: createAuthService({
      users: createUserRepository(db),
      memberships: createMembershipRepository(db),
      refreshTokens: createRefreshTokenRepository(db),
      resetTokens: createPasswordResetTokenRepository(db),
      audit: createAuditLogRepository(db),
      tokens,
      passwords: createArgon2Hasher(),
      mailer: createSmtpMailer(config),
      logger,
      webOrigin: config.WEB_ORIGIN,
    }),
    colleges: createCollegeService({
      colleges: createCollegeRepository(db),
      organizations,
      cache,
      publicUrl,
    }),
    organizations: createOrganizationService({ organizations, cache, publicUrl }),
  },
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
  if (config.NODE_ENV === 'development') {
    logger.info(`API docs at http://localhost:${config.PORT}/api/docs`);
  }
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void Promise.allSettled([db.$disconnect(), redis.quit()]).then(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
