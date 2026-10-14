import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Config } from '#src/config';
import type { Logger } from '#src/logger';
import { createErrorHandler, notFoundHandler } from '#src/middleware/error-handler';
import { healthRouter } from '#src/routes/health.routes';

export interface AppDeps {
  config: Pick<Config, 'WEB_ORIGIN'>;
  logger: Logger;
}

export function createApp({ config, logger }: AppDeps): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', healthRouter());

  const v1 = express.Router();
  v1.use('/health', healthRouter());
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
