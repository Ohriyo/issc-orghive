import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import type { Config } from '#src/config';
import type { Logger } from '#src/logger';
import { createErrorHandler, notFoundHandler } from '#src/middleware/error-handler';
import type { RateLimitStoreFactory } from '#src/middleware/rate-limit';
import { createOpenApiDocument } from '#src/openapi';
import { authRouter } from '#src/routes/auth.routes';
import { collegesRouter } from '#src/routes/colleges.routes';
import { documentsRouter } from '#src/routes/documents.routes';
import { healthRouter } from '#src/routes/health.routes';
import { organizationsRouter } from '#src/routes/organizations.routes';
import type { AccessService } from '#src/services/access.service';
import type { AuthService } from '#src/services/auth.service';
import type { CollegeService } from '#src/services/college.service';
import type { DocumentService } from '#src/services/document.service';
import type { OrganizationService } from '#src/services/organization.service';
import type { TokenService } from '#src/services/token.service';

export interface AppServices {
  auth: AuthService;
  tokens: Pick<TokenService, 'verify'>;
  colleges: CollegeService;
  organizations: OrganizationService;
  documents: DocumentService;
  access: AccessService;
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
    documentsRouter({
      documents: services.documents,
      access: services.access,
      tokens: services.tokens,
    }),
  );
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
