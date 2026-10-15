import mongoose, { type InferSchemaType, type Model, Schema } from 'mongoose';

export const USER_ACCOUNT_STATUSES = ['active', 'disabled'] as const;
export type UserAccountStatus = (typeof USER_ACCOUNT_STATUSES)[number];

export interface GoogleUserProfile {
  googleSub: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  accountStatus?: UserAccountStatus;
}

const userSchema = new Schema(
  {
    googleSub: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: null,
      trim: true,
    },
    accountStatus: {
      type: String,
      enum: USER_ACCOUNT_STATUSES,
      default: 'active',
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.method('isActive', function isActive(this: UserDocument): boolean {
  return this.accountStatus === 'active';
});

userSchema.pre('validate', function normalizeUserEmail(next) {
  if (typeof this.email === 'string') {
    this.email = this.email.trim().toLowerCase();
  }
  next();
});

export type UserDocument = InferSchemaType<typeof userSchema> & {
  _id: mongoose.Types.ObjectId;
  isActive(): boolean;
};

export interface UserModel extends Model<UserDocument> {
  normalizeEmail(email: string): string;
  findByGoogleSub(googleSub: string): Promise<UserDocument | null>;
  upsertFromGoogleProfile(profile: GoogleUserProfile): Promise<UserDocument>;
}

userSchema.statics.normalizeEmail = function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
};

userSchema.statics.findByGoogleSub = function findByGoogleSub(googleSub: string) {
  return this.findOne({ googleSub }).lean();
};

userSchema.statics.upsertFromGoogleProfile = async function upsertFromGoogleProfile(
  profile: GoogleUserProfile,
) {
  const normalizedEmail = profile.email.trim().toLowerCase();
  const existingUser = await this.findOne({ googleSub: profile.googleSub });

  if (existingUser) {
    existingUser.email = normalizedEmail;
    existingUser.displayName = profile.displayName;
    existingUser.avatarUrl = profile.avatarUrl ?? existingUser.avatarUrl ?? null;
    existingUser.emailVerified = profile.emailVerified ?? existingUser.emailVerified;
    existingUser.accountStatus = existingUser.accountStatus === 'disabled' ? 'disabled' : 'active';
    existingUser.lastLoginAt = new Date();
    return existingUser.save();
  }

  try {
    return await this.create({
      googleSub: profile.googleSub,
      email: normalizedEmail,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl ?? null,
      emailVerified: profile.emailVerified ?? false,
      accountStatus: profile.accountStatus ?? 'active',
      lastLoginAt: new Date(),
    });
  } catch (error) {
    const mongoError = error as { code?: number; message?: string };
    if (mongoError.code === 11000) {
      const existingByEmail = await this.findOne({ email: normalizedEmail });
      if (existingByEmail) {
        throw new Error('A user with this email already exists');
      }
      throw error;
    }
    throw error;
  }
};

export const User = mongoose.models.User as UserModel | undefined ?? mongoose.model<UserDocument, UserModel>('User', userSchema);
