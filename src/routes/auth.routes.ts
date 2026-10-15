import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { buildSessionPayload } from '../config/session.js';
import { issueCsrfToken, requireAuth, requireCsrf } from '../middleware/auth.js';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/error.js';
import { sendSuccessResponse } from '../utils/response.js';

export type GoogleOAuthClient = Pick<
  OAuth2Client,
  'generateAuthUrl' | 'getToken' | 'verifyIdToken'
>;

export interface AuthRouterOptions {
  googleClientId?: string;
  googleClientSecret?: string;
  googleCallbackUrl?: string;
  postLoginRedirectUrl?: string;
  redirectAllowlist?: readonly string[];
  sessionIdleTimeoutMs?: number;
  sessionAbsoluteTimeoutMs?: number;
  cookieName?: string;
  onLogout?: (userId: string) => void;
  oauthClient?: GoogleOAuthClient;
}

function saveSession(session: Express.Request['session']): Promise<void> {
  return new Promise((resolve, reject) => {
    session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(session: Express.Request['session']): Promise<void> {
  return new Promise((resolve, reject) => {
    session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function matchesSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function normalizeRedirect(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function createAuthRouter(options: AuthRouterOptions = {}): Router {
  const router = Router();
  const oauthClient = options.oauthClient ?? (
    options.googleClientId && options.googleClientSecret && options.googleCallbackUrl
      ? new OAuth2Client(
          options.googleClientId,
          options.googleClientSecret,
          options.googleCallbackUrl,
        )
      : undefined
  );
  const approvedRedirects = new Set(
    (options.redirectAllowlist ?? []).map(normalizeRedirect).filter(Boolean),
  );
  const idleTimeoutMs = options.sessionIdleTimeoutMs ?? 7 * 24 * 60 * 60 * 1000;
  const absoluteTimeoutMs = options.sessionAbsoluteTimeoutMs ?? 30 * 24 * 60 * 60 * 1000;

  function resolveRedirect(value: string | undefined): string {
    const normalized = value ? normalizeRedirect(value) : undefined;
    if (!normalized || !approvedRedirects.has(normalized)) {
      throw new AppError(400, 'INVALID_REDIRECT', 'Redirect URL is not allowed');
    }
    return normalized;
  }

  function requireOAuthConfiguration(): GoogleOAuthClient {
    if (!oauthClient || !options.googleClientId || !options.googleCallbackUrl) {
      throw new AppError(503, 'OAUTH_UNAVAILABLE', 'Google sign-in is not configured');
    }
    return oauthClient;
  }

  router.get('/csrf', (request, response) => {
    const csrfToken = issueCsrfToken(request.session);
    sendSuccessResponse(response, 200, 'CSRF token issued', { csrfToken });
  });

  router.get('/me', requireAuth, (request, response) => {
    const user = request.user;
    if (!user) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    sendSuccessResponse(response, 200, 'Current user loaded', {
      user: {
        id: user.id,
        name: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
      },
    });
  });

  router.post('/logout', requireAuth, requireCsrf, (request, response) => {
    const userId = request.user?.id;
    request.session.destroy((error) => {
      if (error) {
        response.status(500).json({
          statusCode: 500,
          message: 'Logout failed',
          data: { code: 'LOGOUT_FAILED' },
        });
        return;
      }

      if (userId) options.onLogout?.(userId);
      response.clearCookie(options.cookieName ?? '__Host-chat_session', { path: '/' });
      sendSuccessResponse(response, 200, 'Logged out', { loggedOut: true });
    });
  });

  router.post('/mock-login', requireCsrf, (request, response) => {
    if (request.app.get('env') !== 'test') {
      throw new AppError(404, 'NOT_FOUND', 'Route not found');
    }

    const { userId } = request.body as { userId?: string };
    if (!userId) {
      throw new AppError(400, 'INVALID_REQUEST', 'userId is required');
    }

    request.session.userId = userId;
    request.session.createdAt = new Date();
    request.session.lastActivityAt = new Date();
    request.session.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    request.session.idleExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    sendSuccessResponse(response, 200, 'Mock login successful', { ok: true });
  });

  router.get('/google', async (request, response) => {
    const client = requireOAuthConfiguration();
    const requestedRedirect = request.query.returnTo;
    if (requestedRedirect !== undefined && typeof requestedRedirect !== 'string') {
      throw new AppError(400, 'INVALID_REDIRECT', 'Redirect URL is not allowed');
    }
    const returnTo = resolveRedirect(
      requestedRedirect ?? options.postLoginRedirectUrl,
    );
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    request.session.oauthState = state;
    request.session.oauthNonce = nonce;
    request.session.oauthReturnTo = returnTo;
    await saveSession(request.session);

    response.redirect(client.generateAuthUrl({
      access_type: 'online',
      include_granted_scopes: true,
      prompt: 'select_account',
      response_type: 'code',
      scope: ['openid', 'email', 'profile'],
      state,
      nonce,
    }));
  });

  router.get('/google/callback', async (request, response) => {
    const client = requireOAuthConfiguration();
    const code = request.query.code;
    const state = request.query.state;
    const storedState = request.session.oauthState;
    const nonce = request.session.oauthNonce;
    const returnTo = request.session.oauthReturnTo;

    if (typeof code !== 'string' || typeof state !== 'string' || !storedState || !nonce) {
      throw new AppError(400, 'OAUTH_STATE_INVALID', 'Google sign-in could not be validated');
    }
    if (!matchesSecret(state, storedState)) {
      throw new AppError(400, 'OAUTH_STATE_INVALID', 'Google sign-in could not be validated');
    }

    delete request.session.oauthState;
    delete request.session.oauthNonce;
    delete request.session.oauthReturnTo;
    await saveSession(request.session);

    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      throw new AppError(401, 'OAUTH_TOKEN_INVALID', 'Google did not return a valid identity token');
    }
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: options.googleClientId,
    });
    const profile = ticket.getPayload();
    if (
      !profile?.sub ||
      !profile.email ||
      profile.email_verified !== true ||
      !profile.name ||
      !profile.nonce ||
      !matchesSecret(profile.nonce, nonce)
    ) {
      throw new AppError(401, 'OAUTH_IDENTITY_INVALID', 'Google identity could not be validated');
    }

    const user = await User.upsertFromGoogleProfile({
      googleSub: profile.sub,
      email: profile.email,
      displayName: profile.name,
      avatarUrl: profile.picture,
      emailVerified: true,
    });
    if (!user.isActive()) {
      throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled');
    }

    await regenerateSession(request.session);
    const sessionPayload = buildSessionPayload({
      userId: user._id.toString(),
      idleMs: idleTimeoutMs,
      absoluteMs: absoluteTimeoutMs,
    });
    request.session.userId = sessionPayload.userId;
    request.session.createdAt = sessionPayload.createdAt;
    request.session.lastActivityAt = sessionPayload.lastActivityAt;
    request.session.idleExpiresAt = sessionPayload.idleExpiresAt;
    request.session.expiresAt = sessionPayload.expiresAt;
    await saveSession(request.session);

    response.redirect(resolveRedirect(returnTo));
  });

  return router;
}
