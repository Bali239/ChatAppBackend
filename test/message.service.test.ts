import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conversation } from '../src/models/conversation.model.js';
import { ConversationMember } from '../src/models/conversation-member.model.js';
import { Message } from '../src/models/message.model.js';
import { User } from '../src/models/user.model.js';
import {
  acknowledgeMessageDelivered,
  persistMessage,
} from '../src/services/message.service.js';

afterEach(() => vi.restoreAllMocks());

describe('persistMessage', () => {
  it('persists before updating activity and returns a stable sender snapshot', async () => {
    const senderId = new Types.ObjectId();
    const recipientId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    const messageId = new Types.ObjectId();
    const createdAt = new Date('2026-10-15T12:00:00.000Z');
    const sequence: string[] = [];
    vi.spyOn(ConversationMember, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    } as never);
    vi.spyOn(Conversation, 'findById').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ participantIds: [senderId, recipientId] }),
    } as never);
    vi.spyOn(Message, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    vi.spyOn(User, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: senderId,
        displayName: 'Current Name',
        avatarUrl: 'https://example.com/avatar.png',
      }),
    } as never);
    vi.spyOn(Message, 'create').mockImplementation(async () => {
      sequence.push('persist');
      return {
        _id: messageId,
        conversationId,
        senderId,
        senderSnapshot: { displayName: 'Current Name', avatarUrl: 'https://example.com/avatar.png' },
        content: 'Hello',
        clientMessageId: 'client_key_123',
        createdAt,
      } as never;
    });
    vi.spyOn(Conversation, 'updateOne').mockReturnValue(
      {
        then: (resolve: (result: { acknowledged: boolean }) => unknown) => {
          sequence.push('conversation');
          return Promise.resolve(resolve({ acknowledged: true }));
        },
      } as never,
    );
    vi.spyOn(ConversationMember, 'updateMany').mockReturnValue(
      {
        then: (resolve: (result: { acknowledged: boolean }) => unknown) => {
          sequence.push('members');
          return Promise.resolve(resolve({ acknowledged: true }));
        },
      } as never,
    );

    const result = await persistMessage({
      userId: senderId.toString(),
      conversationId: conversationId.toString(),
      content: '  Hello  ',
      clientMessageId: 'client_key_123',
    });

    expect(sequence[0]).toBe('persist');
    expect(result.message).toMatchObject({
      id: messageId.toString(),
      senderId: senderId.toString(),
      senderSnapshot: { displayName: 'Current Name' },
      content: 'Hello',
      createdAt: createdAt.toISOString(),
    });
    expect(result.participantIds).toContain(recipientId.toString());
  });

  it('rejects non-members and conflicting retries without creating messages', async () => {
    const senderId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    vi.spyOn(ConversationMember, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    const createMessage = vi.spyOn(Message, 'create');
    await expect(persistMessage({
      userId: senderId.toString(),
      conversationId: conversationId.toString(),
      content: 'Hello',
      clientMessageId: 'client_key_123',
    })).rejects.toMatchObject({ code: 'CONVERSATION_FORBIDDEN' });
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('records delivery only for a visible incoming message and reports server receipt time', async () => {
    const userId = new Types.ObjectId();
    const senderId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    const messageId = new Types.ObjectId();
    const messageCreatedAt = new Date('2026-10-15T11:00:00.000Z');
    const acknowledgedAt = new Date('2026-10-15T11:01:00.000Z');
    vi.spyOn(ConversationMember, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        clearedAt: new Date('2026-10-10T00:00:00.000Z'),
        lastDeliveredAt: null,
        lastDeliveredMessageAt: null,
        lastDeliveredMessageId: null,
      }),
    } as never);
    vi.spyOn(Message, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: messageId,
        senderId,
        createdAt: messageCreatedAt,
      }),
    } as never);
    vi.spyOn(ConversationMember, 'findOneAndUpdate').mockResolvedValue({
      lastDeliveredAt: acknowledgedAt,
      lastDeliveredMessageAt: messageCreatedAt,
      lastDeliveredMessageId: messageId,
    } as never);

    const result = await acknowledgeMessageDelivered({
      userId: userId.toString(),
      conversationId: conversationId.toString(),
      messageId: messageId.toString(),
    });

    expect(Message.findOne).toHaveBeenCalledWith(expect.objectContaining({
      _id: messageId,
      conversationId,
      senderId: { $ne: userId },
      createdAt: { $gt: new Date('2026-10-10T00:00:00.000Z') },
    }));
    expect(result).toMatchObject({
      senderId: senderId.toString(),
      messageId: messageId.toString(),
      deliveredAt: acknowledgedAt,
      changed: true,
    });
  });

  it('reuses a persisted retry and rejects reuse of its key with different content', async () => {
    const senderId = new Types.ObjectId();
    const recipientId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    const messageId = new Types.ObjectId();
    const existingMessage = {
      _id: messageId,
      conversationId,
      senderId,
      senderSnapshot: { displayName: 'Original Name', avatarUrl: null },
      content: 'Original message',
      clientMessageId: 'retry_key_123',
      createdAt: new Date('2026-10-15T12:00:00.000Z'),
    };
    vi.spyOn(ConversationMember, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    } as never);
    vi.spyOn(Conversation, 'findById').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ participantIds: [senderId, recipientId] }),
    } as never);
    vi.spyOn(Message, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(existingMessage),
    } as never);
    vi.spyOn(Conversation, 'updateOne').mockReturnValue(Promise.resolve({ acknowledged: true }) as never);
    vi.spyOn(ConversationMember, 'updateMany').mockReturnValue(Promise.resolve({ acknowledged: true }) as never);
    const createMessage = vi.spyOn(Message, 'create');

    const result = await persistMessage({
      userId: senderId.toString(),
      conversationId: conversationId.toString(),
      content: 'Original message',
      clientMessageId: 'retry_key_123',
    });
    expect(result.duplicate).toBe(true);
    expect(result.message.id).toBe(messageId.toString());
    expect(createMessage).not.toHaveBeenCalled();

    await expect(persistMessage({
      userId: senderId.toString(),
      conversationId: conversationId.toString(),
      content: 'Different content',
      clientMessageId: 'retry_key_123',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});