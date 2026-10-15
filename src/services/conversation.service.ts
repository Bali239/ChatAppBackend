import { Types } from 'mongoose';
import { Conversation, createParticipantKey } from '../models/conversation.model.js';
import { ConversationMember } from '../models/conversation-member.model.js';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/error.js';

function parseUserId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new AppError(400, 'INVALID_USER_ID', 'User ID is invalid');
  }
  return new Types.ObjectId(value);
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export async function findOrCreateDirectConversation(
  requesterId: string,
  otherUserId: string,
) {
  const requesterObjectId = parseUserId(requesterId);
  const otherObjectId = parseUserId(otherUserId);
  if (requesterObjectId.equals(otherObjectId)) {
    throw new AppError(400, 'SELF_CONVERSATION', 'A conversation with yourself is not allowed');
  }

  const participantIds = [requesterObjectId, otherObjectId].sort((left, right) =>
    left.toString().localeCompare(right.toString()),
  );
  const eligibleUsers = await User.find({
    _id: { $in: participantIds },
    accountStatus: 'active',
  })
    .select('_id')
    .lean();
  if (eligibleUsers.length !== 2) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Eligible user was not found');
  }

  const participantKey = createParticipantKey(participantIds.map((id) => id.toString()));
  let conversation = null;
  try {
    conversation = await Conversation.findOneAndUpdate(
      { participantKey },
      {
        $setOnInsert: {
          type: 'direct',
          participantIds,
          participantKey,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    conversation = await Conversation.findOne({ participantKey });
  }

  if (!conversation) {
    throw new AppError(500, 'CONVERSATION_CREATE_FAILED', 'Conversation could not be created');
  }

  const lastActivityAt = conversation.lastMessageAt ?? conversation.createdAt;
  await ConversationMember.bulkWrite(
    participantIds.map((userId) => ({
      updateOne: {
        filter: { conversationId: conversation._id, userId },
        update: {
          $setOnInsert: {
            conversationId: conversation._id,
            userId,
            lastActivityAt,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return conversation;
}