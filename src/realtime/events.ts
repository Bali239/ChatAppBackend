import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

export interface SocketError {
  code: string;
  message: string;
}

export interface PersistedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderType?: 'user' | 'assistant';
  replyToMessageId?: string | null;
  senderSnapshot: {
    displayName: string;
    avatarUrl: string | null;
  };
  content: string;
  clientMessageId: string;
  createdAt: string;
}

export interface MessageAcknowledgement {
  ok: boolean;
  message?: PersistedMessage;
  error?: SocketError;
}

export interface ClientToServerEvents {
  'conversation:join': (payload: { conversationId: string }) => void;
  'conversation:leave': (payload: { conversationId: string }) => void;
  'message:send': (
    payload: { conversationId: string; content: string; clientMessageId: string },
    acknowledge?: (result: MessageAcknowledgement) => void,
  ) => void;
  'message:delivered': (payload: { conversationId: string; messageId: string }) => void;
  'conversation:read': (payload: { conversationId: string; messageId: string }) => void;
  'typing:start': (payload: { conversationId: string }) => void;
  'typing:stop': (payload: { conversationId: string }) => void;
}

export interface ServerToClientEvents {
  'ai:status': (update: { conversationId: string; requestMessageId: string; active: boolean }) => void;
  'ai:error': (update: { conversationId: string; requestMessageId: string; message: string }) => void;
  'profile:updated': (profile: { id: string; displayName: string; avatarUrl: string | null }) => void;
  'message:new': (message: PersistedMessage) => void;
  'message:ack': (result: MessageAcknowledgement) => void;
  'message:delivered': (receipt: {
    conversationId: string;
    messageId: string;
    messageCreatedAt: string;
    deliveredAt: string;
  }) => void;
  'message:read': (receipt: { conversationId: string; messageId: string; readAt: string }) => void;
  'typing:update': (update: { conversationId: string; userId: string; isTyping: boolean }) => void;
  'presence:update': (update: { userId: string; isOnline: boolean }) => void;
  'socket:error': (error: SocketError) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  userId: string;
  sessionId: string;
  tokenVersion: number;
  tokenExpiresAt: number;
  typingConversationIds: string[];
}

export type ChatSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type ChatSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);

export const conversationPayloadSchema = z.object({
  conversationId: objectIdSchema,
}).strict();

export const messageSendPayloadSchema = z.object({
  conversationId: objectIdSchema,
  content: z.string().trim().min(1).max(5_000),
  clientMessageId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export const messagePositionPayloadSchema = z.object({
  conversationId: objectIdSchema,
  messageId: objectIdSchema,
}).strict();
