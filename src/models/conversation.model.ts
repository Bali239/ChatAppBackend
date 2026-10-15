import mongoose, { type InferSchemaType, type Model, Schema, Types } from 'mongoose';

export const CONVERSATION_TYPES = ['direct'] as const;

export function createParticipantKey(participantIds: readonly string[]): string {
  const sortedIds = [...participantIds].sort();
  if (
    sortedIds.length !== 2 ||
    sortedIds[0] === sortedIds[1] ||
    sortedIds.some((participantId) => !Types.ObjectId.isValid(participantId))
  ) {
    throw new Error('A direct conversation requires two distinct valid users');
  }
  return sortedIds.join(':');
}

const conversationSchema = new Schema(
  {
    type: {
      type: String,
      enum: CONVERSATION_TYPES,
      default: 'direct',
      required: true,
    },
    participantIds: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      required: true,
      validate: {
        validator: (participantIds: Types.ObjectId[]) =>
          participantIds.length === 2 &&
          new Set(participantIds.map((participantId) => participantId.toString())).size === 2,
        message: 'A direct conversation must have exactly two distinct participants',
      },
    },
    participantKey: {
      type: String,
      required: true,
      trim: true,
    },
    lastMessageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

conversationSchema.index(
  { participantKey: 1 },
  { unique: true, name: 'unique_direct_participants' },
);

export type ConversationDocument = InferSchemaType<typeof conversationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Conversation = mongoose.models.Conversation as Model<ConversationDocument> | undefined ??
  mongoose.model<ConversationDocument>('Conversation', conversationSchema);