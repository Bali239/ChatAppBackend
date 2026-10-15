import { describe, expect, it } from 'vitest';
import { buildSessionPayload } from '../src/config/session.js';
import { User } from '../src/models/user.model.js';

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
