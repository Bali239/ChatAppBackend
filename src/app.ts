import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { DatabaseStatus } from './config/database.js';
import { createCorsOptions } from './config/cors.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { createAuthRouter, type AuthRouterOptions } from './routes/auth.routes.js';
import { createConversationsRouter } from './routes/conversations.routes.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createUploadsRouter } from './routes/uploads.routes.js';
import { createUsersRouter } from './routes/users.routes.js';
import type { Environment } from './schemas/env.schema.js';
import { sendErrorResponse } from './utils/error.js';
import { createHttpLogger, type AppLogger } from './utils/logger.js';

export interface AppOptions {
  frontendOrigins: readonly string[];
  environment: Environment['NODE_ENV'];
  logger: AppLogger;
  getDatabaseStatus: () => DatabaseStatus;
  authTokenSecret?: string;
  mongoUri?: string;
  cloudinary?: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    avatarUploadPreset: string;
  };
  auth?: Omit<AuthRouterOptions, 'tokenSecret'>;
}

export function createApp(options: AppOptions): Express {
  const tokenSecret = options.authTokenSecret ?? (
    options.environment === 'test' ? 'test-only-auth-token-secret-at-least-32-chars' : undefined
  );
  if (!tokenSecret) throw new Error('AUTH_TOKEN_SECRET is required');

  const app = express();
  app.disable('x-powered-by');
  app.set('env', options.environment);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors(createCorsOptions(options.frontendOrigins)));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(createHttpLogger(options.logger));

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_request, response) =>
        sendErrorResponse(response, 429, 'Too many requests', { code: 'RATE_LIMITED' }),
    }),
  );
  api.use(createHealthRouter(options.getDatabaseStatus));
  api.use('/auth', createAuthRouter({
    ...options.auth,
    tokenSecret,
  }));
  api.use('/users', createUsersRouter({
    tokenSecret,
    cloudinary: options.cloudinary,
    logger: options.logger,
  }));
  api.use('/conversations', createConversationsRouter(tokenSecret));
  api.use('/uploads', createUploadsRouter({ tokenSecret, cloudinary: options.cloudinary }));
  app.use(createHealthRouter(options.getDatabaseStatus));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(options.environment, options.logger));
  return app;
}
