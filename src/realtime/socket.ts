import type { Server as HttpServer } from 'node:http';
import type { RequestHandler } from 'express';
import { Server as SocketServer } from 'socket.io';
import { createCorsOptions, isTrustedOrigin } from '../config/cors.js';
import { isSessionExpired, type SessionPayload } from '../config/session.js';
import { User } from '../models/user.model.js';
import { clearUserSendRateLimit, registerChatEvents } from './chat-events.js';
import type {
  ChatSocket,
  ChatSocketServer,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './events.js';
import { addUserConnection, removeUserConnection } from './presence.js';
import type { AppLogger } from '../utils/logger.js';

type SocketRequestWithSession = ChatSocket['request'] & {
  session?: Partial<SessionPayload>;
};

async function authenticateSocket(socket: ChatSocket): Promise<string> {
  const session = (socket.request as SocketRequestWithSession).session;
  if (!session?.userId || session.revokedAt || isSessionExpired(session)) {
    throw new Error('Authentication required');
  }

  const user = await User.findById(session.userId);
  if (!user || !user.isActive()) {
    throw new Error('Authentication required');
  }

  return user._id.toString();
}

export function attachSocketServer(
  httpServer: HttpServer,
  frontendOrigins: readonly string[],
  logger: AppLogger,
  sessionMiddleware: RequestHandler,
): ChatSocketServer {
  const io = new SocketServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: createCorsOptions(frontendOrigins),
    allowRequest: (request, callback) => {
      callback(null, isTrustedOrigin(frontendOrigins, request.headers.origin));
    },
    connectTimeout: 10_000,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1_000_000,
  });

  io.engine.use(sessionMiddleware);
  io.use((socket, next) => {
    void authenticateSocket(socket)
      .then((userId) => {
        socket.data.userId = userId;
        next();
      })
      .catch(() => next(new Error('Authentication required')));
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    void socket.join(`user:${userId}`);
    if (addUserConnection(userId, socket.id)) {
      io.emit('presence:update', { userId, isOnline: true });
    }
    registerChatEvents(io, socket, logger);
    logger.info('Socket connected');
    socket.on('disconnect', () => {
      if (removeUserConnection(userId, socket.id)) {
        clearUserSendRateLimit(userId);
        io.emit('presence:update', { userId, isOnline: false });
      }
      logger.info('Socket disconnected');
    });
  });

  return io;
}