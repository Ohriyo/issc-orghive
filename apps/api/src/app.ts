import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import type { Config } from '#src/config';
import type { LeaderboardStream } from '#src/lib/leaderboard-stream';
import type { Metrics } from '#src/lib/metrics';
import type { Logger } from '#src/logger';
import { createErrorHandler, notFoundHandler } from '#src/middleware/error-handler';
import { metricsMiddleware } from '#src/middleware/metrics';
import type { RateLimitStoreFactory } from '#src/middleware/rate-limit';
import { createOpenApiDocument } from '#src/openapi';
import { adminRouter } from '#src/routes/admin.routes';
import { announcementsRouter } from '#src/routes/announcements.routes';
import { orgPostsRouter } from '#src/routes/org-posts.routes';
import { orgShowcaseRouter } from '#src/routes/org-showcase.routes';
import { complianceOverviewRouter } from '#src/routes/compliance-overview.routes';
import { taskFileDecisionsRouter } from '#src/routes/task-file-decisions.routes';
import { appealsRouter } from '#src/routes/appeals.routes';
import { authRouter } from '#src/routes/auth.routes';
import { collegesRouter } from '#src/routes/colleges.routes';
import { documentsRouter } from '#src/routes/documents.routes';
import { healthRouter } from '#src/routes/health.routes';
import { leaderboardRouter, semestersRouter } from '#src/routes/leaderboard.routes';
import { demoRouter } from '#src/routes/demo.routes';
import { meRouter } from '#src/routes/me.routes';
import { organizationsRouter } from '#src/routes/organizations.routes';
import { profileRouter } from '#src/routes/profile.routes';
import { handbookRouter } from '#src/routes/handbook.routes';
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
import type { OrgPostService } from '#src/services/org-post.service';
import type { OrgShowcaseService } from '#src/services/org-showcase.service';
import type { ComplianceOverviewService } from '#src/services/compliance-overview.service';
import type { TaskFileDecisionService } from '#src/services/task-file-decision.service';
import type { ConstitutionService } from '#src/services/constitution.service';
import type { AppealService } from '#src/services/appeal.service';
import type { AuthService } from '#src/services/auth.service';
import type { CollegeService } from '#src/services/college.service';
import type { DashboardService } from '#src/services/dashboard.service';
import type { DemoDataService } from '#src/services/demo-data.service';
import type { DocumentPreviewService } from '#src/services/document-preview.service';
import type { DocumentService } from '#src/services/document.service';
import type { FinancialFiguresService } from '#src/services/financial-figures.service';
import type { NotificationService } from '#src/services/notification.service';
import type { OrganizationService } from '#src/services/organization.service';
import type { MyStandingService } from '#src/services/my-standing.service';
import type { ProfileService } from '#src/services/profile.service';
import type { HandbookService } from '#src/services/handbook.service';
import type { ProjectService } from '#src/services/project.service';
import type { TaskTemplateService } from '#src/services/task-template.service';
import type { DisqualificationService } from '#src/services/disqualification.service';
import type { PublicLeaderboardService } from '#src/services/public-leaderboard.service';
import type { SemesterCalendarService } from '#src/services/semester-calendar.service';
import type { ReportService } from '#src/services/report.service';
import type { RevealService } from '#src/services/reveal.service';
import type { SearchService } from '#src/services/search.service';
import type { SuperAdminService } from '#src/services/super-admin.service';
import type { SupportService } from '#src/services/support.service';
import type { SystemService } from '#src/services/system.service';
import type { SystemSettingsService } from '#src/services/system-settings.service';
import type { SystemHealthService } from '#src/services/system-health.service';
import type { SystemMetricsService } from '#src/services/system-metrics.service';
import type { SystemAlertService } from '#src/services/system-alert.service';
import type { UploadService } from '#src/services/upload.service';

