import { createServer, type Server as HttpServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server as SocketServer } from 'socket.io';
import { createApp } from './src/app.js';
import { connectDatabase, disconnectDatabase, getDatabaseStatus } from './src/config/database.js';
import { loadEnvironment } from './src/config/env.js';
import type { Environment } from './src/schemas/env.schema.js';
import { attachSocketServer } from './src/realtime/socket.js';
import { createLogger, type AppLogger } from './src/utils/logger.js';

export interface ServerRuntime {
  httpServer: HttpServer;
  io: SocketServer;
  shutdown: () => Promise<void>;
}

export async function startServer(
  environment: Environment,
  logger: AppLogger,
): Promise<ServerRuntime> {
  let disconnectUserSockets: (userId: string) => void = () => undefined;
  const app = createApp({
    frontendOrigins: environment.FRONTEND_URL,
    environment: environment.NODE_ENV,
    logger,
    getDatabaseStatus,
    authTokenSecret: environment.AUTH_TOKEN_SECRET,
    cloudinary: environment.CLOUDINARY_CLOUD_NAME &&
      environment.CLOUDINARY_API_KEY &&
      environment.CLOUDINARY_API_SECRET &&
      environment.CLOUDINARY_AVATAR_UPLOAD_PRESET
      ? {
          cloudName: environment.CLOUDINARY_CLOUD_NAME,
          apiKey: environment.CLOUDINARY_API_KEY,
          apiSecret: environment.CLOUDINARY_API_SECRET,
          avatarUploadPreset: environment.CLOUDINARY_AVATAR_UPLOAD_PRESET,
        }
      : undefined,
    auth: {
      googleClientId: environment.GOOGLE_CLIENT_ID,
      googleClientSecret: environment.GOOGLE_CLIENT_SECRET,
      googleCallbackUrl: environment.GOOGLE_CALLBACK_URL,
      postLoginRedirectUrl: environment.POST_LOGIN_REDIRECT_URL,
      redirectAllowlist: environment.AUTH_REDIRECT_ALLOWLIST,
      onLogout: (userId) => disconnectUserSockets(userId),
    },
  });
  const httpServer = createServer(app);

  await connectDatabase(environment.MONGODB_URI, logger);
  const io = attachSocketServer(
    httpServer,
    environment.FRONTEND_URL,
    logger,
    environment.AUTH_TOKEN_SECRET,
  );
  disconnectUserSockets = (userId) => io.in(`user:${userId}`).disconnectSockets(true);

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error) => rejectListen(error);
      httpServer.once('error', onError);
      httpServer.listen(environment.PORT, '0.0.0.0', () => {
        httpServer.off('error', onError);
        resolveListen();
      });
    });
  } catch (error) {
    await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
    await disconnectDatabase(logger);
    logger.error(
      {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorCode:
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : undefined,
        syscall:
          error && typeof error === 'object' && 'syscall' in error
            ? String(error.syscall)
            : undefined,
        port: environment.PORT,
      },
      'HTTP server listen failed',
    );
    throw new Error('HTTP server failed to start');
  }

  const address = httpServer.address();
  const port = address && typeof address === 'object' ? address.port : environment.PORT;
  logger.info({ port }, 'HTTP and Socket.IO server listening');

  let shutdownPromise: Promise<void> | undefined;
  const onSignal = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Server shutdown requested');
    void shutdown().catch((error: unknown) => {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Server shutdown failed',
      );
      process.exitCode = 1;
    });
  };
  const onInterrupt = () => onSignal('SIGINT');
  const onTerminate = () => onSignal('SIGTERM');

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    shutdownPromise = (async () => {
      await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
      await disconnectDatabase(logger);
      logger.info('Server shutdown complete');
    })();

    return shutdownPromise;
  };

  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);

  return { httpServer, io, shutdown };
}

async function run(): Promise<void> {
  let logger = createLogger();

  try {
    const environment = loadEnvironment();
    logger = createLogger(environment.LOG_LEVEL);
    await startServer(environment, logger);
  } catch (error) {
    logger.fatal(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      error instanceof Error ? error.message : 'Server startup failed',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void run();
}
