import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import type { Config } from '#src/config';
import type { LeaderboardStream } from '#src/lib/leaderboard-stream';
import type { Logger } from '#src/logger';
import { createErrorHandler, notFoundHandler } from '#src/middleware/error-handler';
import type { RateLimitStoreFactory } from '#src/middleware/rate-limit';
import { createOpenApiDocument } from '#src/openapi';
import { adminRouter } from '#src/routes/admin.routes';
import { announcementsRouter } from '#src/routes/announcements.routes';
import { complianceOverviewRouter } from '#src/routes/compliance-overview.routes';
import { appealsRouter } from '#src/routes/appeals.routes';
import { authRouter } from '#src/routes/auth.routes';
import { collegesRouter } from '#src/routes/colleges.routes';
import { documentsRouter } from '#src/routes/documents.routes';
import { healthRouter } from '#src/routes/health.routes';
import { leaderboardRouter } from '#src/routes/leaderboard.routes';
import { meRouter } from '#src/routes/me.routes';
import { organizationsRouter } from '#src/routes/organizations.routes';
import { projectsRouter } from '#src/routes/projects.routes';
import { reportsRouter } from '#src/routes/reports.routes';
import { searchRouter } from '#src/routes/search.routes';
import { systemRouter } from '#src/routes/system.routes';
import type { AccessVerifier } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { AccountAdminService } from '#src/services/account-admin.service';
import type { AccountImportService } from '#src/services/account-import.service';
import type { AccountRequestService } from '#src/services/account-request.service';
import type { AdminOrganizationService } from '#src/services/admin-organization.service';
import type { AnnouncementService } from '#src/services/announcement.service';
import type { ComplianceOverviewService } from '#src/services/compliance-overview.service';
import type { AppealService } from '#src/services/appeal.service';
import type { AuthService } from '#src/services/auth.service';
import type { CollegeService } from '#src/services/college.service';
import type { DashboardService } from '#src/services/dashboard.service';
import type { DocumentService } from '#src/services/document.service';
import type { FinancialFiguresService } from '#src/services/financial-figures.service';
import type { NotificationService } from '#src/services/notification.service';
import type { OrganizationService } from '#src/services/organization.service';
import type { ProjectService } from '#src/services/project.service';
import type { PublicLeaderboardService } from '#src/services/public-leaderboard.service';
import type { ReportService } from '#src/services/report.service';
import type { RevealService } from '#src/services/reveal.service';
import type { SearchService } from '#src/services/search.service';
import type { SuperAdminService } from '#src/services/super-admin.service';
import type { SupportService } from '#src/services/support.service';
import type { SystemService } from '#src/services/system.service';
import type { SystemSettingsService } from '#src/services/system-settings.service';
import type { UploadService } from '#src/services/upload.service';

export interface AppServices {
  auth: AuthService;
  /** Token verification plus the super admin session check (idle and 8-hour limits). */
  tokens: AccessVerifier;
  colleges: CollegeService;
  organizations: OrganizationService;
  documents: DocumentService;
  uploads: UploadService;
  access: AccessService;
  dashboard: DashboardService;
  projects: ProjectService;
  appeals: AppealService;
  notifications: NotificationService;
  reports: ReportService;
  search: SearchService;
  adminOrganizations: AdminOrganizationService;
  announcements: AnnouncementService;
  complianceOverview: ComplianceOverviewService;
  system: SystemService;
  superAdmins: SuperAdminService;
  /** /system accounts: creation, resets, locks (the super admin). */
  accountAdmin: AccountAdminService;
  /** /system file support and test data. */
  support: SupportService;
  /** One-time Reveals of temporary passwords (/me/reveals). */
  reveals: RevealService;
  /** The ISSC account's account requests (/admin asks, /system decides). */
  accountRequests: AccountRequestService;
  /** /system CSV imports: bulk creation and the end of term. */
  accountImports: AccountImportService;
  /** Financial Report figures: corrections (/projects) and the ISSC's review (/admin). */
  financialFigures: FinancialFiguresService;
  /** /system/settings, such as the leaderboard's late value. */
  systemSettings: SystemSettingsService;
  /** GET /leaderboard: the public boards (spec section 5). */
  leaderboard: PublicLeaderboardService;
  /** GET /leaderboard/stream: the open SSE streams of this instance. */
  leaderboardStream: Pick<LeaderboardStream, 'open'>;
}

export interface AppDeps {
  config: Pick<Config, 'WEB_ORIGIN' | 'NODE_ENV' | 'TRUST_PROXY'>;
  logger: Logger;
  services: AppServices;
  /** Redis in the app; omitted in tests that do not exercise rate limits (in-memory). */
  rateLimitStore?: RateLimitStoreFactory;
}

export function createApp({ config, logger, services, rateLimitStore }: AppDeps): Express {
  const app = express();
  // req.ip must be the client, not a proxy, for per-IP login limits (see TRUST_PROXY).
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  // CSV imports (/system: bulk accounts, end of term) carry up to 200 KB of text; everything
  // else stays at 100 KB. A body parsed here is not parsed again below.
  app.use(
    ['/api/v1/system/accounts/bulk', '/api/v1/system/end-of-term'],
    express.json({ limit: '256kb' }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/health', healthRouter());

  if (config.NODE_ENV === 'development') {
    const spec = createOpenApiDocument();
    app.get('/api/docs.json', (_req, res) => {
      res.json(spec);
    });
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec));
  }

  const v1 = express.Router();
  v1.use('/health', healthRouter());
  v1.use(
    '/auth',
    authRouter({
      auth: services.auth,
      tokens: services.tokens,
      webOrigin: config.WEB_ORIGIN,
      rateLimitStore,
    }),
  );
  v1.use('/colleges', collegesRouter(services.colleges));
  v1.use('/organizations', organizationsRouter(services.organizations));
  v1.use(
    '/leaderboard',
    leaderboardRouter({ leaderboard: services.leaderboard, stream: services.leaderboardStream }),
  );
  v1.use(
    '/me',
    meRouter({
      dashboard: services.dashboard,
      notifications: services.notifications,
      reveals: services.reveals,
      tokens: services.tokens,
    }),
  );
  v1.use('/search', searchRouter({ search: services.search, tokens: services.tokens }));
  v1.use(
    announcementsRouter({
      announcements: services.announcements,
      access: services.access,
      tokens: services.tokens,
    }),
  );
  v1.use(
    complianceOverviewRouter({ overview: services.complianceOverview, tokens: services.tokens }),
  );
  v1.use(
    '/admin',
    adminRouter({
      organizations: services.adminOrganizations,
      accountRequests: services.accountRequests,
      figures: services.financialFigures,
      access: services.access,
      tokens: services.tokens,
    }),
  );
  v1.use(
    '/system',
    systemRouter({
      system: services.system,
      superAdmins: services.superAdmins,
      accounts: services.accountAdmin,
      organizations: services.adminOrganizations,
      support: services.support,
      requests: services.accountRequests,
      imports: services.accountImports,
      settings: services.systemSettings,
      tokens: services.tokens,
    }),
  );
  v1.use(
    documentsRouter({
      documents: services.documents,
      uploads: services.uploads,
      access: services.access,
      tokens: services.tokens,
    }),
  );
  v1.use(
    projectsRouter({
      projects: services.projects,
      figures: services.financialFigures,
      access: services.access,
      tokens: services.tokens,
    }),
  );
  v1.use(
    appealsRouter({ appeals: services.appeals, access: services.access, tokens: services.tokens }),
  );
  v1.use(
    reportsRouter({ reports: services.reports, access: services.access, tokens: services.tokens }),
  );
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
