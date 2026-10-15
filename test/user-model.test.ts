import { describe, expect, it, vi } from 'vitest';
import { buildSessionPayload } from '../src/config/session.js';
import { normalizeDisplayName, User } from '../src/models/user.model.js';

describe('Google identity and session payloads', () => {
  it('normalizes Google emails and keeps the identity record stable', () => {
    expect(User.normalizeEmail(' Jane.Doe@Example.com ')).toBe('jane.doe@example.com');

    const user = new User({
      googleSub: 'google-123',
      email: 'Jane.Doe@Example.com',
      displayName: 'Jane Doe',
      avatarUrl: 'https://example.com/avatar.png',
      emailVerified: true,
      accountStatus: 'active',
    });

    expect(user.email).toBe('jane.doe@example.com');
    expect(user.googleSub).toBe('google-123');
    expect(user.isActive()).toBe(true);
  });

  it('normalizes display names for indexed prefix search', async () => {
    const user = new User({
      googleSub: 'google-search',
      email: 'search@example.com',
      displayName: '  Jane\t Doe  ',
    });
    await user.validate();

    expect(normalizeDisplayName('  Jane\t Doe  ')).toBe('jane doe');
    expect(user.normalizedDisplayName).toBe('jane doe');
    expect(User.schema.path('normalizedDisplayName').options.select).toBe(false);
    expect(User.schema.indexes().map(([keys]) => keys)).toContainEqual({
      accountStatus: 1,
      normalizedDisplayName: 1,
      createdAt: -1,
      _id: -1,
    });
  });

  it('preserves app-managed profile fields when Google signs in again', async () => {
    const user = new User({
      googleSub: 'google-123',
      email: 'jane@example.com',
      displayName: 'App Profile Name',
      avatarUrl: 'https://example.com/app-avatar.png',
      emailVerified: true,
      accountStatus: 'active',
    });
    vi.spyOn(User, 'findOne').mockResolvedValue(user as never);
    vi.spyOn(user, 'save').mockResolvedValue(user);

    const updatedUser = await User.upsertFromGoogleProfile({
      googleSub: 'google-123',
      email: 'jane@example.com',
      displayName: 'Google Profile Name',
      avatarUrl: 'https://example.com/google-avatar.png',
      emailVerified: true,
    });

    expect(updatedUser.displayName).toBe('App Profile Name');
    expect(updatedUser.avatarUrl).toBe('https://example.com/app-avatar.png');
  });

  it('builds a server-side session payload with authenticated user metadata', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const payload = buildSessionPayload({
      userId: 'user-123',
      createdAt,
      idleMs: 7 * 24 * 60 * 60 * 1000,
      absoluteMs: 30 * 24 * 60 * 60 * 1000,
    });

    expect(payload.userId).toBe('user-123');
    expect(payload.isAuthenticated).toBe(true);
    expect(payload.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(payload.expiresAt.getTime()).toBeGreaterThan(payload.createdAt.getTime());
    expect(payload.lastActivityAt.getTime()).toBeGreaterThanOrEqual(payload.createdAt.getTime());
  });
});
