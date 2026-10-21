import { ConfigError, loadConfig, type Config } from '#src/config';
import { createLogger } from '#src/logger';
import { createApp } from '#src/app';
import { createRedis, createRedisCache } from '#src/lib/cache';
import { createHash } from 'node:crypto';
import {
  createRedisLeaderboardEvents,
  subscribeLeaderboardChanges,
} from '#src/lib/leaderboard-events';
import { createRedisLeaderboardStore } from '#src/lib/leaderboard-store';
import { createLeaderboardStream } from '#src/lib/leaderboard-stream';
import {
  createBullLeaderboardQueue,
  createBullNotificationQueue,
  createBullQueue,
  createBullReportQueue,
  createQueueConnection,
} from '#src/lib/queue';
import { createChromiumRenderer } from '#src/lib/report-pdf';
import { createS3Storage } from '#src/lib/storage';
import { createSmtpMailer } from '#src/lib/mailer';
import { createArgon2Hasher } from '#src/lib/password';
import { createPublicUrl } from '#src/lib/public-url';
import { redisRateLimitStore } from '#src/middleware/rate-limit';
import { createAppealRepository } from '#src/repositories/appeal.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createOrgFreezeRepository } from '#src/repositories/org-freeze.repository';
import { createCollegeRepository } from '#src/repositories/college.repository';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDashboardRepository } from '#src/repositories/dashboard.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createPasswordResetTokenRepository } from '#src/repositories/password-reset-token.repository';
import { createDb } from '#src/repositories/prisma';
import { createRefreshTokenRepository } from '#src/repositories/refresh-token.repository';
import { createUserRepository } from '#src/repositories/user.repository';
import { createAccessService } from '#src/services/access.service';
import { createAppealService } from '#src/services/appeal.service';
import { createCompliance } from '#src/services/compliance.service';
import { createNotificationService } from '#src/services/notification.service';
import { createRecipients } from '#src/services/recipients.service';
import { createReportRepository } from '#src/repositories/report.repository';
import { createReportService } from '#src/services/report.service';
import { createAuthService } from '#src/services/auth.service';
import { createCollegeService } from '#src/services/college.service';
import { createDashboardService } from '#src/services/dashboard.service';
import { createDocumentPreviewService } from '#src/services/document-preview.service';
import { createDocumentService } from '#src/services/document.service';
import { createPageTokenService } from '#src/services/page-token.service';
import { createSearchService } from '#src/services/search.service';
import { createAnnouncementService } from '#src/services/announcement.service';
import { createAnnouncementRepository } from '#src/repositories/announcement.repository';
import { createComplianceOverviewService } from '#src/services/compliance-overview.service';
import { createComplianceOverviewRepository } from '#src/repositories/compliance-overview.repository';
import { createAdminOrganizationService } from '#src/services/admin-organization.service';
import { createAdminOrganizationRepository } from '#src/repositories/admin-organization.repository';
import { createProjectService } from '#src/services/project.service';
import { createProjectSync } from '#src/services/project-sync.service';
import { createUploadService } from '#src/services/upload.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
import { createOrganizationService } from '#src/services/organization.service';
import { createProfileService } from '#src/services/profile.service';
import { createConstitutionService } from '#src/services/constitution.service';
import { createProfileRepository } from '#src/repositories/profile.repository';
import { createHandbookRepository } from '#src/repositories/handbook.repository';
import { createHandbookService } from '#src/services/handbook.service';
import { createTokenService } from '#src/services/token.service';
import { createSecretBox } from '#src/lib/secret-box';
import { createRedisSuperAdminStore } from '#src/lib/super-admin-store';
import { createTotp } from '#src/lib/totp';
import { createRecoveryCodeRepository } from '#src/repositories/recovery-code.repository';
import { createSystemRepository } from '#src/repositories/system.repository';
import { createSuperAdminService } from '#src/services/super-admin.service';
import { createSessionGuard } from '#src/services/session-guard';
import { createAccountAdminRepository } from '#src/repositories/account-admin.repository';
import { createRevealRepository } from '#src/repositories/reveal.repository';
import { createAccountRequestRepository } from '#src/repositories/account-request.repository';
import { createAccountRequestService } from '#src/services/account-request.service';
import { createAccountImportRepository } from '#src/repositories/account-import.repository';
import { createAccountImportService } from '#src/services/account-import.service';
import { createSupportRepository } from '#src/repositories/support.repository';
import { createAccountAdminService } from '#src/services/account-admin.service';
import { createRevealService } from '#src/services/reveal.service';
import { createSupportService } from '#src/services/support.service';
import { createSystemService } from '#src/services/system.service';
import { createFinancialFiguresRepository } from '#src/repositories/financial-figures.repository';
import { createLeaderboardRepository } from '#src/repositories/leaderboard.repository';
import { createSystemSettingRepository } from '#src/repositories/system-setting.repository';
import { createFinancialFiguresService } from '#src/services/financial-figures.service';
import { createSystemSettingsService } from '#src/services/system-settings.service';
import { createLeaderboardRecompute } from '#src/services/leaderboard-recompute';
import { createLeaderboardService } from '#src/services/leaderboard.service';
import { createPublicLeaderboardService } from '#src/services/public-leaderboard.service';
import { createMyStandingService } from '#src/services/my-standing.service';
import { createDemoDataRepository } from '#src/repositories/demo-data.repository';
import { createDemoDataService } from '#src/services/demo-data.service';
import { demoDataStartAllowed } from '#src/services/demo-guard';

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
const demoReads = createDemoDataRepository(db);
// Demo data must never go live (docs/DEPLOYMENT.md): production refuses to start with it.
if (
  !(await demoDataStartAllowed({
    counts: () => demoReads.counts(),
    nodeEnv: config.NODE_ENV,
    allowDemoData: config.ALLOW_DEMO_DATA,
    logger,
  }))
) {
  await db.$disconnect();
  process.exit(1);
}
const redis = createRedis(config.REDIS_URL);
redis.on('error', (err) => logger.warn({ err }, 'Redis connection error'));

