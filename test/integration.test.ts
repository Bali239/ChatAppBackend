import { createServer } from 'node:http';
import { Types } from 'mongoose';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { vi } from 'vitest';
import { createApp } from '../src/app.js';
import { Conversation } from '../src/models/conversation.model.js';
import { ConversationMember } from '../src/models/conversation-member.model.js';
import { Message } from '../src/models/message.model.js';
import { User } from '../src/models/user.model.js';
import type { MessageAcknowledgement } from '../src/realtime/events.js';
import { attachSocketServer } from '../src/realtime/socket.js';
import { createLogger } from '../src/utils/logger.js';

const trustedOrigin = 'http://localhost:3000';

describe('local HTTP and Socket.IO integration', () => {
  it('authenticates HTTP and sockets with bearer tokens and disconnects them on logout', async () => {
    const logger = createLogger('silent');
    const authenticatedUserId = new Types.ObjectId();
    let disconnectUserSockets: (userId: string) => void = () => undefined;
    const tokenSecret = 'test-only-auth-token-secret-at-least-32-chars';
    const app = createApp({
      frontendOrigins: [trustedOrigin],
      environment: 'test',
      logger,
      getDatabaseStatus: () => 'connected',
      authTokenSecret: tokenSecret,
      auth: { onLogout: (userId) => disconnectUserSockets(userId) },
    });
    const httpServer = createServer(app);
    const socketServer = attachSocketServer(httpServer, [trustedOrigin], logger, tokenSecret);
    disconnectUserSockets = (userId) => socketServer.in(`user:${userId}`).disconnectSockets(true);
    let client: Socket | undefined;
    let authenticatedClient: Socket | undefined;
    let unavailableClient: Socket | undefined;

    await new Promise<void>((resolveListen) => {
      httpServer.listen(0, '127.0.0.1', resolveListen);
    });

    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the test server to bind to a TCP port');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const healthResponse = await fetch(`${baseUrl}/health`);
      expect(healthResponse.status).toBe(200);
      const healthBody = (await healthResponse.json()) as { data: { ready: boolean } };
      expect(healthBody.data.ready).toBe(true);

      const trustedResponse = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { Origin: trustedOrigin },
      });
      expect(trustedResponse.headers.get('access-control-allow-origin')).toBe(trustedOrigin);
      expect(trustedResponse.headers.get('access-control-allow-credentials')).toBeNull();

      const trustedPreflight = await fetch(`${baseUrl}/api/v1/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: trustedOrigin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });
      expect(trustedPreflight.status).toBe(204);
      expect(trustedPreflight.headers.get('access-control-allow-origin')).toBe(trustedOrigin);
      expect(trustedPreflight.headers.get('access-control-allow-credentials')).toBeNull();
      expect(trustedPreflight.headers.get('access-control-allow-headers')).toContain('Authorization');

      const untrustedResponse = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { Origin: 'https://untrusted.example' },
      });
      expect(untrustedResponse.status).toBe(403);
      expect(untrustedResponse.headers.get('access-control-allow-origin')).toBeNull();

      const untrustedPreflight = await fetch(`${baseUrl}/api/v1/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://untrusted.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      expect(untrustedPreflight.status).toBe(403);
      expect(untrustedPreflight.headers.get('access-control-allow-origin')).toBeNull();

      client = createSocketClient(baseUrl, {
        reconnection: false,
        timeout: 2_000,
        transports: ['websocket'],
        extraHeaders: { Origin: trustedOrigin },
      });
      await new Promise<void>((resolveConnect, rejectConnect) => {
        client?.once('connect', () => rejectConnect(new Error('Unauthenticated socket connected')));
        client?.once('connect_error', () => resolveConnect());
      });
      expect(client.connected).toBe(false);

      vi.spyOn(User, 'findById').mockResolvedValue({
        _id: authenticatedUserId,
        accountStatus: 'active',
        authTokenVersion: 0,
        isActive: () => true,
      } as never);
      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/mock-login`, {
        method: 'POST',
        headers: {
          Origin: trustedOrigin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: authenticatedUserId.toString() }),
      });
      expect(loginResponse.status).toBe(200);
      const loginBody = (await loginResponse.json()) as { data: { accessToken: string } };
      const accessToken = loginBody.data.accessToken;
      const currentUserResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(currentUserResponse.status).toBe(200);

      authenticatedClient = createSocketClient(baseUrl, {
        auth: { token: accessToken },
        reconnection: false,
        timeout: 2_000,
        extraHeaders: { Origin: trustedOrigin },
      });
      await new Promise<void>((resolveConnect, rejectConnect) => {
        authenticatedClient?.once('connect', resolveConnect);
        authenticatedClient?.once('connect_error', (error) => rejectConnect(error));
      });
      expect(authenticatedClient.connected).toBe(true);

      const invalidMessageAck = await new Promise<{ ok: boolean; error?: { code: string } }>(
        (resolveAck) => {
          authenticatedClient?.emit('message:send', {
            conversationId: '0123456789abcdef01234567',
            content: 'forged sender',
            clientMessageId: 'client_key_123',
            senderId: '0123456789abcdef01234567',
          }, resolveAck);
        },
      );
      expect(invalidMessageAck).toMatchObject({
        ok: false,
        error: { code: 'INVALID_MESSAGE' },
      });

      const recipientId = new Types.ObjectId();
      const conversationId = new Types.ObjectId();
      const messageId = new Types.ObjectId();
      const createdAt = new Date();
      vi.spyOn(ConversationMember, 'findOne').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      } as never);
      vi.spyOn(Conversation, 'findById').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue({ participantIds: [authenticatedUserId, recipientId] }),
      } as never);
      vi.spyOn(Message, 'findOne').mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as never);
      vi.spyOn(User, 'findOne').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue({
          displayName: 'Current User',
          avatarUrl: null,
        }),
      } as never);
      let messagePersisted = false;
      vi.spyOn(Message, 'create').mockImplementation(async () => {
        messagePersisted = true;
        return {
          _id: messageId,
          conversationId,
          senderId: authenticatedUserId,
          senderSnapshot: { displayName: 'Current User', avatarUrl: null },
          content: 'Persisted before ack',
          clientMessageId: 'client_key_456',
          createdAt,
        } as never;
      });
      vi.spyOn(Conversation, 'updateOne').mockReturnValue(Promise.resolve({ acknowledged: true }) as never);
      vi.spyOn(ConversationMember, 'updateMany').mockReturnValue(Promise.resolve({ acknowledged: true }) as never);
      const validMessageAck = await new Promise<{ ok: boolean; message?: { id: string } }>(
        (resolveAck) => {
          authenticatedClient?.emit('message:send', {
            conversationId: conversationId.toString(),
            content: 'Persisted before ack',
            clientMessageId: 'client_key_456',
          }, (result: MessageAcknowledgement) => {
            expect(messagePersisted).toBe(true);
            resolveAck(result);
          });
        },
      );
      expect(validMessageAck).toMatchObject({ ok: true, message: { id: messageId.toString() } });

      vi.spyOn(ConversationMember, 'findOne').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(null),
      } as never);
      const forbiddenJoin = new Promise<{ code: string }>((resolveError) => {
        authenticatedClient?.once('socket:error', resolveError);
      });
      authenticatedClient.emit('conversation:join', {
        conversationId: '0123456789abcdef01234567',
      });
      await expect(forbiddenJoin).resolves.toMatchObject({ code: 'CONVERSATION_FORBIDDEN' });

      const disconnected = new Promise<void>((resolveDisconnect) => {
        authenticatedClient?.once('disconnect', () => resolveDisconnect());
      });
      const logoutResponse = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          Origin: trustedOrigin,
          Authorization: `Bearer ${accessToken}`,
        },
      });
      expect(logoutResponse.status).toBe(200);
      const rejectedAfterLogout = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(rejectedAfterLogout.status).toBe(401);
      await disconnected;
      expect(authenticatedClient.connected).toBe(false);

      unavailableClient = createSocketClient('http://127.0.0.1:1', {
        reconnection: false,
        timeout: 500,
        transports: ['websocket'],
      });
      await expect(
        new Promise<void>((resolveConnect, rejectConnect) => {
          unavailableClient?.once('connect', resolveConnect);
          unavailableClient?.once('connect_error', rejectConnect);
        }),
      ).rejects.toBeDefined();
    } finally {
      client?.disconnect();
      authenticatedClient?.disconnect();
      unavailableClient?.disconnect();
      await new Promise<void>((resolveClose) => socketServer.close(() => resolveClose()));
    }
  });
});
