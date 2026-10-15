import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ConversationMember } from '../src/models/conversation-member.model.js';
import { User } from '../src/models/user.model.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('silent');
const userId = new Types.ObjectId();

function createTestApp() {
  return createApp({
    frontendOrigins: ['http://localhost:3000'],
    environment: 'test',
    logger,
    getDatabaseStatus: () => 'connected',
    sessionSecret: 'this_is_a_valid_session_secret_value',
    cloudinary: {
      cloudName: 'test-cloud',
      apiKey: 'test-api-key',
      apiSecret: 'server-only-secret',
      avatarUploadPreset: 'signed-avatar-preset',
    },
  });
}

async function createAuthenticatedAgent(app = createTestApp()) {
  const user = {
    _id: userId,
    googleSub: 'google-chat-test',
    email: 'current@example.com',
    displayName: 'Current User',
    avatarUrl: null,
    accountStatus: 'active',
    isActive: () => true,
  };
  vi.spyOn(User, 'findById').mockResolvedValue(user as never);
  const agent = request.agent(app);
  const csrfResponse = await agent.get('/api/v1/auth/csrf');
  const csrfToken = csrfResponse.body.data.csrfToken as string;
  await agent
    .post('/api/v1/auth/mock-login')
    .set('X-CSRF-Token', csrfToken)
    .send({ userId: userId.toString() })
    .expect(200);
  return { agent, csrfToken };
}

afterEach(() => vi.restoreAllMocks());

describe('chat REST routes', () => {
  it('requires an authenticated session for user discovery', async () => {
    await request(createTestApp())
      .get('/api/v1/users')
      .expect(401);
    await request(createTestApp())
      .get('/api/v1/conversations')
      .expect(401);
    await request(createTestApp())
      .post('/api/v1/uploads/avatar/signature')
      .send({})
      .expect(401);
  });

  it('serves search through the database query and rejects short queries', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    };
    const findUsers = vi.spyOn(User, 'find').mockReturnValue(query as never);
    const { agent } = await createAuthenticatedAgent();

    const response = await agent.get('/api/v1/users/search?q=Jane').expect(200);
    expect(response.body.data).toEqual({ users: [], nextCursor: null, hasMore: false });
    expect(findUsers).toHaveBeenCalledWith(expect.objectContaining({
      accountStatus: 'active',
      normalizedDisplayName: { $regex: '^jane' },
    }));

    await agent.get('/api/v1/users/search?q=a').expect(400);
  });

  it('returns only public fields for an eligible profile', async () => {
    const otherUserId = new Types.ObjectId();
    const query = {
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        _id: otherUserId,
        displayName: 'Other User',
        email: 'other@example.com',
        avatarUrl: null,
        googleSub: 'private-subject',
        emailVerified: true,
        accountStatus: 'active',
      }),
    };
    vi.spyOn(User, 'findOne').mockReturnValue(query as never);
    const { agent } = await createAuthenticatedAgent();

    const response = await agent.get(`/api/v1/users/${otherUserId}`).expect(200);

    expect(response.body.data.user).toEqual({
      id: otherUserId.toString(),
      displayName: 'Other User',
      email: 'other@example.com',
      avatarUrl: null,
      isOnline: false,
    });
  });

  it('rejects profile fields outside the authenticated user allowlist', async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();

    const response = await agent
      .patch('/api/v1/users/me/profile')
      .set('X-CSRF-Token', csrfToken)
      .send({ displayName: 'Updated Name', accountStatus: 'disabled' })
      .expect(400);

    expect(response.body.data.code).toBe('VALIDATION_FAILED');
  });

  it('updates only the current profile through the authenticated session', async () => {
    const user = {
      _id: userId,
      email: 'current@example.com',
      displayName: 'Current User',
      avatarUrl: null,
      avatarPublicId: null,
      accountStatus: 'active',
      isActive: () => true,
      save: vi.fn().mockImplementation(async function save(this: { displayName: string }) {
        return this;
      }),
    };
    vi.spyOn(User, 'findById').mockResolvedValue(user as never);
    const agent = request.agent(createTestApp());
    const csrfToken = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
    await agent
      .post('/api/v1/auth/mock-login')
      .set('X-CSRF-Token', csrfToken)
      .send({ userId: userId.toString() })
      .expect(200);

    const response = await agent
      .patch('/api/v1/users/me/profile')
      .set('X-CSRF-Token', csrfToken)
      .send({ displayName: '  Updated   Name ' })
      .expect(200);

    expect(user.displayName).toBe('Updated Name');
    expect(user.save).toHaveBeenCalledOnce();
    expect(response.body.data.user.email).toBe('current@example.com');
  });

  it('does not allow a guessed conversation ID to read history without membership', async () => {
    const findMember = vi.spyOn(ConversationMember, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    const { agent } = await createAuthenticatedAgent();

    const response = await agent
      .get(`/api/v1/conversations/${new Types.ObjectId()}/messages`)
      .expect(404);

    expect(response.body.data.code).toBe('CONVERSATION_NOT_FOUND');
    expect(findMember).toHaveBeenCalledWith({
      conversationId: expect.any(Types.ObjectId),
      userId,
    });
  });

  it('rejects a client-selected clear cutoff and self-conversation', async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();
    const conversationId = new Types.ObjectId();

    const clearResponse = await agent
      .post(`/api/v1/conversations/${conversationId}/clear`)
      .set('X-CSRF-Token', csrfToken)
      .send({ clearedAt: '2026-01-01T00:00:00.000Z' })
      .expect(400);
    expect(clearResponse.body.data.code).toBe('VALIDATION_FAILED');

    const directResponse = await agent
      .post(`/api/v1/conversations/direct/${userId}`)
      .set('X-CSRF-Token', csrfToken)
      .send({})
      .expect(400);
    expect(directResponse.body.data.code).toBe('SELF_CONVERSATION');
  });

  it('rejects writes without a valid CSRF token and returns constrained avatar signatures', async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent();
    await agent
      .post('/api/v1/uploads/avatar/signature')
      .send({})
      .expect(403);

    const response = await agent
      .post('/api/v1/uploads/avatar/signature')
      .set('X-CSRF-Token', csrfToken)
      .send({})
      .expect(200);

    expect(response.body.data).toMatchObject({
      cloudName: 'test-cloud',
      allowedFormats: ['jpg', 'png', 'webp'],
      maxBytes: 5 * 1024 * 1024,
    });
    expect(response.body.data).not.toHaveProperty('apiSecret');
  });
});