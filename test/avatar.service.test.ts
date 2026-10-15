import { createHash } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { User } from '../src/models/user.model.js';
import {
  createAvatarUploadSignature,
  updateUserProfile,
  type CloudinaryCredentials,
} from '../src/services/avatar.service.js';
import { createLogger } from '../src/utils/logger.js';

const credentials: CloudinaryCredentials = {
  cloudName: 'test-cloud',
  apiKey: 'test-key',
  apiSecret: 'server-only-secret',
  avatarUploadPreset: 'signed-avatar-preset',
};

afterEach(() => vi.restoreAllMocks());

describe('avatar service', () => {
  it('signs a constrained upload without returning the API secret', () => {
    const upload = createAvatarUploadSignature('user-123', credentials);

    expect(upload).toMatchObject({
      cloudName: 'test-cloud',
      apiKey: 'test-key',
      folder: expect.stringMatching(/^chatapp\/avatars\/[a-f\d]{64}$/),
      publicId: expect.stringMatching(/^avatar-[a-f\d-]{36}$/),
      allowedFormats: ['jpg', 'png', 'webp'],
      maxBytes: 5 * 1024 * 1024,
    });
    expect(upload).not.toHaveProperty('apiSecret');
    expect(upload.signature).toBe(cloudinary.utils.api_sign_request({
      allowed_formats: 'jpg,png,webp',
      folder: upload.folder,
      overwrite: false,
      public_id: upload.publicId,
      timestamp: upload.timestamp,
      upload_preset: credentials.avatarUploadPreset,
    }, credentials.apiSecret));
    expect(upload.uploadPreset).toBe('signed-avatar-preset');
  });

  it('rejects a foreign or oversized upload without modifying the user', async () => {
    const save = vi.fn();
    vi.spyOn(User, 'findById').mockResolvedValue({
      isActive: () => true,
      save,
    } as never);
    vi.spyOn(cloudinary.api, 'resource').mockResolvedValue({
      public_id: 'avatar-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      folder: 'chatapp/avatars/another-owner',
      resource_type: 'image',
      secure_url: 'https://res.cloudinary.com/test/image/upload/avatar.png',
      format: 'png',
      bytes: 100,
    } as never);

    await expect(updateUserProfile({
      userId: 'user-123',
      avatarPublicId: 'avatar-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      credentials,
      logger: createLogger('silent'),
    })).rejects.toMatchObject({ code: 'INVALID_AVATAR' });
    expect(save).not.toHaveBeenCalled();
  });

  it.each(['folder', 'asset_folder', 'conflicting', 'folder_prefixed_id'] as const)(
    'persists an owned image when Cloudinary reports its owner in %s', async (folderShape) => {
      const user = {
        _id: { toString: () => 'user-123' },
        displayName: 'Before',
        email: 'user@example.com',
        avatarUrl: 'https://res.cloudinary.com/test/image/upload/old.png',
        avatarPublicId: 'avatar-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        isActive: () => true,
        save: vi.fn().mockResolvedValue({
          _id: { toString: () => 'user-123' },
          displayName: 'After',
          email: 'user@example.com',
          avatarUrl: 'https://res.cloudinary.com/test/image/upload/avatar.png',
        }),
      };
      vi.spyOn(User, 'findById').mockResolvedValue(user as never);
      const ownerFolder = `chatapp/avatars/${createHash('sha256').update('user-123').digest('hex')}`;
      const requestedAvatarName = 'avatar-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const requestedPublicId = folderShape === 'folder_prefixed_id'
        ? `${ownerFolder}/${requestedAvatarName}`
        : requestedAvatarName;
      const ownerFolderMetadata = folderShape === 'folder' || folderShape === 'folder_prefixed_id'
        ? { folder: ownerFolder }
        : folderShape === 'asset_folder'
          ? { asset_folder: ownerFolder }
          : { folder: 'chatapp/avatars/another-owner', asset_folder: ownerFolder };
      vi.spyOn(cloudinary.api, 'resource')
        .mockResolvedValueOnce({
          public_id: requestedPublicId,
          ...ownerFolderMetadata,
          resource_type: 'image',
          secure_url: 'https://res.cloudinary.com/test/image/upload/new.png',
          format: 'png',
          bytes: 100,
        } as never)
        .mockResolvedValueOnce({
          public_id: user.avatarPublicId,
          folder: ownerFolder,
          resource_type: 'image',
        } as never);
      const destroy = vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({
        result: 'ok',
      } as never);

      const result = await updateUserProfile({
        userId: 'user-123',
        displayName: 'After',
        avatarPublicId: requestedPublicId,
        credentials,
        logger: createLogger('silent'),
      });

      expect(result.displayName).toBe('After');
      expect(user.avatarPublicId).toBe(requestedPublicId);
      expect(user.save).toHaveBeenCalledOnce();
      expect(destroy).toHaveBeenCalledWith('avatar-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        resource_type: 'image',
      });
    },
  );
});
