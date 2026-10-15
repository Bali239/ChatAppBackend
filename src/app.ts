import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { DatabaseStatus } from './config/database.js';
import { createCorsOptions } from './config/cors.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { createHealthRouter } from './routes/health.routes.js';
import type { Environment } from './schemas/env.schema.js';
import { createHttpLogger, type AppLogger } from './utils/logger.js';

export interface AppOptions {
  frontendOrigins: readonly string[];
  environment: Environment['NODE_ENV'];
  logger: AppLogger;
  getDatabaseStatus: () => DatabaseStatus;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors(createCorsOptions(options.frontendOrigins)));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(createHttpLogger(options.logger));

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      },
    }),
  );
  api.use(createHealthRouter(options.getDatabaseStatus));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(options.environment, options.logger));
  return app;
}