import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conversation } from '../src/models/conversation.model.js';
import { ConversationMember } from '../src/models/conversation-member.model.js';
import { User } from '../src/models/user.model.js';
import { AuthSession } from '../src/models/auth-session.model.js';
import { registerChatEvents } from '../src/realtime/chat-events.js';
import { createLogger } from '../src/utils/logger.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createSocketHarness(isMember: boolean) {
  const handlers = new Map<string, (...args: never[]) => void>();
  const socketEmits: Array<[string, unknown]> = [];
  const serverEmits: Array<[string, unknown]> = [];
  const socket = {
    id: new Types.ObjectId().toString(),
    data: {
      userId: new Types.ObjectId().toString(), sessionId: '00000000-0000-4000-8000-000000000001', tokenVersion: 0,
      tokenExpiresAt: Date.now() + 60_000, typingConversationIds: [] as string[],
    },
    on: (event: string, handler: (...args: never[]) => void) => handlers.set(event, handler),
    emit: (event: string, payload: unknown) => socketEmits.push([event, payload]),
    disconnect: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
  };
  const io = {
    to: vi.fn(() => ({ emit: (event: string, payload: unknown) => serverEmits.push([event, payload]) })),
  };

  vi.spyOn(User, 'findById').mockResolvedValue({ isActive: () => true, authTokenVersion: 0 } as never);
  vi.spyOn(AuthSession, 'findOne').mockReturnValue({
    select: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
  } as never);
  vi.spyOn(ConversationMember, 'findOne').mockReturnValue({
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(isMember ? { _id: new Types.ObjectId() } : null),
  } as never);
  vi.spyOn(Conversation, 'findById').mockReturnValue({
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue({
      participantIds: [new Types.ObjectId(socket.data.userId), new Types.ObjectId()],
    }),
  } as never);
  registerChatEvents(io as never, socket as never, createLogger('silent'));

  return { handlers, socket, socketEmits, serverEmits };
}

describe('realtime typing events', () => {
  it('expires an authorized typing indicator when typing:stop is lost', async () => {
    vi.useFakeTimers();
    const harness = createSocketHarness(true);
    const conversationId = new Types.ObjectId().toString();
    const start = harness.handlers.get('typing:start');

    start?.({ conversationId } as never);
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.serverEmits).toContainEqual([
      'typing:update',
      expect.objectContaining({ conversationId, userId: harness.socket.data.userId, isTyping: true }),
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.serverEmits).toContainEqual([
      'typing:update',
      expect.objectContaining({ conversationId, userId: harness.socket.data.userId, isTyping: false }),
    ]);
  });

  it('does not broadcast typing from a non-member', async () => {
    const harness = createSocketHarness(false);
    const conversationId = new Types.ObjectId().toString();
    const start = harness.handlers.get('typing:start');

    start?.({ conversationId } as never);
    await vi.waitFor(() => {
      expect(harness.socketEmits).toContainEqual([
        'socket:error',
        expect.objectContaining({ code: 'CONVERSATION_FORBIDDEN' }),
      ]);
    });
    expect(harness.serverEmits).toHaveLength(0);
  });
});
