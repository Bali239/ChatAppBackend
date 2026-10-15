import mongoose, { type InferSchemaType, type Model, Schema } from 'mongoose';

const conversationMemberSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    clearedAt: {
      type: Date,
      default: null,
    },
    lastReadAt: {
      type: Date,
      default: null,
    },
    lastReadMessageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    lastDeliveredAt: {
      type: Date,
      default: null,
    },
    lastDeliveredMessageAt: {
      type: Date,
      default: null,
    },
    lastDeliveredMessageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { timestamps: true },
);

conversationMemberSchema.index(
  { conversationId: 1, userId: 1 },
  { unique: true, name: 'unique_conversation_member' },
);
conversationMemberSchema.index(
  { userId: 1, lastActivityAt: -1, _id: -1 },
  { name: 'members_by_user_activity' },
);

export type ConversationMemberDocument = InferSchemaType<typeof conversationMemberSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ConversationMember = mongoose.models.ConversationMember as Model<ConversationMemberDocument> | undefined ??
  mongoose.model<ConversationMemberDocument>('ConversationMember', conversationMemberSchema);