const cache = createRedisCache(redis, logger);
const publicUrl = createPublicUrl(config.PUBLIC_ASSET_BASE_URL);
const organizations = createOrganizationRepository(db);
const accounts = createAccountRepository(db);
const documents = createDocumentRepository(db);
const dashboardReads = createDashboardRepository(db);
const audit = createAuditLogRepository(db);
const viewers = createDocumentViewerService({ accounts });
const storage = createS3Storage(config);
const queueConnection = createQueueConnection(config.REDIS_URL);
const jobs = createBullQueue(queueConnection);
const uploads = createUploadService({ intents: createUploadIntentRepository(db), storage });
const documentTypes = createDocumentTypeRepository(db);
const projects = createProjectRepository(db);
const leaderboardQueue = createBullLeaderboardQueue(queueConnection);
// Changes queue a recompute; the worker runs it and publishes the change.
const recompute = createLeaderboardRecompute({ queue: leaderboardQueue, projects, logger });
const freezes = createOrgFreezeRepository(db);
const notificationQueue = createBullNotificationQueue(queueConnection);
const notifications = createNotificationService({
  notifications: createNotificationRepository(db),
  queue: notificationQueue,
  logger,
});
const recipients = createRecipients({ accounts, organizations });
const projectSync = createProjectSync({
  projects,
  leaderboard: recompute,
  compliance: createCompliance({ freezes, recipients, notifications, audit }),
});
const financialFigures = createFinancialFiguresService({
  figures: createFinancialFiguresRepository(db),
  projects,
  recipients,
  notifications,
  audit,
  leaderboard: recompute,
});
const systemSettings = createSystemSettingsService({
  settings: createSystemSettingRepository(db),
  audit,
  onLatePointsChanged: () => recompute.forOpenSemesters(),
});
const leaderboardReads = createLeaderboardRepository(db);
// Computes here only when the store misses a board (Redis restarted or the board expired).
const leaderboard = createLeaderboardService({
  leaderboard: leaderboardReads,
  settings: systemSettings,
  store: createRedisLeaderboardStore(redis, logger),
  events: createRedisLeaderboardEvents(redis, logger),
});
const publicLeaderboard = createPublicLeaderboardService({
  leaderboard,
  organizations: leaderboardReads,
  settings: systemSettings,
  cache,
  publicUrl,
});
const leaderboardStream = createLeaderboardStream({
  boards: (semester) => publicLeaderboard.boards(semester),
  logger,
});
// A subscribed connection can run nothing else, so it gets its own.
const leaderboardSubscriber = createRedis(config.REDIS_URL);
leaderboardSubscriber.on('error', (err) => logger.warn({ err }, 'Redis subscriber error'));
subscribeLeaderboardChanges(
  leaderboardSubscriber,
  logger,
  (semester) => void leaderboardStream.changed(semester),
).catch((err: unknown) => {
  logger.warn({ err }, 'Leaderboard changes could not be subscribed; streams get no updates');
});
const documentService = createDocumentService({
  documents,
  documentTypes,
  organizations,
  viewers,
  uploads,
  queue: jobs,
  storage,
  audit,
  cache,
  leaderboard: recompute,
});
const documentPreviews = createDocumentPreviewService({
  documents,
  viewers,
  pageTokens: createPageTokenService({
    privateKeyPem: config.JWT_PRIVATE_KEY,
    publicKeyPem: config.JWT_PUBLIC_KEY,
  }),
  storage,
});
const handbook = createHandbookService({
  handbooks: createHandbookRepository(db),
  documents,
  documentTypes,
  organizations,
  viewers,
  uploads,
  queue: jobs,
  storage,
  audit,
  cache,
});
const search = createSearchService({ documents, viewers, storage, cache, handbook });
const announcementRepository = createAnnouncementRepository(db);
const announcements = createAnnouncementService({
  announcements: announcementRepository,
  organizations,
  accounts,
  audit,
  cache,
  notifications,
  logger,
});
const complianceOverview = createComplianceOverviewService({
  overview: createComplianceOverviewRepository(db),
  accounts,
});
const adminOrganizationReads = createAdminOrganizationRepository(db);
const adminOrganizations = createAdminOrganizationService({
  admin: adminOrganizationReads,
  audit,
  cache,
  storage,
  publicUrl,
  leaderboard: recompute,
});
const reportQueue = createBullReportQueue(queueConnection);
// The API only queues reports; the worker renders them (src/worker.ts).
const reports = createReportService({
  reports: createReportRepository(db),
  documents,
  documentTypes,
  storage,
  queue: reportQueue,
  renderer: () => createChromiumRenderer(config.CHROMIUM_EXECUTABLE_PATH),
  sha256: (bytes) => createHash('sha256').update(bytes).digest('hex'),
  notifications,
  audit,
  cache,
  logger,
});
const tokens = createTokenService({
  privateKeyPem: config.JWT_PRIVATE_KEY,
  publicKeyPem: config.JWT_PUBLIC_KEY,
});

