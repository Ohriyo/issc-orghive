import { ConfigError, loadConfig, type Config } from '#src/config';
import { createLogger } from '#src/logger';
import { createApp } from '#src/app';
import { createRedis, createRedisCache } from '#src/lib/cache';
import { createBullQueue, createQueueConnection } from '#src/lib/queue';
import { createS3Storage } from '#src/lib/storage';
import { createSmtpMailer } from '#src/lib/mailer';
import { createArgon2Hasher } from '#src/lib/password';
import { createPublicUrl } from '#src/lib/public-url';
import { redisRateLimitStore } from '#src/middleware/rate-limit';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createCollegeRepository } from '#src/repositories/college.repository';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDashboardRepository } from '#src/repositories/dashboard.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createPasswordResetTokenRepository } from '#src/repositories/password-reset-token.repository';
import { createDb } from '#src/repositories/prisma';
import { createRefreshTokenRepository } from '#src/repositories/refresh-token.repository';
import { createUserRepository } from '#src/repositories/user.repository';
import { createAccessService } from '#src/services/access.service';
import { createAuthService } from '#src/services/auth.service';
import { createCollegeService } from '#src/services/college.service';
import { createDashboardService } from '#src/services/dashboard.service';
import { createDocumentService } from '#src/services/document.service';
import { createUploadService } from '#src/services/upload.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
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
const memberships = createMembershipRepository(db);
const documents = createDocumentRepository(db);
const dashboardReads = createDashboardRepository(db);
const audit = createAuditLogRepository(db);
const viewers = createDocumentViewerService({ memberships, organizations });
const storage = createS3Storage(config);
const queueConnection = createQueueConnection(config.REDIS_URL);
const jobs = createBullQueue(queueConnection);
const uploads = createUploadService({ intents: createUploadIntentRepository(db), storage });
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
      memberships,
      refreshTokens: createRefreshTokenRepository(db),
      resetTokens: createPasswordResetTokenRepository(db),
      audit,
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
    documents: createDocumentService({
      documents,
      documentTypes: createDocumentTypeRepository(db),
      organizations,
      viewers,
      uploads,
      queue: jobs,
      storage,
      audit,
      cache,
    }),
    uploads,
    access: createAccessService({ memberships, organizations, documents, viewers, audit }),
    dashboard: createDashboardService({
      memberships,
      dashboard: dashboardReads,
      documents,
      viewers,
      storage,
      publicUrl,
    }),
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
    void Promise.allSettled([
      db.$disconnect(),
      redis.quit(),
      jobs.queue.close(),
      queueConnection.quit(),
    ]).then(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
