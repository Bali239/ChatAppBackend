import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conversation } from '../src/models/conversation.model.js';
import { ConversationMember } from '../src/models/conversation-member.model.js';
import { Message } from '../src/models/message.model.js';
import { User } from '../src/models/user.model.js';
import { listConversationsForUser } from '../src/services/conversation-list.service.js';

afterEach(() => vi.restoreAllMocks());

function mockFind(model: typeof Conversation | typeof ConversationMember | typeof User, documents: object[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(documents),
  };
  vi.spyOn(model, 'find').mockReturnValue(query as never);
  return query;
}

describe('conversation list service', () => {
  it('orders by member activity and derives cutoff-aware preview and unread counts in batches', async () => {
    const userId = new Types.ObjectId();
    const otherUserId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    const memberId = new Types.ObjectId();
    const messageId = new Types.ObjectId();
    const clearedAt = new Date('2026-10-10T00:00:00.000Z');
    const lastReadAt = new Date('2026-10-12T00:00:00.000Z');
    const member = {
      _id: memberId,
      conversationId,
      userId,
      clearedAt,
      lastReadAt,
      lastReadMessageId: messageId,
      lastActivityAt: new Date('2026-10-13T00:00:00.000Z'),
    };
    const membersQuery = mockFind(ConversationMember, [member]);
    mockFind(Conversation, [{ _id: conversationId, participantIds: [userId, otherUserId] }]);
    mockFind(User, [{
      _id: otherUserId,
      displayName: 'Other User',
      email: 'other@example.com',
      avatarUrl: null,
    }]);
    const previewMessage = {
      _id: messageId,
      senderId: otherUserId,
      senderSnapshot: { displayName: 'Other User', avatarUrl: null },
      content: 'visible after clear',
      createdAt: new Date('2026-10-13T00:00:00.000Z'),
    };
    vi.spyOn(Message, 'aggregate')
      .mockResolvedValueOnce([{ _id: conversationId, message: previewMessage }] as never)
      .mockResolvedValueOnce([{ _id: conversationId, unreadCount: 1 }] as never);

    const result = await listConversationsForUser({ userId: userId.toString(), limit: 10 });

    expect(membersQuery.sort).toHaveBeenCalledWith({ lastActivityAt: -1, _id: -1 });
    expect(result.conversations).toEqual([expect.objectContaining({
      id: conversationId.toString(),
      participant: expect.objectContaining({ id: otherUserId.toString() }),
      lastMessage: expect.objectContaining({ content: 'visible after clear' }),
      unreadCount: 1,
      clearedAt,
    })]);
    expect(Message.aggregate).toHaveBeenNthCalledWith(1, expect.arrayContaining([
      { $match: { $or: [{ conversationId, createdAt: { $gt: clearedAt } }] } },
    ]));
    expect(Message.aggregate).toHaveBeenNthCalledWith(2, expect.arrayContaining([
      { $match: { $or: [expect.objectContaining({
        $and: expect.arrayContaining([
          { conversationId },
          { senderId: { $ne: userId } },
          { createdAt: { $gt: clearedAt } },
        ]),
      })] } },
    ]));
  });

  it('returns an empty page without issuing follow-up queries', async () => {
    const query = mockFind(ConversationMember, []);
    const conversationFind = vi.spyOn(Conversation, 'find');

    await expect(listConversationsForUser({ userId: new Types.ObjectId().toString() })).resolves.toEqual({
      conversations: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(query.limit).toHaveBeenCalledWith(21);
    expect(conversationFind).not.toHaveBeenCalled();
  });
});