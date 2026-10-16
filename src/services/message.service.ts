import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { Conversation } from '../models/conversation.model.js';
import { ConversationMember } from '../models/conversation-member.model.js';
import { MAX_MESSAGE_LENGTH, Message } from '../models/message.model.js';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/error.js';
import type { PersistedMessage } from '../realtime/events.js';

function parseObjectId(value: string, code: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new AppError(400, code, 'Identifier is invalid');
  }
  return new Types.ObjectId(value);
}

function getErrorCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'number' ? error.code : undefined;
  }
  return undefined;
}

function toPersistedMessage(message: {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  senderType?: 'user' | 'assistant';
  replyToMessageId?: Types.ObjectId | null;
  senderSnapshot: { displayName: string; avatarUrl?: string | null };
  content?: string | null;
  attachment?: { type: 'image' | 'video'; url: string; publicId: string; format: string; bytes: number } | null;
  clientMessageId: string;
  createdAt: Date;
}): PersistedMessage {
  return {
    id: message._id.toString(),
    conversationId: message.conversationId.toString(),
    senderId: message.senderId.toString(),
    senderType: message.senderType === 'assistant' ? 'assistant' : 'user',
    replyToMessageId: message.replyToMessageId?.toString() ?? null,
    senderSnapshot: {
      displayName: message.senderSnapshot.displayName,
      avatarUrl: message.senderSnapshot.avatarUrl ?? null,
    },
    content: message.content ?? '',
    attachment: message.attachment ?? null,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt.toISOString(),
  };
}

async function updateConversationActivity(message: {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  createdAt: Date;
}): Promise<void> {
  await Promise.all([
    Conversation.updateOne(
      {
        _id: message.conversationId,
        $or: [
          { lastMessageAt: null },
          { lastMessageAt: { $lt: message.createdAt } },
          {
            lastMessageAt: message.createdAt,
            lastMessageId: { $lt: message._id },
          },
        ],
      },
      { $set: { lastMessageId: message._id, lastMessageAt: message.createdAt } },
    ),
    ConversationMember.updateMany(
      { conversationId: message.conversationId },
      { $max: { lastActivityAt: message.createdAt } },
    ),
  ]);
}

export async function persistMessage(input: {
  userId: string;
  conversationId: string;
  content: string;
  clientMessageId: string;
  attachment?: { type: 'image' | 'video'; url: string; publicId: string; format: string; bytes: number };
}) {
  const senderId = parseObjectId(input.userId, 'INVALID_USER_ID');
  const conversationId = parseObjectId(input.conversationId, 'INVALID_CONVERSATION_ID');
  const content = input.content.trim();
  if ((!content && !input.attachment) || content.length > MAX_MESSAGE_LENGTH) {
    throw new AppError(400, 'INVALID_MESSAGE', 'Message content is invalid');
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.clientMessageId)) {
    throw new AppError(400, 'INVALID_MESSAGE_ID', 'Message idempotency key is invalid');
  }

  const membership = await ConversationMember.findOne({ conversationId, userId: senderId })
    .select('_id')
    .lean();
  if (!membership) {
    throw new AppError(403, 'CONVERSATION_FORBIDDEN', 'You cannot send to this conversation');
  }
  const conversation = await Conversation.findById(conversationId)
    .select('participantIds')
    .lean();
  if (!conversation || !conversation.participantIds.some((participantId) => participantId.equals(senderId))) {
    throw new AppError(403, 'CONVERSATION_FORBIDDEN', 'You cannot send to this conversation');
  }

  const idempotencyFilter = { conversationId, senderId, clientMessageId: input.clientMessageId };
  let message = await Message.findOne(idempotencyFilter).lean();
  if (message) {
    if (message.content !== content || JSON.stringify(message.attachment ?? null) !== JSON.stringify(input.attachment ?? null)) {
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Message retry does not match the original');
    }
    await updateConversationActivity(message);
    return {
      message: toPersistedMessage(message),
      participantIds: conversation.participantIds.map((participantId) => participantId.toString()),
      duplicate: true,
    };
  }

  const sender = await User.findOne({ _id: senderId, accountStatus: 'active' })
    .select('_id displayName avatarUrl')
    .lean();
  if (!sender) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
  }

  let duplicate = false;
  try {
    message = await Message.create({
      conversationId,
      senderId,
      senderType: 'user',
      senderSnapshot: {
        displayName: sender.displayName,
        avatarUrl: sender.avatarUrl ?? null,
      },
      content,
      attachment: input.attachment ?? null,
      clientMessageId: input.clientMessageId,
    });
  } catch (error) {
    if (getErrorCode(error) !== 11000) throw error;
    message = await Message.findOne(idempotencyFilter).lean();
    if (!message || message.content !== content) {
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Message retry does not match the original');
    }
    duplicate = true;
  }

  await updateConversationActivity(message);
  return {
    message: toPersistedMessage(message),
    participantIds: conversation.participantIds.map((participantId) => participantId.toString()),
    duplicate,
  };
}