const users = createUserRepository(db);
const refreshTokens = createRefreshTokenRepository(db);
const passwords = createArgon2Hasher();
const mailer = createSmtpMailer(config);
const systemReads = createSystemRepository(db);
if (!config.MFA_ENCRYPTION_KEY) {
  logger.warn('MFA_ENCRYPTION_KEY is not set: super admins cannot sign in');
}
const secrets = config.MFA_ENCRYPTION_KEY ? createSecretBox(config.MFA_ENCRYPTION_KEY) : null;
const accountAdminReads = createAccountAdminRepository(db);
const accountRequestReads = createAccountRequestRepository(db);
const reveals = createRevealService({
  reveals: createRevealRepository(db),
  secrets,
  notifications,
  audit,
});
const superAdmins = createSuperAdminService({
  users,
  recoveryCodes: createRecoveryCodeRepository(db),
  system: systemReads,
  refreshTokens,
  store: createRedisSuperAdminStore(redis),
  totp: createTotp(),
  secrets,
  passwords,
  audit,
  mailer,
  logger,
});
const queues = [
  { name: 'documents', queue: jobs.queue },
  { name: 'notifications', queue: notificationQueue.queue },
  { name: 'reports', queue: reportQueue.queue },
  { name: 'leaderboard', queue: leaderboardQueue.queue },
];

// The API only reports and removes demo data; db:seed:demo writes it.
const demoData = createDemoDataService({
  demo: demoReads,
  standings: leaderboardReads,
  settings: systemSettings,
  store: createRedisLeaderboardStore(redis, logger),
  storage,
  cache,
  audit,
  standingsChanged: (dates) => recompute.forEventDates(...dates),
  fileFor: () => {
    throw new Error('Demo data is seeded with pnpm --filter api db:seed:demo only');
  },
  showBadge: config.SHOW_DEMO_BADGE,
});

