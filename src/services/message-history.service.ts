import { Types } from 'mongoose';
import { ConversationMember } from '../models/conversation-member.model.js';
import { Message } from '../models/message.model.js';
import { AppError } from '../utils/error.js';
import { cursorPredicate, decodeCursor, encodeCursor } from './cursor.js';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;

function parseObjectId(value: string, code: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new AppError(400, code, 'Identifier is invalid');
  }
  return new Types.ObjectId(value);
}

export async function getVisibleMessageHistory(input: {
  userId: string;
  conversationId: string;
  cursor?: string;
  limit?: number;
}) {
  const userId = parseObjectId(input.userId, 'INVALID_USER_ID');
  const conversationId = parseObjectId(input.conversationId, 'INVALID_CONVERSATION_ID');
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new AppError(400, 'INVALID_PAGE_SIZE', 'Page size is invalid');
  }

  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  const [member, otherMember] = await Promise.all([
    ConversationMember.findOne({ conversationId, userId })
      .select('clearedAt')
      .lean(),
    ConversationMember.findOne({ conversationId, userId: { $ne: userId } })
      .select('lastReadAt lastReadMessageId lastDeliveredAt lastDeliveredMessageAt lastDeliveredMessageId')
      .lean(),
  ]);
  if (!member) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found');
  }

  const conditions: Record<string, unknown>[] = [{ conversationId }];
  if (member.clearedAt) conditions.push({ createdAt: { $gt: member.clearedAt } });
  if (cursor) conditions.push(cursorPredicate(cursor));
  const filter = conditions.length === 1 ? conditions[0] : { $and: conditions };
  const results = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const oldestMessage = page.at(-1);

  return {
    messages: page.reverse().map((message) => ({
      id: message._id.toString(),
      conversationId: message.conversationId.toString(),
      senderId: message.senderId.toString(),
      senderType: message.senderType === 'assistant' ? 'assistant' : 'user',
      replyToMessageId: message.replyToMessageId?.toString() ?? null,
      senderSnapshot: message.senderSnapshot,
      content: message.content ?? '',
      attachment: message.attachment ?? null,
      clientMessageId: message.clientMessageId,
      createdAt: message.createdAt,
    })),
    nextCursor: hasMore && oldestMessage
      ? encodeCursor(oldestMessage.createdAt, oldestMessage._id)
      : null,
    hasMore,
    clearedAt: member.clearedAt ?? null,
    receiptState: otherMember ? {
      lastReadAt: otherMember.lastReadAt ?? null,
      lastReadMessageId: otherMember.lastReadMessageId?.toString() ?? null,
      lastDeliveredAt: otherMember.lastDeliveredAt ?? null,
      lastDeliveredMessageAt: otherMember.lastDeliveredMessageAt ?? null,
      lastDeliveredMessageId: otherMember.lastDeliveredMessageId?.toString() ?? null,
    } : null,
  };
}

export async function clearConversationForUser(userId: string, conversationId: string) {
  const userObjectId = parseObjectId(userId, 'INVALID_USER_ID');
  const conversationObjectId = parseObjectId(conversationId, 'INVALID_CONVERSATION_ID');
  const clearedAt = new Date();
  const member = await ConversationMember.findOneAndUpdate(
    { conversationId: conversationObjectId, userId: userObjectId },
    {
      $set: {
        clearedAt,
        lastReadAt: clearedAt,
        lastReadMessageId: null,
        lastDeliveredAt: null,
        lastDeliveredMessageAt: null,
        lastDeliveredMessageId: null,
        lastActivityAt: clearedAt,
      },
    },
    { new: true },
  );
  if (!member) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found');
  }

  return { clearedAt: member.clearedAt ?? clearedAt };
}

export async function markConversationRead(
  userId: string,
  conversationId: string,
  messageId: string,
) {
  const userObjectId = parseObjectId(userId, 'INVALID_USER_ID');
  const conversationObjectId = parseObjectId(conversationId, 'INVALID_CONVERSATION_ID');
  const messageObjectId = parseObjectId(messageId, 'INVALID_MESSAGE_ID');
  const member = await ConversationMember.findOne({
    conversationId: conversationObjectId,
    userId: userObjectId,
  }).select('clearedAt lastReadAt lastReadMessageId').lean();
  if (!member) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found');
  }

  const message = await Message.findOne({
    _id: messageObjectId,
    conversationId: conversationObjectId,
  }).select('_id createdAt').lean();
  if (!message || (member.clearedAt && message.createdAt <= member.clearedAt)) {
    throw new AppError(400, 'INVALID_READ_POSITION', 'Read position is not visible');
  }

  if (
    member.lastReadAt &&
    (message.createdAt < member.lastReadAt ||
      (message.createdAt.getTime() === member.lastReadAt.getTime() &&
        member.lastReadMessageId &&
        message._id.toString() <= member.lastReadMessageId.toString()))
  ) {
    return {
      lastReadAt: member.lastReadAt,
      lastReadMessageId: member.lastReadMessageId?.toString() ?? null,
    };
  }

  const updatedMember = await ConversationMember.findOneAndUpdate(
    {
      conversationId: conversationObjectId,
      userId: userObjectId,
      clearedAt: member.clearedAt ?? null,
      $or: [
        { lastReadAt: null },
        { lastReadAt: { $lt: message.createdAt } },
        { lastReadAt: message.createdAt, lastReadMessageId: { $lt: message._id } },
      ],
    },
    { $set: { lastReadAt: message.createdAt, lastReadMessageId: message._id } },
    { new: true },
  );

  if (!updatedMember) {
    const latestMember = await ConversationMember.findOne({
      conversationId: conversationObjectId,
      userId: userObjectId,
    }).select('lastReadAt lastReadMessageId').lean();
    if (!latestMember) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found');
    }
    return {
      lastReadAt: latestMember.lastReadAt ?? null,
      lastReadMessageId: latestMember.lastReadMessageId?.toString() ?? null,
    };
  }

  return {
    lastReadAt: updatedMember.lastReadAt ?? message.createdAt,
    lastReadMessageId: updatedMember.lastReadMessageId?.toString() ?? message._id.toString(),
  };
}
