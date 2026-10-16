import type { ChatSocket, ChatSocketServer, MessageAcknowledgement, SocketError } from './events.js';
import {
  conversationPayloadSchema,
  messagePositionPayloadSchema,
  messageSendPayloadSchema,
} from './events.js';
import { Conversation } from '../models/conversation.model.js';
import { ConversationMember } from '../models/conversation-member.model.js';
import { Message } from '../models/message.model.js';
import { User } from '../models/user.model.js';
import { AuthSession } from '../models/auth-session.model.js';
import { acknowledgeMessageDelivered, persistMessage } from '../services/message.service.js';
import { markConversationRead } from '../services/message-history.service.js';
import { AppError } from '../utils/error.js';
import type { AppLogger } from '../utils/logger.js';

const SENDS_PER_WINDOW = 20;
const SEND_WINDOW_MS = 10_000;
const TYPING_EXPIRY_MS = 5_000;
const TYPING_THROTTLE_MS = 250;

interface TypingEntry {
  socketIds: Set<string>;
  recipientIds: string[];
  timeout: NodeJS.Timeout;
}

const sendTimesByUser = new Map<string, number[]>();
const lastTypingEventBySocket = new Map<string, number>();
const typingByConversationAndUser = new Map<string, TypingEntry>();

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function typingKey(conversationId: string, userId: string): string {
  return `${conversationId}:${userId}`;
}

function toSocketError(error: unknown): SocketError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'REQUEST_FAILED', message: 'The request could not be completed' };
}

