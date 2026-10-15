import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { createCorsOptions, isTrustedOrigin } from '../config/cors.js';
import type { AppLogger } from '../utils/logger.js';

export function attachSocketServer(
  httpServer: HttpServer,
  frontendOrigins: readonly string[],
  logger: AppLogger,
): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: createCorsOptions(frontendOrigins),
    allowRequest: (request, callback) => {
      callback(null, isTrustedOrigin(frontendOrigins, request.headers.origin));
    },
    connectTimeout: 10_000,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1_000_000,
  });

  io.on('connection', (socket) => {
    logger.info('Socket connected');
    socket.on('disconnect', () => logger.info('Socket disconnected'));
  });

  return io;
}