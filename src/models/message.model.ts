import mongoose, { type InferSchemaType, type Model, Schema } from 'mongoose';

export const MAX_MESSAGE_LENGTH = 5_000;

const senderSnapshotSchema = new Schema(
  {
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    avatarUrl: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderSnapshot: {
      type: senderSnapshotSchema,
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_MESSAGE_LENGTH,
    },
    clientMessageId: {
      type: String,
      required: true,
      trim: true,
      minlength: 8,
      maxlength: 128,
      match: /^[A-Za-z0-9_-]+$/,
    },
  },
  { timestamps: true },
);

messageSchema.index(
  { conversationId: 1, createdAt: -1, _id: -1 },
  { name: 'messages_by_conversation_time' },
);
messageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true, name: 'unique_sender_message_retry' },
);

export type MessageDocument = InferSchemaType<typeof messageSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Message = mongoose.models.Message as Model<MessageDocument> | undefined ??
  mongoose.model<MessageDocument>('Message', messageSchema);