export interface AppServices {
  auth: AuthService;
  /** Token verification plus the super admin session check (idle and 8-hour limits). */
  tokens: AccessVerifier;
  colleges: CollegeService;
  organizations: OrganizationService;
  /** /dashboard/profile: the organization's own profile, logo and cover. */
  profiles: ProfileService;
  /** Each organization's Constitution & By-laws. */
  constitutions: ConstitutionService;
  /** The Student Handbook: public reads (/handbook) and the ISSC's uploads (/admin). */
  handbook: HandbookService;
  documents: DocumentService;
  /** The view-only viewer: page lists, page tokens and watermarked page images. */
  documentPreviews: DocumentPreviewService;
  uploads: UploadService;
  access: AccessService;
  dashboard: DashboardService;
  projects: ProjectService;
  /** Project task templates with their QR codes (spec section 6). */
  taskTemplates: TaskTemplateService;
  /** Governing bodies clear a task file's warnings or flag it invalid (spec section 6). */
  taskFileDecisions: TaskFileDecisionService;
  appeals: AppealService;
  notifications: NotificationService;
  reports: ReportService;
  search: SearchService;
  adminOrganizations: AdminOrganizationService;
  announcements: AnnouncementService;
  /** Organization posts: updates and highlights on /orgs/:slug, and their moderation. */
  posts: OrgPostService;
  /** The organization page's rank badge, completed projects and public documents. */
  showcase: OrgShowcaseService;
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
  /** GET /semesters and /admin/semesters: the semester calendar (spec 5B). */
  semesters: SemesterCalendarService;
  /** /admin/disqualifications: the ISSC account's penalty (spec 5B). */
  disqualifications: DisqualificationService;
  /** GET /leaderboard: the public boards (spec section 5). */
  leaderboard: PublicLeaderboardService;
  /** GET /leaderboard/stream: the open SSE streams of this instance. */
  leaderboardStream: Pick<LeaderboardStream, 'open'>;
  /** GET /me/leaderboard: the signed-in organization's own standing. */
  myStanding: Pick<MyStandingService, 'forUser'>;
  /** Demo data: the public "Sample data" chip and its removal in /system. */
  demoData: Pick<DemoDataService, 'preview' | 'remove' | 'status'>;
  /** /system/health: live checks of every service Orghive depends on. */
  systemHealth: Pick<SystemHealthService, 'check'>;
  /** /system/metrics: charts and slow lists from the 1-minute snapshots. */
  systemMetrics: Pick<SystemMetricsService, 'read'>;
  /** /system/alerts: the console banner. */
  systemAlerts: Pick<SystemAlertService, 'listOpen'>;
}

export interface AppDeps {
  config: Pick<Config, 'WEB_ORIGIN' | 'NODE_ENV' | 'TRUST_PROXY'>;
  logger: Logger;
  services: AppServices;
  /** Redis in the app; omitted in tests that do not exercise rate limits (in-memory). */
  rateLimitStore?: RateLimitStoreFactory;
  /** Request timing for /system/metrics; omitted in tests that do not measure. */
  metrics?: Pick<Metrics, 'recordRequest'>;
}

export function createApp({ config, logger, services, rateLimitStore, metrics }: AppDeps): Express {
  const app = express();
  // req.ip must be the client, not a proxy, for per-IP login limits (see TRUST_PROXY).
  app.set('trust proxy', config.TRUST_PROXY);
  // First, so every response is timed, errors included.
  if (metrics) app.use(metricsMiddleware(metrics));

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
  v1.use(
    profileRouter({
      profiles: services.profiles,
      constitutions: services.constitutions,
      access: services.access,
      tokens: services.tokens,
    }),
  );
  v1.use('/organizations', organizationsRouter(services.organizations));
  v1.use('/handbook', handbookRouter(services.handbook));
  v1.use('/demo-status', demoRouter(services.demoData));
  v1.use('/semesters', semestersRouter(services.semesters));
  v1.use(
    '/leaderboard',
    leaderboardRouter({ leaderboard: services.leaderboard, stream: services.leaderboardStream }),
  );
  v1.use(
    '/me',
    meRouter({
      dashboard: services.dashboard,
      standing: services.myStanding,
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
    orgPostsRouter({
      posts: services.posts,
      access: services.access,
      tokens: services.tokens,
      webOrigin: config.WEB_ORIGIN,
    }),
  );
  v1.use(orgShowcaseRouter({ showcase: services.showcase }));
  v1.use(
    complianceOverviewRouter({ overview: services.complianceOverview, tokens: services.tokens }),
  );
  v1.use(
    taskFileDecisionsRouter({ decisions: services.taskFileDecisions, tokens: services.tokens }),
  );
  v1.use(
    '/admin',
    adminRouter({
      organizations: services.adminOrganizations,
      accountRequests: services.accountRequests,
      figures: services.financialFigures,
      handbook: services.handbook,
      semesters: services.semesters,
      disqualifications: services.disqualifications,
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
      demoData: services.demoData,
      health: services.systemHealth,
      metrics: services.systemMetrics,
      alerts: services.systemAlerts,
      tokens: services.tokens,
    }),
  );
  v1.use(
    documentsRouter({
      documents: services.documents,
      previews: services.documentPreviews,
      uploads: services.uploads,
      access: services.access,
      tokens: services.tokens,
      rateLimitStore,
    }),
  );
  v1.use(
    projectsRouter({
      projects: services.projects,
      figures: services.financialFigures,
      templates: services.taskTemplates,
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
