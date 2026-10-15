import request from 'supertest';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/user.model.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('silent');

function createAuthTestApp() {
  const app = createApp({
    frontendOrigins: ['http://localhost:3000'],
    environment: 'test',
    logger,
    getDatabaseStatus: () => 'connected',
    sessionSecret: 'this_is_a_valid_session_secret_value',
    sessionCookieName: '__Host-chat_session',
    mongoUri: 'mongodb://127.0.0.1:27017/chat_app',
  });

  return app;
}

describe('auth session lifecycle', () => {
  it('returns 401 for missing or unauthenticated sessions', async () => {
    const response = await request(createAuthTestApp()).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.data.code).toBe('AUTH_REQUIRED');
  });

  it('issues a CSRF token and stores it in the session', async () => {
    const agent = request.agent(createAuthTestApp());
    const response = await agent.get('/api/v1/auth/csrf');

    expect(response.status).toBe(200);
    expect(response.body.data.csrfToken).toBeTypeOf('string');
    expect(response.body.data.csrfToken.length).toBeGreaterThan(16);
  });

  it('returns the current user profile for an authenticated session', async () => {
    const user = {
      _id: 'user-123',
      googleSub: 'google-123',
      email: 'jane@example.com',
      displayName: 'Jane Doe',
      avatarUrl: 'https://example.com/avatar.png',
      emailVerified: true,
      accountStatus: 'active',
      isActive: () => true,
    };

    vi.spyOn(User, 'findById').mockResolvedValue(user as never);

    const agent = request.agent(createAuthTestApp());
    const tokenResponse = await agent.get('/api/v1/auth/csrf');
    const csrfToken = tokenResponse.body.data.csrfToken;

    await agent
      .post('/api/v1/auth/mock-login')
      .set('X-CSRF-Token', csrfToken)
      .send({ userId: 'user-123' });

    const meResponse = await agent.get('/api/v1/auth/me');
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.user.id).toBe('user-123');
    expect(meResponse.body.data.user.email).toBe('jane@example.com');
  });
});
