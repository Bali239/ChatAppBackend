import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { createCorsOptions, isTrustedOrigin } from '../config/cors.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { User } from '../models/user.model.js';
import { AuthSession } from '../models/auth-session.model.js';
import { registerChatEvents } from './chat-events.js';
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

async function authenticateSocket(socket: ChatSocket, tokenSecret: string): Promise<void> {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string') throw new Error('Authentication required');
  const claims = verifyAccessToken(token, tokenSecret);
  const session = await AuthSession.findOne({
    sessionId: claims.sessionId,
    userId: claims.userId,
    tokenVersion: claims.tokenVersion,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).select('_id');
  const user = await User.findById(claims.userId);
  if (
    !session ||
    !user ||
    !user.isActive() ||
    (user.authTokenVersion ?? 0) !== claims.tokenVersion
  ) {
    throw new Error('Authentication required');
  }
  socket.data.userId = user._id.toString();
  socket.data.sessionId = claims.sessionId;
  socket.data.tokenVersion = claims.tokenVersion;
  socket.data.tokenExpiresAt = claims.expiresAt;
}

export function attachSocketServer(
  httpServer: HttpServer,
  frontendOrigins: readonly string[],
  logger: AppLogger,
  tokenSecret: string,
  geminiApiKey?: string,
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

  io.use((socket, next) => {
    void authenticateSocket(socket, tokenSecret)
      .then(() => next())
      .catch(() => next(new Error('Authentication required')));
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    void socket.join(`session:${socket.data.sessionId}`);
    void socket.join(`user:${userId}`);
    if (addUserConnection(userId, socket.id)) {
      io.emit('presence:update', { userId, isOnline: true });
    }
    registerChatEvents(io, socket, logger, geminiApiKey);
    logger.info('Socket connected');
    socket.on('disconnect', () => {
      if (removeUserConnection(userId, socket.id)) {
        io.emit('presence:update', { userId, isOnline: false });
      }
      logger.info('Socket disconnected');
    });
  });

  return io;
}