async function assertSocketSession(socket: ChatSocket): Promise<void> {
  const user = await User.findById(socket.data.userId);
  const session = await AuthSession.findOne({
    sessionId: socket.data.sessionId,
    userId: socket.data.userId,
    tokenVersion: socket.data.tokenVersion,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).select('_id');
  if (
    !session ||
    !user ||
    !user.isActive() ||
    (user.authTokenVersion ?? 0) !== socket.data.tokenVersion
  ) {
    socket.disconnect(true);
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
  }
}

function allowMessageSend(userId: string): boolean {
  const now = Date.now();
  const recentSends = (sendTimesByUser.get(userId) ?? [])
    .filter((sentAt) => now - sentAt < SEND_WINDOW_MS);
  if (recentSends.length >= SENDS_PER_WINDOW) {
    sendTimesByUser.set(userId, recentSends);
    return false;
  }
  recentSends.push(now);
  sendTimesByUser.set(userId, recentSends);
  return true;
}

export function clearUserSendRateLimit(userId: string): void {
  sendTimesByUser.delete(userId);
}

function emitTypingUpdate(
  io: ChatSocketServer,
  recipientIds: readonly string[],
  conversationId: string,
  userId: string,
  isTyping: boolean,
): void {
  for (const recipientId of recipientIds) {
    io.to(userRoom(recipientId)).emit('typing:update', { conversationId, userId, isTyping });
  }
}

function stopTypingForSocket(
  io: ChatSocketServer,
  socket: ChatSocket,
  conversationId: string,
): void {
  socket.data.typingConversationIds = socket.data.typingConversationIds.filter(
    (activeConversationId) => activeConversationId !== conversationId,
  );
  const key = typingKey(conversationId, socket.data.userId);
  const entry = typingByConversationAndUser.get(key);
  if (!entry) return;

  entry.socketIds.delete(socket.id);
  if (entry.socketIds.size > 0) return;

  clearTimeout(entry.timeout);
  typingByConversationAndUser.delete(key);
  emitTypingUpdate(io, entry.recipientIds, conversationId, socket.data.userId, false);
}

async function updateTyping(
  io: ChatSocketServer,
  socket: ChatSocket,
  conversationId: string,
  isTyping: boolean,
): Promise<void> {
  await assertSocketSession(socket);
  const now = Date.now();
  const lastEventAt = lastTypingEventBySocket.get(socket.id) ?? 0;
  if (isTyping && now - lastEventAt < TYPING_THROTTLE_MS) return;
  if (isTyping) lastTypingEventBySocket.set(socket.id, now);

  if (!isTyping) {
    stopTypingForSocket(io, socket, conversationId);
    return;
  }

  const member = await ConversationMember.findOne({
    conversationId,
    userId: socket.data.userId,
  }).select('_id').lean();
  const conversation = member
    ? await Conversation.findById(conversationId).select('participantIds').lean()
    : null;
  if (!member || !conversation) {
    throw new AppError(403, 'CONVERSATION_FORBIDDEN', 'You cannot type in this conversation');
  }

  const recipientIds = conversation.participantIds
    .map((participantId) => participantId.toString())
    .filter((participantId) => participantId !== socket.data.userId);
  const key = typingKey(conversationId, socket.data.userId);
  const existingEntry = typingByConversationAndUser.get(key);
  if (existingEntry) {
    clearTimeout(existingEntry.timeout);
    existingEntry.socketIds.add(socket.id);
    if (!socket.data.typingConversationIds.includes(conversationId)) {
      socket.data.typingConversationIds.push(conversationId);
    }
    existingEntry.timeout = setTimeout(() => {
      typingByConversationAndUser.delete(key);
      emitTypingUpdate(io, recipientIds, conversationId, socket.data.userId, false);
    }, TYPING_EXPIRY_MS);
    return;
  }

  const entry: TypingEntry = {
    socketIds: new Set([socket.id]),
    recipientIds,
    timeout: setTimeout(() => {
      typingByConversationAndUser.delete(key);
      emitTypingUpdate(io, recipientIds, conversationId, socket.data.userId, false);
    }, TYPING_EXPIRY_MS),
  };
  typingByConversationAndUser.set(key, entry);
  socket.data.typingConversationIds.push(conversationId);
  emitTypingUpdate(io, recipientIds, conversationId, socket.data.userId, true);
}

export function registerChatEvents(
  io: ChatSocketServer,
  socket: ChatSocket,
  logger: AppLogger,
): void {
  socket.data.typingConversationIds = [];

  socket.on('conversation:join', (payload) => {
    void (async () => {
      await assertSocketSession(socket);
      const parsed = conversationPayloadSchema.safeParse(payload);
      if (!parsed.success) throw new AppError(400, 'INVALID_PAYLOAD', 'Conversation ID is invalid');
      const conversationId = parsed.data.conversationId;
      const member = await ConversationMember.findOne({
        conversationId,
        userId: socket.data.userId,
      }).select('_id').lean();
      if (!member) {
        throw new AppError(403, 'CONVERSATION_FORBIDDEN', 'You cannot join this conversation');
      }
      await socket.join(conversationRoom(conversationId));
    })().catch((error: unknown) => socket.emit('socket:error', toSocketError(error)));
  });

  socket.on('conversation:leave', (payload) => {
    const parsed = conversationPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('socket:error', { code: 'INVALID_PAYLOAD', message: 'Conversation ID is invalid' });
      return;
    }
    void socket.leave(conversationRoom(parsed.data.conversationId));
    stopTypingForSocket(io, socket, parsed.data.conversationId);
  });

  socket.on('message:send', (payload, acknowledge) => {
    void (async () => {
      await assertSocketSession(socket);
      const parsed = messageSendPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw new AppError(400, 'INVALID_MESSAGE', 'Message payload is invalid');
      }
      if (!allowMessageSend(socket.data.userId)) {
        throw new AppError(429, 'RATE_LIMITED', 'Message send rate limit exceeded');
      }
      const result = await persistMessage({
        userId: socket.data.userId,
        conversationId: parsed.data.conversationId,
        content: parsed.data.content,
        clientMessageId: parsed.data.clientMessageId,
      });
      const success: MessageAcknowledgement = { ok: true, message: result.message };
      for (const participantId of result.participantIds) {
        io.to(userRoom(participantId)).emit('message:new', result.message);
      }
      socket.emit('message:ack', success);
      acknowledge?.(success);
    })().catch((error: unknown) => {
      const failure: MessageAcknowledgement = { ok: false, error: toSocketError(error) };
      logger.warn({ code: failure.error?.code }, 'Socket message send failed');
      socket.emit('message:ack', failure);
      acknowledge?.(failure);
    });
  });

  socket.on('message:delivered', (payload) => {
    void (async () => {
      await assertSocketSession(socket);
      const parsed = messagePositionPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw new AppError(400, 'INVALID_PAYLOAD', 'Delivery position is invalid');
      }
      const receipt = await acknowledgeMessageDelivered({
        userId: socket.data.userId,
        conversationId: parsed.data.conversationId,
        messageId: parsed.data.messageId,
      });
      if (receipt.changed) {
        io.to(userRoom(receipt.senderId!)).emit('message:delivered', {
          conversationId: parsed.data.conversationId,
          messageId: receipt.messageId!,
          messageCreatedAt: receipt.messageCreatedAt!.toISOString(),
          deliveredAt: receipt.deliveredAt.toISOString(),
        });
      }
    })().catch((error: unknown) => socket.emit('socket:error', toSocketError(error)));
  });

  socket.on('conversation:read', (payload) => {
    void (async () => {
      await assertSocketSession(socket);
      const parsed = messagePositionPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw new AppError(400, 'INVALID_PAYLOAD', 'Read position is invalid');
      }
      const message = await Message.findOne({
        _id: parsed.data.messageId,
        conversationId: parsed.data.conversationId,
      }).select('senderId').lean();
      const position = await markConversationRead(
        socket.data.userId,
        parsed.data.conversationId,
        parsed.data.messageId,
      );
      if (message && !message.senderId.equals(socket.data.userId)) {
        io.to(userRoom(message.senderId.toString())).emit('message:read', {
          conversationId: parsed.data.conversationId,
          messageId: position.lastReadMessageId ?? parsed.data.messageId,
          readAt: position.lastReadAt?.toISOString() ?? new Date().toISOString(),
        });
      }
    })().catch((error: unknown) => socket.emit('socket:error', toSocketError(error)));
  });

  socket.on('typing:start', (payload) => {
    const parsed = conversationPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('socket:error', { code: 'INVALID_PAYLOAD', message: 'Conversation ID is invalid' });
      return;
    }
    void updateTyping(io, socket, parsed.data.conversationId, true)
      .catch((error: unknown) => socket.emit('socket:error', toSocketError(error)));
  });

  socket.on('typing:stop', (payload) => {
    const parsed = conversationPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('socket:error', { code: 'INVALID_PAYLOAD', message: 'Conversation ID is invalid' });
      return;
    }
    void updateTyping(io, socket, parsed.data.conversationId, false)
      .catch((error: unknown) => socket.emit('socket:error', toSocketError(error)));
  });

  socket.on('disconnect', () => {
    for (const conversationId of socket.data.typingConversationIds) {
      stopTypingForSocket(io, socket, conversationId);
    }
    lastTypingEventBySocket.delete(socket.id);
  });
}
