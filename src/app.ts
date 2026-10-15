import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { DatabaseStatus } from './config/database.js';
import { createCorsOptions } from './config/cors.js';
import { createSessionMiddleware } from './config/session.js';
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
  sessionSecret?: string;
  sessionCookieName?: string;
  sessionMiddleware?: RequestHandler;
  mongoUri?: string;
  cloudinary?: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    avatarUploadPreset: string;
  };
  auth?: AuthRouterOptions;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
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
  app.use(cookieParser());
  const sessionMiddleware = options.sessionMiddleware ?? createSessionMiddleware({
    secret: options.sessionSecret ?? 'development-session-secret-change-me',
    cookieName: options.sessionCookieName ?? '__Host-chat_session',
    mongoUri: options.mongoUri,
    secure: options.environment === 'production',
    sameSite: options.environment === 'production' ? 'none' : 'lax',
    maxAge: options.auth?.sessionIdleTimeoutMs ?? 7 * 24 * 60 * 60 * 1000,
    isProduction: options.environment === 'production',
  });
  app.use(sessionMiddleware);
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
    cookieName: options.sessionCookieName,
  }));
  api.use('/users', createUsersRouter({ cloudinary: options.cloudinary, logger: options.logger }));
  api.use('/conversations', createConversationsRouter());
  api.use('/uploads', createUploadsRouter({ cloudinary: options.cloudinary }));
  app.use(createHealthRouter(options.getDatabaseStatus));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(options.environment, options.logger));
  return app;
}