export async function persistAssistantMessage(input: {
  userId: string;
  conversationId: string;
  replyToMessageId: string;
  content: string;
}) {
  const senderId = parseObjectId(input.userId, 'INVALID_USER_ID');
  const conversationId = parseObjectId(input.conversationId, 'INVALID_CONVERSATION_ID');
  const replyToMessageId = parseObjectId(input.replyToMessageId, 'INVALID_MESSAGE_ID');
  const content = input.content.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!content) throw new AppError(502, 'AI_EMPTY_RESPONSE', 'Gemini returned an empty response');

  const membership = await ConversationMember.findOne({ conversationId, userId: senderId })
    .select('_id')
    .lean();
  const conversation = await Conversation.findById(conversationId)
    .select('participantIds')
    .lean();
  if (!membership || !conversation || !conversation.participantIds.some((id) => id.equals(senderId))) {
    throw new AppError(403, 'CONVERSATION_FORBIDDEN', 'You cannot send to this conversation');
  }

  const idempotencyFilter = { conversationId, replyToMessageId };
  const existing = await Message.findOne(idempotencyFilter).lean();
  if (existing) {
    return {
      message: toPersistedMessage(existing),
      participantIds: conversation.participantIds.map((id) => id.toString()),
    };
  }

  let message;
  try {
    message = await Message.create({
      conversationId,
      senderId,
      senderType: 'assistant',
      replyToMessageId,
      senderSnapshot: { displayName: 'Gemini AI', avatarUrl: null },
      content,
      clientMessageId: `gemini_${randomUUID().replaceAll('-', '')}`,
    });
  } catch (error) {
    if (getErrorCode(error) !== 11000) throw error;
    message = await Message.findOne(idempotencyFilter).lean();
    if (!message) throw error;
  }

  await updateConversationActivity(message);
  return {
    message: toPersistedMessage(message),
    participantIds: conversation.participantIds.map((id) => id.toString()),
  };
}

export async function acknowledgeMessageDelivered(input: {
  userId: string;
  conversationId: string;
  messageId: string;
}) {
  const userId = parseObjectId(input.userId, 'INVALID_USER_ID');
  const conversationId = parseObjectId(input.conversationId, 'INVALID_CONVERSATION_ID');
  const messageId = parseObjectId(input.messageId, 'INVALID_MESSAGE_ID');
  const member = await ConversationMember.findOne({ conversationId, userId })
    .select('clearedAt lastDeliveredAt lastDeliveredMessageAt lastDeliveredMessageId')
    .lean();
  if (!member) {
    throw new AppError(403, 'CONVERSATION_FORBIDDEN', 'You cannot acknowledge this conversation');
  }

  const message = await Message.findOne({
    _id: messageId,
    conversationId,
    senderId: { $ne: userId },
    ...(member.clearedAt ? { createdAt: { $gt: member.clearedAt } } : {}),
  }).select('_id senderId createdAt').lean();
  if (!message) {
    throw new AppError(400, 'INVALID_DELIVERY_POSITION', 'Delivery position is not visible');
  }

  if (
    member.lastDeliveredMessageAt &&
    (message.createdAt < member.lastDeliveredMessageAt ||
      (message.createdAt.getTime() === member.lastDeliveredMessageAt.getTime() &&
        member.lastDeliveredMessageId &&
        message._id.toString() <= member.lastDeliveredMessageId.toString()))
  ) {
    return { deliveredAt: member.lastDeliveredAt ?? new Date(), changed: false };
  }

  const deliveredAt = new Date();
  const updatedMember = await ConversationMember.findOneAndUpdate(
    {
      conversationId,
      userId,
      clearedAt: member.clearedAt ?? null,
      $or: [
        { lastDeliveredMessageAt: null },
        { lastDeliveredMessageAt: { $lt: message.createdAt } },
        {
          lastDeliveredMessageAt: message.createdAt,
          lastDeliveredMessageId: { $lt: message._id },
        },
      ],
    },
    {
      $set: {
        lastDeliveredAt: deliveredAt,
        lastDeliveredMessageAt: message.createdAt,
        lastDeliveredMessageId: message._id,
      },
    },
    { new: true },
  );

  return {
    deliveredAt: updatedMember?.lastDeliveredAt ?? deliveredAt,
    senderId: message.senderId.toString(),
    messageId: message._id.toString(),
      messageCreatedAt: message.createdAt,
    changed: Boolean(updatedMember),
  };
}
