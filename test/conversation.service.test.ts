import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conversation } from '../src/models/conversation.model.js';
import { ConversationMember } from '../src/models/conversation-member.model.js';
import { User } from '../src/models/user.model.js';
import { findOrCreateDirectConversation } from '../src/services/conversation.service.js';

afterEach(() => vi.restoreAllMocks());

function mockEligibleUsers(users: object[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(users),
  };
  vi.spyOn(User, 'find').mockReturnValue(query as never);
  return query;
}

describe('findOrCreateDirectConversation', () => {
  it('creates one canonical direct room and idempotently provisions both members', async () => {
    const requesterId = new Types.ObjectId();
    const otherUserId = new Types.ObjectId();
    const conversation = {
      _id: new Types.ObjectId(),
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      lastMessageAt: null,
    };
    mockEligibleUsers([{ _id: requesterId }, { _id: otherUserId }]);
    const findOrCreate = vi.spyOn(Conversation, 'findOneAndUpdate').mockResolvedValue(
      conversation as never,
    );
    const memberUpsert = vi.spyOn(ConversationMember, 'bulkWrite').mockResolvedValue({
      acknowledged: true,
      insertedCount: 0,
      matchedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      upsertedCount: 2,
      upsertedIds: {},
    } as never);

    const result = await findOrCreateDirectConversation(
      requesterId.toString(),
      otherUserId.toString(),
    );

    expect(result).toBe(conversation);
    expect(findOrCreate).toHaveBeenCalledWith(
      { participantKey: expect.stringMatching(/^[a-f\d]{24}:[a-f\d]{24}$/i) },
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ type: 'direct' }) }),
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    expect(memberUpsert.mock.calls[0][0]).toHaveLength(2);
  });

  it('rejects self-conversations and ineligible users before creating a room', async () => {
    const userId = new Types.ObjectId();
    const createRoom = vi.spyOn(Conversation, 'findOneAndUpdate').mockResolvedValue(null as never);
    await expect(
      findOrCreateDirectConversation(userId.toString(), userId.toString()),
    ).rejects.toMatchObject({ code: 'SELF_CONVERSATION' });

    mockEligibleUsers([{ _id: userId }]);
    await expect(
      findOrCreateDirectConversation(userId.toString(), new Types.ObjectId().toString()),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('recovers a duplicate-key race by returning the existing room', async () => {
    const requesterId = new Types.ObjectId();
    const otherUserId = new Types.ObjectId();
    const conversation = {
      _id: new Types.ObjectId(),
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      lastMessageAt: null,
    };
    mockEligibleUsers([{ _id: requesterId }, { _id: otherUserId }]);
    vi.spyOn(Conversation, 'findOneAndUpdate').mockRejectedValue({ code: 11000 });
    vi.spyOn(Conversation, 'findOne').mockResolvedValue(conversation as never);
    vi.spyOn(ConversationMember, 'bulkWrite').mockResolvedValue({ acknowledged: true } as never);

    await expect(
      findOrCreateDirectConversation(requesterId.toString(), otherUserId.toString()),
    ).resolves.toBe(conversation);
  });
});