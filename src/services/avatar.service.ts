import { createHash, randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import type { AppLogger } from '../utils/logger.js';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/error.js';

const AVATAR_FOLDER_ROOT = 'chatapp/avatars';
const ALLOWED_FORMATS = ['jpg', 'png', 'webp'] as const;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const CHAT_MEDIA_FOLDER_ROOT = 'chatapp/media';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  avatarUploadPreset: string;
}

interface CloudinaryImageResource {
  public_id?: string;
  folder?: string;
  asset_folder?: string;
  resource_type?: string;
  format?: string;
  bytes?: number;
  secure_url?: string;
}

function ownerFolder(userId: string): string {
  const ownerKey = createHash('sha256').update(userId).digest('hex');
  return `${AVATAR_FOLDER_ROOT}/${ownerKey}`;
}

function configureCloudinary(credentials: CloudinaryCredentials): void {
  cloudinary.config({
    cloud_name: credentials.cloudName,
    api_key: credentials.apiKey,
    api_secret: credentials.apiSecret,
    secure: true,
  });
}

export function createAvatarUploadSignature(
  userId: string,
  credentials: CloudinaryCredentials,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = ownerFolder(userId);
  const publicId = `avatar-${randomUUID()}`;
  const signedParameters = {
    allowed_formats: ALLOWED_FORMATS.join(','),
    folder,
    overwrite: false,
    public_id: publicId,
    timestamp,
    upload_preset: credentials.avatarUploadPreset,
  };

  return {
    cloudName: credentials.cloudName,
    apiKey: credentials.apiKey,
    signature: cloudinary.utils.api_sign_request(signedParameters, credentials.apiSecret),
    timestamp,
    folder,
    publicId,
    uploadPreset: credentials.avatarUploadPreset,
    allowedFormats: [...ALLOWED_FORMATS],
    maxBytes: MAX_AVATAR_BYTES,
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/image/upload`,
  };
}

export function createChatMediaUploadSignature(userId: string, kind: 'image' | 'video', credentials: CloudinaryCredentials) {
  const timestamp = Math.floor(Date.now() / 1000);
  const owner = createHash('sha256').update(userId).digest('hex');
  const folder = `${CHAT_MEDIA_FOLDER_ROOT}/${owner}`;
  const publicId = `media-${randomUUID()}`;
  const allowedFormats = kind === 'image' ? ['jpg', 'png', 'webp'] : ['mp4'];
  const signedParameters = {
    allowed_formats: allowedFormats.join(','), folder, overwrite: false, public_id: publicId,
    timestamp, upload_preset: credentials.avatarUploadPreset,
  };
  return {
    cloudName: credentials.cloudName, apiKey: credentials.apiKey,
    signature: cloudinary.utils.api_sign_request(signedParameters, credentials.apiSecret),
    timestamp, folder, publicId, uploadPreset: credentials.avatarUploadPreset, allowedFormats,
    maxBytes: kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES, resourceType: kind,
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/${kind}/upload`,
  };
}

async function getOwnedImageResource(
  userId: string,
  publicId: string,
  credentials: CloudinaryCredentials,
): Promise<CloudinaryImageResource | null> {
  configureCloudinary(credentials);
  try {
    const resource = await cloudinary.api.resource(publicId, { resource_type: 'image' });
    const asset = resource as CloudinaryImageResource;
    const folders = [asset.folder, asset.asset_folder].filter(
      (folder): folder is string => typeof folder === 'string',
    );
    if (
      asset.public_id !== publicId ||
      !folders.includes(ownerFolder(userId)) ||
      asset.resource_type !== 'image'
    ) {
      return null;
    }
    return asset;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'http_code' in error &&
      error.http_code === 404
    ) {
      return null;
    }
    throw new AppError(502, 'AVATAR_VERIFICATION_FAILED', 'Avatar upload could not be verified right now');
  }
}

export async function updateUserProfile(input: {
  userId: string;
  displayName?: string;
  avatarPublicId?: string;
  credentials?: CloudinaryCredentials;
  logger: AppLogger;
}) {
  const user = await User.findById(input.userId);
  if (!user || !user.isActive()) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
  }

  let verifiedAvatar: { publicId: string; url: string } | undefined;
  if (input.avatarPublicId) {
    if (!input.credentials) {
      throw new AppError(503, 'AVATAR_UPLOAD_UNAVAILABLE', 'Avatar uploads are not configured');
    }
    const avatarName = input.avatarPublicId.split('/').at(-1) ?? '';
    const hasValidName = /^avatar-[a-f\d-]{36}$/.test(avatarName);
    const hasValidPath =
      input.avatarPublicId === avatarName ||
      input.avatarPublicId === `${ownerFolder(input.userId)}/${avatarName}`;
    if (!hasValidName || !hasValidPath) {
      throw new AppError(400, 'INVALID_AVATAR', 'Avatar upload could not be verified');
    }

    const resource = await getOwnedImageResource(
      input.userId,
      input.avatarPublicId,
      input.credentials,
    );
    if (
      !resource ||
      !resource.secure_url?.startsWith('https://') ||
      !resource.format ||
      !ALLOWED_FORMATS.includes(resource.format as (typeof ALLOWED_FORMATS)[number]) ||
      !Number.isInteger(resource.bytes) ||
      (resource.bytes ?? MAX_AVATAR_BYTES + 1) > MAX_AVATAR_BYTES
    ) {
      throw new AppError(400, 'INVALID_AVATAR', 'Avatar upload could not be verified');
    }

    verifiedAvatar = {
      publicId: input.avatarPublicId,
      url: resource.secure_url,
    };
  }

  const previousAvatarPublicId = user.avatarPublicId ?? null;
  if (input.displayName !== undefined) user.displayName = input.displayName;
  if (verifiedAvatar) {
    user.avatarPublicId = verifiedAvatar.publicId;
    user.avatarUrl = verifiedAvatar.url;
  }
  const savedUser = await user.save();

  if (
    previousAvatarPublicId &&
    verifiedAvatar &&
    previousAvatarPublicId !== verifiedAvatar.publicId &&
    input.credentials
  ) {
    try {
      const previousResource = await getOwnedImageResource(
        input.userId,
        previousAvatarPublicId,
        input.credentials,
      );
      if (previousResource) {
        await cloudinary.uploader.destroy(previousAvatarPublicId, { resource_type: 'image' });
      }
    } catch (error) {
      input.logger.warn(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Cloudinary avatar cleanup failed',
      );
    }
  }

  return {
    id: savedUser._id.toString(),
    displayName: savedUser.displayName,
    email: savedUser.email,
    avatarUrl: savedUser.avatarUrl ?? null,
  };
}