const app = createApp({
  config,
  logger,
  rateLimitStore: redisRateLimitStore(redis),
  services: {
    tokens: {
      verify: (token) => tokens.verify(token),
      checkSession: createSessionGuard({ accounts, superAdmins }),
    },
    auth: createAuthService({
      users,
      accounts,
      refreshTokens,
      resetTokens: createPasswordResetTokenRepository(db),
      audit,
      tokens,
      superAdmins,
      passwords,
      mailer,
      logger,
      webOrigin: config.WEB_ORIGIN,
    }),
    superAdmins,
    system: createSystemService({
      system: systemReads,
      accounts: accountAdminReads,
      refreshTokens,
      audit,
      queues: () =>
        Promise.all(
          queues.map(async ({ name, queue }) => {
            const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
            return {
              name,
              waiting: counts.waiting ?? 0,
              active: counts.active ?? 0,
              delayed: counts.delayed ?? 0,
              failed: counts.failed ?? 0,
            };
          }),
        ),
      logger,
    }),
    colleges: createCollegeService({
      colleges: createCollegeRepository(db),
      organizations,
      cache,
      publicUrl,
    }),
    organizations: createOrganizationService({ organizations, cache, publicUrl }),
    profiles: createProfileService({
      profiles: createProfileRepository(db),
      storage,
      audit,
      cache,
      publicUrl,
    }),
    handbook,
    constitutions: createConstitutionService({
      organizations,
      documents,
      documentTypes,
      viewers,
      uploads,
      queue: jobs,
      audit,
      cache,
    }),
    documents: documentService,
    documentPreviews,
    uploads,
    access: createAccessService({
      accounts,
      organizations,
      documents,
      projects,
      announcements: announcementRepository,
    }),
    dashboard: createDashboardService({
      accounts,
      dashboard: dashboardReads,
      documents,
      viewers,
      projects,
      storage,
      publicUrl,
    }),
    projects: createProjectService({
      projects,
      sync: projectSync,
      freezes,
      documents: documentService,
      documentReads: documents,
      documentTypes,
      uploads,
      viewers,
      figures: financialFigures,
      audit,
      leaderboard: recompute,
    }),
    appeals: createAppealService({
      appeals: createAppealRepository(db),
      projects,
      freezes,
      sync: projectSync,
      accounts,
      recipients,
      notifications,
      uploads,
      queue: jobs,
      storage,
      audit,
      leaderboard: recompute,
    }),
    notifications,
    reports,
    search,
    adminOrganizations,
    announcements,
    complianceOverview,
    reveals,
    accountAdmin: createAccountAdminService({
      accounts: accountAdminReads,
      accountReads: accounts,
      orgReads: adminOrganizationReads,
      organizations: adminOrganizations,
      audits: systemReads,
      requests: accountRequestReads,
      reveals,
      passwords,
      audit,
      emailDomains: config.ACCOUNT_EMAIL_DOMAINS,
    }),
    accountRequests: createAccountRequestService({
      requests: accountRequestReads,
      orgReads: adminOrganizationReads,
      superAdmins: systemReads,
      mailer,
      notifications,
      audit,
      logger,
      webOrigin: config.WEB_ORIGIN,
      emailDomains: config.ACCOUNT_EMAIL_DOMAINS,
    }),
    accountImports: createAccountImportService({
      imports: createAccountImportRepository(db),
      reveals,
      passwords,
      audit,
      emailDomains: config.ACCOUNT_EMAIL_DOMAINS,
    }),
    support: createSupportService({
      support: createSupportRepository(db),
      queue: jobs,
      cache,
      audit,
    }),
    financialFigures,
    systemSettings,
    leaderboard: publicLeaderboard,
    leaderboardStream,
    myStanding: createMyStandingService({
      accounts,
      leaderboard: publicLeaderboard,
      projects: leaderboardReads,
    }),
    demoData,
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
  // Open streams would keep server.close waiting; browsers reconnect to another instance.
  leaderboardStream.closeAll();
  server.close(() => {
    void Promise.allSettled([
      // QUIT is allowed on a subscribed connection.
      leaderboardSubscriber.quit(),
      db.$disconnect(),
      redis.quit(),
      jobs.queue.close(),
      notificationQueue.queue.close(),
      reportQueue.queue.close(),
      leaderboardQueue.queue.close(),
      queueConnection.quit(),
    ]).then(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
