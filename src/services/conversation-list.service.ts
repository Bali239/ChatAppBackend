import { Types } from 'mongoose';
import { Conversation } from '../models/conversation.model.js';
import { ConversationMember, type ConversationMemberDocument } from '../models/conversation-member.model.js';
import { Message, type MessageDocument } from '../models/message.model.js';
import { User } from '../models/user.model.js';
import { isUserOnline } from '../realtime/presence.js';
import { AppError } from '../utils/error.js';
import { cursorPredicate, decodeCursor, encodeCursor } from './cursor.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

interface PreviewAggregateRow {
  _id: Types.ObjectId;
  message: Pick<
    MessageDocument,
    '_id' | 'conversationId' | 'senderId' | 'senderType' | 'senderSnapshot' | 'content' | 'createdAt'
  >;
}

interface UnreadAggregateRow {
  _id: Types.ObjectId;
  unreadCount: number;
}

export async function listConversationsForUser(input: {
  userId: string;
  cursor?: string;
  limit?: number;
}) {
  if (!Types.ObjectId.isValid(input.userId)) {
    throw new AppError(400, 'INVALID_USER_ID', 'User ID is invalid');
  }
  const userId = new Types.ObjectId(input.userId);
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new AppError(400, 'INVALID_PAGE_SIZE', 'Page size is invalid');
  }

  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  const memberFilter: Record<string, unknown> = { userId };
  if (cursor) Object.assign(memberFilter, cursorPredicate(cursor, 'lastActivityAt'));
  const results = await ConversationMember.find(memberFilter)
    .select('conversationId userId clearedAt lastReadAt lastReadMessageId lastDeliveredAt lastDeliveredMessageId lastActivityAt')
    .sort({ lastActivityAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = results.length > limit;
  const members = hasMore ? results.slice(0, limit) : results;
  const lastMember = members.at(-1);
  if (members.length === 0) {
    return { conversations: [], nextCursor: null, hasMore: false };
  }

  const conversationIds = members.map((member) => member.conversationId);
  const conversations = await Conversation.find({ _id: { $in: conversationIds } })
    .select('_id participantIds')
    .lean();
  const conversationById = new Map(conversations.map((conversation) => [
    conversation._id.toString(),
    conversation,
  ]));
  const otherParticipantIds = members.flatMap((member) => {
    const conversation = conversationById.get(member.conversationId.toString());
    return conversation?.participantIds
      .filter((participantId) => !participantId.equals(userId)) ?? [];
  });
  const participants = await User.find({
    _id: { $in: otherParticipantIds },
    accountStatus: 'active',
  })
    .select('_id displayName email avatarUrl')
    .lean();
  const participantById = new Map(participants.map((participant) => [
    participant._id.toString(),
    participant,
  ]));

  const visibilityBranches = members.map((member) => ({
    conversationId: member.conversationId,
    ...(member.clearedAt ? { createdAt: { $gt: member.clearedAt } } : {}),
  }));
  const unreadBranches = members.map((member) => {
    const conditions: Record<string, unknown>[] = [
      { conversationId: member.conversationId },
      { senderId: { $ne: userId } },
    ];
    if (member.clearedAt) conditions.push({ createdAt: { $gt: member.clearedAt } });
    if (member.lastReadAt) {
      conditions.push({
        $or: member.lastReadMessageId
          ? [
              { createdAt: { $gt: member.lastReadAt } },
              {
                createdAt: member.lastReadAt,
                _id: { $gt: member.lastReadMessageId },
              },
            ]
          : [{ createdAt: { $gt: member.lastReadAt } }],
      });
    }
    return { $and: conditions };
  });

  const [previewRows, unreadRows] = await Promise.all([
    Message.aggregate<PreviewAggregateRow>([
      { $match: { $or: visibilityBranches } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: '$conversationId', message: { $first: '$$ROOT' } } },
    ]),
    Message.aggregate<UnreadAggregateRow>([
      { $match: { $or: unreadBranches } },
      { $group: { _id: '$conversationId', unreadCount: { $sum: 1 } } },
    ]),
  ]);
  const previewByConversationId = new Map(previewRows.map((row) => [
    row._id.toString(),
    row.message,
  ]));
  const unreadByConversationId = new Map(unreadRows.map((row) => [
    row._id.toString(),
    row.unreadCount,
  ]));

  const conversationItems = members.flatMap((member) => {
    const conversationId = member.conversationId.toString();
    const conversation = conversationById.get(conversationId);
    const otherParticipantId = conversation?.participantIds.find(
      (participantId) => !participantId.equals(userId),
    )?.toString();
    const participant = otherParticipantId ? participantById.get(otherParticipantId) : undefined;
    if (!conversation || !participant) return [];

    const preview = previewByConversationId.get(conversationId);
    return [{
      id: conversationId,
      participant: {
        id: participant._id.toString(),
        displayName: participant.displayName,
        email: participant.email,
        avatarUrl: participant.avatarUrl ?? null,
        isOnline: isUserOnline(participant._id.toString()),
      },
      lastMessage: preview ? {
        id: preview._id.toString(),
        senderId: preview.senderId.toString(),
        senderType: preview.senderType === 'assistant' ? 'assistant' : 'user',
        senderSnapshot: preview.senderSnapshot,
        content: preview.content,
        createdAt: preview.createdAt,
      } : null,
      lastActivityAt: member.lastActivityAt,
      unreadCount: unreadByConversationId.get(conversationId) ?? 0,
      clearedAt: member.clearedAt ?? null,
      lastReadAt: member.lastReadAt ?? null,
      lastReadMessageId: member.lastReadMessageId?.toString() ?? null,
    }];
  });

  return {
    conversations: conversationItems,
    nextCursor: hasMore && lastMember
      ? encodeCursor(lastMember.lastActivityAt, lastMember._id)
      : null,
    hasMore,
  };
}
