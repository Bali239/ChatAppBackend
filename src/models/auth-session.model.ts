import mongoose, { type InferSchemaType, type Model, Schema } from 'mongoose';

const rotationSchema = new Schema(
  {
    tokenHash: { type: String, required: true },
    rotatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const authSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    tokenVersion: { type: Number, required: true, default: 0, min: 0 },
    refreshTokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date, default: null, index: true },
    revocationReason: {
      type: String,
      enum: ['logout', 'refresh_reuse'],
      default: null,
    },
    lastUsedAt: { type: Date, default: null },
    rotatedAt: { type: Date, default: null },
    rotationCounter: { type: Number, default: 0, min: 0 },
    previousTokenHashes: {
      type: [rotationSchema],
      default: [],
    },
  },
  { timestamps: true },
);

authSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });

export type AuthSessionDocument = InferSchemaType<typeof authSessionSchema> & {
  _id: mongoose.Types.ObjectId;
};

export interface AuthSessionModel extends Model<AuthSessionDocument> {}

export const AuthSession = mongoose.models.AuthSession as AuthSessionModel | undefined
  ?? mongoose.model<AuthSessionDocument, AuthSessionModel>('AuthSession', authSessionSchema);
