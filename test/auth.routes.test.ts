import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/user.model.js';
import { createLogger } from '../src/utils/logger.js';
import { AuthSession } from '../src/models/auth-session.model.js';
import { Types } from 'mongoose';

const logger = createLogger('silent');
const authTokenSecret = 'a-long-test-auth-token-secret-at-least-32-chars';

function createAuthTestApp() {
  return createApp({
    frontendOrigins: ['http://localhost:3000'],
    environment: 'test',
    logger,
    getDatabaseStatus: () => 'connected',
    authTokenSecret,
  });
}

async function issueTestToken(userId = new Types.ObjectId().toString()) {
  vi.spyOn(AuthSession, 'create').mockResolvedValue({} as never);
  const response = await request(createAuthTestApp())
    .post('/api/v1/auth/mock-login')
    .send({ userId })
    .expect(200);
  return response.body.data.accessToken as string;
}

function mockActiveSession() {
  vi.spyOn(AuthSession, 'findOne').mockReturnValue({
    select: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
  } as never);
}

describe('bearer authentication lifecycle', () => {
  it('returns 401 for missing or invalid bearer tokens', async () => {
    const app = createAuthTestApp();
    await request(app).get('/api/v1/auth/me').expect(401);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.token.value')
      .expect(401);
  });

  it('does not expose cookie or CSRF session endpoints', async () => {
    const response = await request(createAuthTestApp()).get('/api/v1/auth/csrf');
    expect(response.status).toBe(404);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('returns the current user profile for a valid bearer token', async () => {
    const userId = new Types.ObjectId().toString();
    mockActiveSession();
    const user = {
      _id: 'user-123',
      googleSub: 'google-123',
      email: 'jane@example.com',
      displayName: 'Jane Doe',
      avatarUrl: 'https://example.com/avatar.png',
      emailVerified: true,
      accountStatus: 'active',
      authTokenVersion: 0,
      isActive: () => true,
    };
    vi.spyOn(User, 'findById').mockResolvedValue({ ...user, _id: userId } as never);
    const accessToken = await issueTestToken(userId);

    const meResponse = await request(createAuthTestApp())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.user.id).toBe(userId);
    expect(meResponse.body.data.user.email).toBe('jane@example.com');
  });

  it('invalidates issued tokens on logout without setting cookies', async () => {
    const userId = new Types.ObjectId().toString();
    mockActiveSession();
    const user = {
      _id: 'user-123',
      googleSub: 'google-123',
      email: 'jane@example.com',
      displayName: 'Jane Doe',
      avatarUrl: null,
      emailVerified: true,
      accountStatus: 'active',
      authTokenVersion: 0,
      isActive: () => true,
    };
    vi.spyOn(User, 'findById').mockResolvedValue({ ...user, _id: userId } as never);
    const updateSpy = vi.spyOn(AuthSession, 'updateOne').mockResolvedValue({} as never);
    const accessToken = await issueTestToken(userId);
    const logoutResponse = await request(createAuthTestApp())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(logoutResponse.body.data.loggedOut).toBe(true);
    expect(logoutResponse.headers['set-cookie']).toBeUndefined();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: expect.any(String), userId, revokedAt: null }),
      { $set: expect.objectContaining({ revokedAt: expect.any(Date), revocationReason: 'logout' }) },
    );
  });
});
