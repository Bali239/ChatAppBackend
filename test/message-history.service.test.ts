import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationMember } from '../src/models/conversation-member.model.js';
import { Message } from '../src/models/message.model.js';
import {
  clearConversationForUser,
  getVisibleMessageHistory,
  markConversationRead,
} from '../src/services/message-history.service.js';

afterEach(() => vi.restoreAllMocks());

function mockMemberFind(member: object | null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(member),
  };
  vi.spyOn(ConversationMember, 'findOne').mockReturnValue(query as never);
  return query;
}

describe('per-user message history state', () => {
  it('applies the authenticated member cutoff to paginated history', async () => {
    const userId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    const clearedAt = new Date('2026-10-10T00:00:00.000Z');
    const memberQuery = mockMemberFind({ clearedAt });
    const findMember = vi.mocked(ConversationMember.findOne);
    findMember.mockReturnValueOnce(memberQuery as never);
    findMember.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        lastReadAt: null,
        lastReadMessageId: null,
        lastDeliveredAt: null,
        lastDeliveredMessageAt: null,
        lastDeliveredMessageId: null,
      }),
    } as never);
    const query = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(Message, 'find').mockReturnValue(query as never);

    const page = await getVisibleMessageHistory({
      userId: userId.toString(),
      conversationId: conversationId.toString(),
      limit: 10,
    });

    expect(Message.find).toHaveBeenCalledWith({
      $and: [
        { conversationId },
        { createdAt: { $gt: clearedAt } },
      ],
    });
    expect(ConversationMember.findOne).toHaveBeenNthCalledWith(2, {
      conversationId,
      userId: { $ne: userId },
    });
    expect(query.limit).toHaveBeenCalledWith(11);
    expect(page.clearedAt).toBe(clearedAt);
  });

  it('changes only the authenticated member cutoff and leaves shared messages untouched', async () => {
    const userId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    const findAndUpdate = vi.spyOn(ConversationMember, 'findOneAndUpdate').mockResolvedValue({
      clearedAt: new Date(),
    } as never);
    const deleteMessages = vi.spyOn(Message, 'deleteMany');

    const result = await clearConversationForUser(userId.toString(), conversationId.toString());

    expect(findAndUpdate).toHaveBeenCalledWith(
      { conversationId, userId },
      {
        $set: expect.objectContaining({
          clearedAt: expect.any(Date),
          lastReadAt: expect.any(Date),
          lastActivityAt: expect.any(Date),
        }),
      },
      { new: true },
    );
    expect(result.clearedAt).toBeInstanceOf(Date);
    expect(deleteMessages).not.toHaveBeenCalled();
  });

  it('rejects read positions outside membership or before the member cutoff', async () => {
    const userId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    const messageId = new Types.ObjectId();
    const clearedAt = new Date('2026-10-10T00:00:00.000Z');
    mockMemberFind({ clearedAt, lastReadAt: null, lastReadMessageId: null });
    vi.spyOn(Message, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: messageId,
        createdAt: new Date('2026-10-09T00:00:00.000Z'),
      }),
    } as never);

    await expect(
      markConversationRead(userId.toString(), conversationId.toString(), messageId.toString()),
    ).rejects.toMatchObject({ code: 'INVALID_READ_POSITION' });
  });
});